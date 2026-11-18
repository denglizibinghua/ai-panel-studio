/**
 * POST /api/discussions/:id/retry-summary (S9).
 *
 * The only legal edge out of `failed`: a run whose every expert call failed has
 * no transcript issue, so the user may ask for the closing summary again. The
 * endpoint is deliberately narrow — `status='failed'` AND
 * `error_code='ALL_SPEAKERS_FAILED'`; everything else is 409.
 *
 * Success writes the summary turn + `summary_text` (INV-9), the matching
 * `turn.done` (transcript/event drift would break replay), `state.finished` and
 * `run.finished` in one transaction, and clears the stale error code.
 */
import { z } from 'zod';
import type { Db } from '../../db';
import type { ChatJsonClient } from '../../llm/client';
import { EventBus } from '../sse/bus';
import { appendEventInTx, serializeEventPayload } from '../sse/publish';
import {
  EMPTY_TRANSCRIPT_SUMMARY,
  generateSummary,
} from '../summary/summary';
import type { LedgerRecentTurn } from '../host/ledger';
import { DiscussionError } from './errors';
import { requireStatus, transitionInTx } from './status';

export const retrySummaryResponseSchema = z
  .object({
    id: z.number().int().positive(),
    status: z.literal('finished'),
    summary_text: z.string().min(1),
    finished_at: z.string(),
  })
  .strict();

export type RetrySummaryResponse = z.infer<typeof retrySummaryResponseSchema>;

export interface RetrySummaryDeps {
  llm: ChatJsonClient;
  bus?: EventBus;
  now?: () => Date;
  /** Test seam; production uses the spec's 30s summary budget (spec §4.3). */
  summary_timeout_ms?: number;
}

interface FailedRow {
  id: number;
  topic: string;
  error_code: string | null;
  status: string;
}

interface HostRow {
  id: number;
}

function loadTranscript(db: Db, discussionId: number): LedgerRecentTurn[] {
  return db
    .prepare(
      `SELECT t.guest_id, g.name AS speaker_name, t.speech_type, t.content
         FROM turns t
         JOIN guests g ON g.id = t.guest_id
        WHERE t.discussion_id = ?
        ORDER BY t.turn_no ASC`,
    )
    .all(discussionId) as LedgerRecentTurn[];
}

function countExpertTurns(db: Db, discussionId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM turns t
         JOIN guests g ON g.id = t.guest_id
        WHERE t.discussion_id = ? AND g.role = 'expert'`,
    )
    .get(discussionId) as { count: number };
  return row.count;
}

/**
 * In-process guard: the app is a single Fastify process, so a module-level Set
 * is enough to keep a second concurrent retry from duplicating the model call.
 * Claimed synchronously before the first `await` and released in `finally`.
 */
const retryInFlight = new Set<number>();

export async function retrySummary(
  db: Db,
  discussionId: number,
  deps: RetrySummaryDeps,
): Promise<RetrySummaryResponse> {
  if (retryInFlight.has(discussionId)) {
    throw new DiscussionError('INVALID_STATE_TRANSITION', '该讨论的总结重试正在进行中');
  }
  retryInFlight.add(discussionId);
  try {
    return await retrySummaryOnce(db, discussionId, deps);
  } finally {
    retryInFlight.delete(discussionId);
  }
}

async function retrySummaryOnce(
  db: Db,
  discussionId: number,
  deps: RetrySummaryDeps,
): Promise<RetrySummaryResponse> {
  const status = requireStatus(db, discussionId);
  const row = db
    .prepare('SELECT id, topic, error_code, status FROM discussions WHERE id = ?')
    .get(discussionId) as FailedRow | undefined;
  if (row === undefined) {
    throw new DiscussionError('DISCUSSION_NOT_FOUND', '讨论不存在');
  }
  if (status !== 'failed' || row.error_code !== 'ALL_SPEAKERS_FAILED') {
    throw new DiscussionError(
      'INVALID_STATE_TRANSITION',
      '只有全部发言失败的讨论可以重试总结',
    );
  }

  const host = db
    .prepare(
      "SELECT id FROM guests WHERE discussion_id = ? AND role = 'host' AND locked = 1 LIMIT 1",
    )
    .get(discussionId) as HostRow | undefined;
  if (host === undefined) {
    throw new DiscussionError('INVALID_STATE_TRANSITION', '主持人阵容未锁定');
  }

  const transcript = loadTranscript(db, discussionId);
  const emptyTranscript = transcript.length === 0;
  const summary = emptyTranscript
    ? { text: EMPTY_TRANSCRIPT_SUMMARY, failed: false }
    : await generateSummary(
        deps.llm,
        {
          discussion_id: discussionId,
          topic: row.topic,
          transcript,
        },
        { timeout_ms: deps.summary_timeout_ms },
      );

  const at = (deps.now ?? (() => new Date()))().toISOString();
  const expertTurnCount = countExpertTurns(db, discussionId);
  // The original run ended in failure; `max_turns` would be a lie (usually 0 expert
  // turns). `retry_summary` is the honest reason for this finished transition.
  const reason = emptyTranscript ? ('empty_transcript' as const) : ('retry_summary' as const);

  const commit = db.transaction((): ReturnType<typeof appendEventInTx>[] => {
    const next = db
      .prepare('SELECT COALESCE(MAX(turn_no), 0) + 1 AS next FROM turns WHERE discussion_id = ?')
      .get(discussionId) as { next: number };
    const turnNo = next.next;

    db.prepare(
      `INSERT INTO turns (discussion_id, guest_id, turn_no, speech_type, content, created_at)
       VALUES (?, ?, ?, 'summary', ?, ?)`,
    ).run(discussionId, host.id, turnNo, summary.text, at);

    const donePayload = serializeEventPayload('turn.done', {
      guest_id: host.id,
      turn_no: turnNo,
      speech_type: 'summary',
      content: summary.text,
      created_at: at,
    });
    const done = appendEventInTx(db, discussionId, 'turn.done', donePayload, at);

    db.prepare('UPDATE discussions SET summary_text = ?, updated_at = ? WHERE id = ?').run(
      summary.text,
      at,
      discussionId,
    );

    const transition = transitionInTx(db, discussionId, 'finished', {
      at,
      finished_at: at,
      clear_error_code: true,
    });

    const finishedPayload = serializeEventPayload('run.finished', {
      finished_at: at,
      reason,
      expert_turn_count: expertTurnCount,
      summary_failed: summary.failed,
    });
    const finished = appendEventInTx(db, discussionId, 'run.finished', finishedPayload, at);

    return [done, transition.event, finished];
  });

  const events = commit.immediate();
  deps.bus?.broadcast(discussionId, events);

  return retrySummaryResponseSchema.parse({
    id: discussionId,
    status: 'finished',
    summary_text: summary.text,
    finished_at: at,
  });
}
