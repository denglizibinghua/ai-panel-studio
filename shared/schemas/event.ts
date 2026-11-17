import { z } from 'zod';
import {
  agentStateSchema,
  cancellableStatusSchema,
  discussionStatusSchema,
  errorCodeSchema,
  eventTypeSchema,
  idSchema,
  isoDateTimeSchema,
  pointStatusSchema,
  runFinishReasonSchema,
  speechTypeSchema,
  type EventType,
} from './enums';

/** One `events` row. `payload` is a JSON string in the DB (<= 4096 chars). */
export const eventSchema = z
  .object({
    id: idSchema,
    discussion_id: idSchema,
    seq: z.number().int().min(1),
    type: eventTypeSchema,
    payload: z.string().max(4096),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type Event = z.infer<typeof eventSchema>;

export const statePayloadSchema = z
  .object({
    status: discussionStatusSchema,
    previous_status: discussionStatusSchema.nullable(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const runStartedPayloadSchema = z
  .object({
    started_at: isoDateTimeSchema,
    expert_count: z.number().int().min(1).max(8),
  })
  .strict();

export const runFinishedPayloadSchema = z
  .object({
    finished_at: isoDateTimeSchema,
    reason: runFinishReasonSchema,
    expert_turn_count: z.number().int().min(0),
    summary_failed: z.boolean(),
  })
  .strict();

export const runFailedPayloadSchema = z
  .object({
    failed_at: isoDateTimeSchema,
    error_code: errorCodeSchema,
  })
  .strict();

export const runCancelledPayloadSchema = z
  .object({
    cancelled_at: isoDateTimeSchema,
    previous_status: cancellableStatusSchema,
  })
  .strict();

export const agentStatusPayloadSchema = z
  .object({
    guest_id: idSchema,
    state: agentStateSchema,
    focus: z.string().max(80).nullable(),
  })
  .strict();

export const turnStartedPayloadSchema = z
  .object({
    guest_id: idSchema,
    turn_no: z.number().int().min(1),
    speech_type: speechTypeSchema,
  })
  .strict();

export const turnDeltaPayloadSchema = z
  .object({
    guest_id: idSchema,
    turn_no: z.number().int().min(1),
    delta: z.string(),
  })
  .strict();

export const turnDonePayloadSchema = z
  .object({
    guest_id: idSchema,
    turn_no: z.number().int().min(1),
    speech_type: speechTypeSchema,
    content: z.string().min(1),
    created_at: isoDateTimeSchema,
  })
  .strict();

export const consensusPayloadSchema = z
  .object({
    point_id: idSchema,
    text: z.string().min(1).max(120),
    status: pointStatusSchema,
    support_guest_ids: z.array(idSchema),
    round_no: z.number().int().min(1),
  })
  .strict();

export const divergencePayloadSchema = z
  .object({
    point_id: idSchema,
    text: z.string().min(1).max(120),
    status: pointStatusSchema,
    support_guest_ids: z.array(idSchema),
    round_no: z.number().int().min(1),
  })
  .strict();

export const eventPayloadSchemaByType: Record<EventType, z.ZodType<unknown>> = {
  'state.draft': statePayloadSchema,
  'state.generating': statePayloadSchema,
  'state.ready': statePayloadSchema,
  'state.running': statePayloadSchema,
  'state.finished': statePayloadSchema,
  'state.failed': statePayloadSchema,
  'state.cancelled': statePayloadSchema,
  'run.started': runStartedPayloadSchema,
  'run.finished': runFinishedPayloadSchema,
  'run.failed': runFailedPayloadSchema,
  'run.cancelled': runCancelledPayloadSchema,
  'agent.status': agentStatusPayloadSchema,
  'turn.started': turnStartedPayloadSchema,
  'turn.delta': turnDeltaPayloadSchema,
  'turn.done': turnDonePayloadSchema,
  'consensus.added': consensusPayloadSchema,
  'consensus.updated': consensusPayloadSchema,
  'divergence.added': divergencePayloadSchema,
  'divergence.updated': divergencePayloadSchema,
};
