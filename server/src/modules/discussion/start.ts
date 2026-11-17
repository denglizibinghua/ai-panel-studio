/**
 * POST /api/discussions/:id/start — `ready → running` (AC-1.8, AC-2.10).
 *
 * The response is returned only after `state.running` and `run.started` are
 * committed; the runner itself is fired asynchronously by the route. The
 * 3-running ceiling is checked inside the same IMMEDIATE transaction that flips
 * the status, so two concurrent starts cannot both slip through.
 */
import { z } from 'zod';
import type { Db } from '../../db';
import { EventBus } from '../sse/bus';
import { appendEventInTx, serializeEventPayload } from '../sse/publish';
import { DiscussionError } from './errors';
import { requireStatus, transitionInTx } from './status';

export const MAX_RUNNING_DISCUSSIONS = 3;

export const startResponseSchema = z
  .object({
    id: z.number().int().positive(),
    status: z.literal('running'),
    started_at: z.string(),
  })
  .strict();
export type StartResponse = z.infer<typeof startResponseSchema>;

export interface StartDeps {
  bus?: EventBus;
  now?: () => Date;
}

interface DiscussionRow {
  id: number;
  expert_count: number;
}

export function startDiscussion(db: Db, discussionId: number, deps: StartDeps = {}): StartResponse {
  const at = (deps.now ?? (() => new Date()))().toISOString();

  const commit = db.transaction((): { events: ReturnType<typeof appendEventInTx>[] } => {
    const row = db
      .prepare('SELECT id, expert_count FROM discussions WHERE id = ?')
      .get(discussionId) as DiscussionRow | undefined;
    if (row === undefined) {
      throw new DiscussionError('DISCUSSION_NOT_FOUND', '讨论不存在');
    }

    const status = requireStatus(db, discussionId);
    if (status !== 'ready') {
      throw new DiscussionError('INVALID_STATE_TRANSITION', '只有 ready 状态可以开始');
    }

    const running = db
      .prepare("SELECT COUNT(*) AS count FROM discussions WHERE status = 'running'")
      .get() as { count: number };
    if (running.count >= MAX_RUNNING_DISCUSSIONS) {
      throw new DiscussionError(
        'TOO_MANY_RUNNING',
        `同时进行的讨论已达 ${MAX_RUNNING_DISCUSSIONS} 场`,
      );
    }

    const transition = transitionInTx(db, discussionId, 'running', { at, started_at: at });
    const startedPayload = serializeEventPayload('run.started', {
      started_at: at,
      expert_count: row.expert_count,
    });
    const started = appendEventInTx(db, discussionId, 'run.started', startedPayload, at);

    return { events: [transition.event, started] };
  });

  const { events } = commit.immediate();
  deps.bus?.broadcast(discussionId, events);

  return startResponseSchema.parse({ id: discussionId, status: 'running', started_at: at });
}
