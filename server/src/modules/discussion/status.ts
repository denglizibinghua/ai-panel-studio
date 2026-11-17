/**
 * The single status authority (AGENTS §6.7 / H8).
 *
 * REST reads (`GET /api/discussions*`) and every `state.*` event written by
 * start / cancel / runner go through this file. `transitionInTx` is the only
 * place that changes `discussions.status`; it validates against the state
 * machine from spec.md §4.1 and appends the matching `state.*` event in the
 * caller's transaction (never `publish()` — events are broadcast after commit).
 */
import {
  discussionStatusSchema,
  eventTypeSchema,
  type DiscussionStatus,
  type ErrorCode,
} from '@ai-panel/shared';
import type { Db } from '../../db';
import {
  appendEventInTx,
  serializeEventPayload,
  type PersistedEvent,
} from '../sse/publish';
import { DiscussionError } from './errors';

/** Legal transitions, spec.md §4.1. Terminal states have no outgoing edge. */
const TRANSITIONS: Record<DiscussionStatus, readonly DiscussionStatus[]> = {
  draft: ['generating', 'ready', 'cancelled'],
  generating: ['draft', 'failed', 'cancelled'],
  ready: ['running', 'cancelled'],
  running: ['finished', 'failed', 'cancelled'],
  finished: [],
  failed: [],
  cancelled: [],
};

export function parseStatus(value: unknown): DiscussionStatus {
  return discussionStatusSchema.parse(value);
}

export function canTransition(from: DiscussionStatus, to: DiscussionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Same projection used by list/detail/start/cancel — one read path, one parser. */
export function loadDiscussionStatus(db: Db, discussionId: number): DiscussionStatus | null {
  const row = db.prepare('SELECT status FROM discussions WHERE id = ?').get(discussionId) as
    | { status: string }
    | undefined;
  return row === undefined ? null : parseStatus(row.status);
}

export function requireStatus(db: Db, discussionId: number): DiscussionStatus {
  const status = loadDiscussionStatus(db, discussionId);
  if (status === null) {
    throw new DiscussionError('DISCUSSION_NOT_FOUND', '讨论不存在');
  }
  return status;
}

export interface TransitionOptions {
  /** ISO-8601 timestamp shared by the row update and the event payload. */
  at: string;
  started_at?: string;
  finished_at?: string;
  /** Only `failed` carries one; `cancelled` must stay NULL (AC-1.24). */
  error_code?: ErrorCode | null;
}

export interface TransitionResult {
  from: DiscussionStatus;
  to: DiscussionStatus;
  event: PersistedEvent;
}

/**
 * Updates the row and appends `state.<to>` with the same transaction and the
 * same `at`. Throws INVALID_STATE_TRANSITION before touching anything if the
 * edge does not exist.
 */
export function transitionInTx(
  db: Db,
  discussionId: number,
  to: DiscussionStatus,
  options: TransitionOptions,
): TransitionResult {
  const from = requireStatus(db, discussionId);
  if (!canTransition(from, to)) {
    throw new DiscussionError(
      'INVALID_STATE_TRANSITION',
      `不允许从 ${from} 迁移到 ${to}`,
    );
  }

  db.prepare(
    `UPDATE discussions
        SET status      = ?,
            updated_at  = ?,
            started_at  = COALESCE(?, started_at),
            finished_at = COALESCE(?, finished_at),
            error_code  = CASE
                            WHEN ? = 'cancelled' THEN NULL
                            WHEN ? IS NULL      THEN error_code
                            ELSE ?
                          END
      WHERE id = ?`,
  ).run(
    to,
    options.at,
    options.started_at ?? null,
    options.finished_at ?? null,
    to,
    options.error_code ?? null,
    options.error_code ?? null,
    discussionId,
  );

  const type = eventTypeSchema.parse(`state.${to}`);
  const payload = serializeEventPayload(type, {
    status: to,
    previous_status: from,
    updated_at: options.at,
  });
  const event = appendEventInTx(db, discussionId, type, payload, options.at);

  return { from, to, event };
}
