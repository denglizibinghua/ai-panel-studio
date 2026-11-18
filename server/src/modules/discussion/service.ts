/**
 * Discussion CRUD (three read/write paths that do not start a run).
 *
 * `create` writes the first event (`state.draft`, seq=1, previous_status=null)
 * in the same transaction as the row, then broadcasts after commit — the same
 * commit-then-push discipline as `guest/confirm`. `list` and `detail` read
 * `status` through `status.ts`, the single status authority (H8).
 */
import { z } from 'zod';
import { colorIdSchema, guestSchema, type DiscussionStatus, type Guest } from '@ai-panel/shared';
import type { Db } from '../../db';
import { EventBus } from '../sse/bus';
import { appendEventInTx, serializeEventPayload } from '../sse/publish';
import { DiscussionError } from './errors';
import { loadDiscussionStatus, parseStatus } from './status';

export const createDiscussionBodySchema = z
  .object({
    topic: z.string().min(1).max(200),
    expert_count: z.number().int().min(1).max(8).default(4),
    session_id: z.string().max(64).optional(),
  })
  .strict();
export type CreateDiscussionBody = z.infer<typeof createDiscussionBodySchema>;

export const discussionSummarySchema = z
  .object({
    id: z.number().int().positive(),
    topic: z.string().min(1).max(200),
    status: z.string(),
    expert_count: z.number().int().min(1).max(8),
    updated_at: z.string(),
    guest_count: z.number().int().min(0),
    expert_color_ids: z.array(colorIdSchema).max(8),
    summary_text: z.string().max(400).nullable(),
  })
  .strict();

export const discussionDetailSchema = discussionSummarySchema
  .extend({
    session_id: z.string().max(64).nullable(),
    error_code: z
      .enum(['LLM_NOT_CONFIGURED', 'LLM_UPSTREAM_ERROR', 'ALL_SPEAKERS_FAILED'])
      .nullable(),
    last_event_seq: z.number().int().min(0),
    created_at: z.string(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    guests: z.array(guestSchema),
  })
  .strict();

export type DiscussionSummary = z.infer<typeof discussionSummarySchema>;
export type DiscussionDetail = z.infer<typeof discussionDetailSchema>;

interface SummaryRow {
  id: number;
  topic: string;
  status: string;
  expert_count: number;
  updated_at: string;
  guest_count: number;
  /** Raw `group_concat` output; NULL when no confirmed expert is in the lineup. */
  expert_color_ids: string | null;
  summary_text: string | null;
}

interface DetailRow extends SummaryRow {
  session_id: string | null;
  error_code: string | null;
  last_event_seq: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface GuestRow {
  id: number;
  discussion_id: number;
  name: string;
  profession: string;
  stance: string;
  color_id: string;
  role: 'host' | 'expert';
  speaking_order: number;
  locked: 0 | 1;
}

/**
 * Shared projection for list and detail: the three additive fields
 * (`guest_count` / `expert_color_ids` / `summary_text`) are computed inline so
 * neither read path needs a per-row follow-up query. `expert_color_ids` order is
 * pinned by the aggregate `ORDER BY` (SQLite >= 3.44), and an unconfirmed
 * lineup (no `locked=1` experts) yields NULL, mapped to `[]` by `toSummary`.
 */
const SUMMARY_COLUMNS = `
  d.id, d.topic, d.status, d.expert_count, d.updated_at, d.summary_text,
  (SELECT COUNT(*) FROM guests g WHERE g.discussion_id = d.id) AS guest_count,
  (SELECT group_concat(g.color_id, ',' ORDER BY g.speaking_order ASC, g.id ASC)
     FROM guests g
    WHERE g.discussion_id = d.id AND g.locked = 1 AND g.role = 'expert') AS expert_color_ids
`;

function parseColorIds(raw: string | null): string[] {
  return raw === null || raw === '' ? [] : raw.split(',');
}

function toSummary(row: SummaryRow): DiscussionSummary {
  return discussionSummarySchema.parse({
    id: row.id,
    topic: row.topic,
    status: parseStatus(row.status),
    expert_count: row.expert_count,
    updated_at: row.updated_at,
    guest_count: row.guest_count,
    expert_color_ids: parseColorIds(row.expert_color_ids),
    summary_text: row.summary_text,
  });
}

function loadGuests(db: Db, discussionId: number): Guest[] {
  const rows = db
    .prepare(
      `SELECT id, discussion_id, name, profession, stance, color_id, role, speaking_order, locked
         FROM guests
        WHERE discussion_id = ?
        ORDER BY speaking_order ASC, id ASC`,
    )
    .all(discussionId) as GuestRow[];

  return rows.map((row) =>
    guestSchema.parse({
      id: row.id,
      discussion_id: row.discussion_id,
      name: row.name,
      profession: row.profession,
      stance: row.stance,
      color_id: row.color_id,
      role: row.role,
      speaking_order: row.speaking_order,
      locked: row.locked === 1,
    }),
  );
}

export function loadDetail(db: Db, discussionId: number): DiscussionDetail | null {
  const row = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, d.session_id, d.error_code,
              d.last_event_seq, d.created_at, d.started_at, d.finished_at
         FROM discussions d WHERE d.id = ?`,
    )
    .get(discussionId) as DetailRow | undefined;
  if (row === undefined) {
    return null;
  }

  const status = loadDiscussionStatus(db, discussionId);
  if (status === null) {
    return null;
  }

  return discussionDetailSchema.parse({
    ...toSummary(row),
    status,
    session_id: row.session_id,
    error_code: row.error_code,
    last_event_seq: row.last_event_seq,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    guests: loadGuests(db, discussionId),
  });
}

const ACTIVE_STATUSES: readonly DiscussionStatus[] = ['draft', 'generating', 'ready', 'running'];

export function listDiscussions(db: Db, activeOnly: boolean): DiscussionSummary[] {
  const where = activeOnly
    ? `WHERE d.status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})`
    : '';
  const params = activeOnly ? [...ACTIVE_STATUSES] : [];
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}
         FROM discussions d ${where}
        ORDER BY d.updated_at DESC, d.id DESC`,
    )
    .all(...params) as SummaryRow[];
  return rows.map(toSummary);
}

export interface CreateDiscussionDeps {
  bus?: EventBus;
  now?: () => Date;
}

export function createDiscussion(
  db: Db,
  input: CreateDiscussionBody,
  deps: CreateDiscussionDeps = {},
): DiscussionDetail {
  const at = (deps.now ?? (() => new Date()))().toISOString();

  const commit = db.transaction((): { id: number; event: ReturnType<typeof appendEventInTx> } => {
    const info = db
      .prepare(
        `INSERT INTO discussions (topic, expert_count, session_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`,
      )
      .run(input.topic, input.expert_count, input.session_id ?? null, at, at);
    const id = Number(info.lastInsertRowid);

    const payload = serializeEventPayload('state.draft', {
      status: 'draft',
      previous_status: null,
      updated_at: at,
    });
    const event = appendEventInTx(db, id, 'state.draft', payload, at);
    return { id, event };
  });

  const { id, event } = commit.immediate();
  deps.bus?.broadcast(id, [event]);

  const detail = loadDetail(db, id);
  if (detail === null) {
    throw new DiscussionError('DISCUSSION_NOT_FOUND', '讨论不存在');
  }
  return detail;
}
