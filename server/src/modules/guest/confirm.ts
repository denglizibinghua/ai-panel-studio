/**
 * POST /api/discussions/:id/guests/confirm — two-phase lock-down (AC-1.7).
 *
 * One transaction does all of it, in this order:
 *   1. verify the lineup is exactly `expert_count + 1` rows (409 otherwise, no
 *      side effects);
 *   2. flip every guest to `locked = 1`;
 *   3. create one `agent_status(state='idle')` row per guest — the unique index
 *      makes this 1:1 per guest (INV-4);
 *   4. append one `agent.status` event per guest and set that row's
 *      `updated_seq` to the event's `seq` (never 0, or S8's initial replay would
 *      show no state);
 *   5. append `state.ready` and move the discussion to `ready`.
 *
 * Events are persisted through `sse/publish` — still the only runtime writer —
 * and broadcast only after the commit succeeds.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { guestSchema, idSchema, type Guest } from '@ai-panel/shared';
import type { Db } from '../../db';
import { EventBus } from '../sse/bus';
import {
  appendEventInTx,
  type PersistedEvent,
  serializeEventPayload,
} from '../sse/publish';

export type ConfirmGuestsErrorCode =
  | 'DISCUSSION_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'GUEST_COUNT_MISMATCH';

export class ConfirmGuestsError extends Error {
  readonly code: ConfirmGuestsErrorCode;

  constructor(code: ConfirmGuestsErrorCode, message: string) {
    super(message);
    this.name = 'ConfirmGuestsError';
    this.code = code;
  }
}

export interface ConfirmGuestsResponse {
  discussion_id: number;
  status: 'ready';
  guests: Guest[];
}

export interface ConfirmGuestsDeps {
  bus?: EventBus;
  now?: () => Date;
}

const discussionRowSchema = z.object({
  id: idSchema,
  expert_count: z.number().int().min(1).max(8),
  status: z.string(),
});

const guestRowProjectionSchema = z.object({
  id: idSchema,
  discussion_id: idSchema,
  name: z.string(),
  profession: z.string(),
  stance: z.string(),
  color_id: z.string(),
  role: z.enum(['host', 'expert']),
  speaking_order: z.number().int(),
  locked: z.union([z.literal(0), z.literal(1)]),
});

type GuestRow = z.infer<typeof guestRowProjectionSchema>;

const confirmResponseSchema = z
  .object({
    discussion_id: idSchema,
    status: z.literal('ready'),
    guests: z.array(guestSchema).min(2).max(9),
  })
  .strict();

function toGuest(row: GuestRow): Guest {
  return guestSchema.parse({
    id: row.id,
    discussion_id: row.discussion_id,
    name: row.name,
    profession: row.profession,
    stance: row.stance,
    color_id: row.color_id,
    role: row.role,
    speaking_order: row.speaking_order,
    locked: row.locked === 1,
  });
}

function loadGuests(db: Db, discussionId: number): GuestRow[] {
  const rows = db
    .prepare(
      `SELECT id, discussion_id, name, profession, stance, color_id, role, speaking_order, locked
         FROM guests
        WHERE discussion_id = ?
        ORDER BY speaking_order ASC, id ASC`,
    )
    .all(discussionId);
  return rows.map((row) => guestRowProjectionSchema.parse(row));
}

/** Synchronous by design: better-sqlite3 transactions cannot span an await. */
export function confirmGuests(
  db: Db,
  discussionId: number,
  deps: ConfirmGuestsDeps = {},
): ConfirmGuestsResponse {
  const timestamp = (deps.now ?? (() => new Date()))().toISOString();

  const commit = db.transaction((): { events: PersistedEvent[]; response: ConfirmGuestsResponse } => {
    const discussionRow = db
      .prepare('SELECT id, expert_count, status FROM discussions WHERE id = ?')
      .get(discussionId);
    if (discussionRow === undefined) {
      throw new ConfirmGuestsError('DISCUSSION_NOT_FOUND', '讨论不存在');
    }
    const discussion = discussionRowSchema.parse(discussionRow);

    if (discussion.status !== 'draft') {
      throw new ConfirmGuestsError('INVALID_STATE_TRANSITION', '当前状态不允许确认');
    }

    const guests = loadGuests(db, discussionId);
    // 0 行也属于「行数 ≠ expert_count + 1」，按 AC-1.7b 统一返回 GUEST_COUNT_MISMATCH。
    const hosts = guests.filter((guest) => guest.role === 'host').length;
    const experts = guests.filter((guest) => guest.role === 'expert').length;
    if (
      guests.length !== discussion.expert_count + 1 ||
      hosts !== 1 ||
      experts !== discussion.expert_count
    ) {
      throw new ConfirmGuestsError(
        'GUEST_COUNT_MISMATCH',
        guests.length === 0
          ? '尚无嘉宾阵容，请先生成再确认'
          : '嘉宾数量与 expert_count 不匹配',
      );
    }

    db.prepare('UPDATE guests SET locked = 1 WHERE discussion_id = ?').run(discussionId);

    const events: PersistedEvent[] = [];
    const upsertAgentStatus = db.prepare(
      `INSERT INTO agent_status (discussion_id, guest_id, state, focus, updated_seq, updated_at)
       VALUES (?, ?, 'idle', NULL, ?, ?)
       ON CONFLICT(discussion_id, guest_id) DO UPDATE SET
         state = 'idle',
         focus = NULL,
         updated_seq = excluded.updated_seq,
         updated_at = excluded.updated_at`,
    );

    for (const guest of guests) {
      const payload = serializeEventPayload('agent.status', {
        guest_id: guest.id,
        state: 'idle',
        focus: null,
      });
      const event = appendEventInTx(db, discussionId, 'agent.status', payload, timestamp);
      upsertAgentStatus.run(discussionId, guest.id, event.seq, timestamp);
      events.push(event);
    }

    const readyPayload = serializeEventPayload('state.ready', {
      status: 'ready',
      previous_status: 'draft',
      updated_at: timestamp,
    });
    events.push(appendEventInTx(db, discussionId, 'state.ready', readyPayload, timestamp));

    db.prepare("UPDATE discussions SET status = 'ready', updated_at = ? WHERE id = ?").run(
      timestamp,
      discussionId,
    );

    const response = confirmResponseSchema.parse({
      discussion_id: discussionId,
      status: 'ready',
      guests: loadGuests(db, discussionId).map(toGuest),
    });

    return { events, response };
  });

  const { events, response } = commit.immediate();
  deps.bus?.broadcast(discussionId, events);
  return response;
}

export function confirmRoutes(bus: EventBus): FastifyPluginAsync<{ db: () => Db }> {
  return async (app, opts) => {
    app.post<{ Params: { id: string } }>(
      '/api/discussions/:id/guests/confirm',
      async (request, reply) => {
        if (!/^[1-9]\d*$/.test(request.params.id)) {
          return reply.status(404).send({ code: 'DISCUSSION_NOT_FOUND', message: '讨论不存在' });
        }
        const discussionId = Number(request.params.id);
        if (!Number.isSafeInteger(discussionId)) {
          return reply.status(404).send({ code: 'DISCUSSION_NOT_FOUND', message: '讨论不存在' });
        }

        try {
          const body = confirmGuests(opts.db(), discussionId, { bus });
          return reply.status(200).send(body);
        } catch (error) {
          if (error instanceof ConfirmGuestsError) {
            const status = error.code === 'DISCUSSION_NOT_FOUND' ? 404 : 409;
            return reply.status(status).send({ code: error.code, message: error.message });
          }
          throw error;
        }
      },
    );
  };
}
