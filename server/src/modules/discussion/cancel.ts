/**
 * POST /api/discussions/:id/cancel — terminal `cancelled` (AC-1.24).
 *
 * `cancelled` is not `failed`: `error_code` stays NULL and the event is
 * `run.cancelled` (payload has no error_code field at all). The runner is
 * aborted after commit; every subsequent turn write checks the status inside its
 * transaction, so no turn can be appended after this point.
 */
import { z } from 'zod';
import { cancellableStatusSchema } from '@ai-panel/shared';
import type { Db } from '../../db';
import { EventBus } from '../sse/bus';
import { appendEventInTx, serializeEventPayload } from '../sse/publish';
import { DiscussionError } from './errors';
import { requireStatus, transitionInTx } from './status';

export const cancelResponseSchema = z
  .object({
    id: z.number().int().positive(),
    status: z.literal('cancelled'),
    finished_at: z.string(),
    error_code: z.null(),
  })
  .strict();
export type CancelResponse = z.infer<typeof cancelResponseSchema>;

export interface CancelDeps {
  bus?: EventBus;
  now?: () => Date;
}

export function cancelDiscussion(db: Db, discussionId: number, deps: CancelDeps = {}): CancelResponse {
  const at = (deps.now ?? (() => new Date()))().toISOString();

  const commit = db.transaction((): { events: ReturnType<typeof appendEventInTx>[] } => {
    const status = requireStatus(db, discussionId);
    const cancellable = cancellableStatusSchema.safeParse(status);
    if (!cancellable.success) {
      throw new DiscussionError('INVALID_STATE_TRANSITION', '该状态不可取消');
    }

    const transition = transitionInTx(db, discussionId, 'cancelled', {
      at,
      finished_at: at,
      error_code: null,
    });
    const cancelledPayload = serializeEventPayload('run.cancelled', {
      cancelled_at: at,
      previous_status: cancellable.data,
    });
    const cancelled = appendEventInTx(db, discussionId, 'run.cancelled', cancelledPayload, at);

    return { events: [transition.event, cancelled] };
  });

  const { events } = commit.immediate();
  deps.bus?.broadcast(discussionId, events);

  return cancelResponseSchema.parse({
    id: discussionId,
    status: 'cancelled',
    finished_at: at,
    error_code: null,
  });
}
