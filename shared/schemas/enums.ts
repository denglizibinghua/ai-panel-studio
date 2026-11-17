import { z } from 'zod';

/**
 * Enums are declared exactly once here and re-exported through the package entry.
 * Values are transcribed verbatim from specs/001-panel/data-model.md and
 * specs/001-panel/contracts/events.md §4. Nothing outside this package may
 * declare a second copy of these lists.
 */

export const discussionStatusValues = [
  'draft',
  'generating',
  'ready',
  'running',
  'finished',
  'failed',
  'cancelled',
] as const;
export const discussionStatusSchema = z.enum(discussionStatusValues);
export type DiscussionStatus = z.infer<typeof discussionStatusSchema>;

/** Statuses a run can be cancelled from (events.md §6.4). */
export const cancellableStatusValues = ['draft', 'generating', 'ready', 'running'] as const;
export const cancellableStatusSchema = z.enum(cancellableStatusValues);

export const colorIdValues = [
  'amber',
  'rose',
  'sky',
  'emerald',
  'violet',
  'orange',
  'teal',
  'lime',
  'indigo',
  'fuchsia',
] as const;
export const colorIdSchema = z.enum(colorIdValues);
export type ColorId = z.infer<typeof colorIdSchema>;

export const guestRoleValues = ['host', 'expert'] as const;
export const guestRoleSchema = z.enum(guestRoleValues);
export type GuestRole = z.infer<typeof guestRoleSchema>;

export const speechTypeValues = [
  'opening',
  'challenge',
  'supplement',
  'rebuttal',
  'question',
  'summary',
] as const;
export const speechTypeSchema = z.enum(speechTypeValues);
export type SpeechType = z.infer<typeof speechTypeSchema>;

/** Expert speech types, capped at 120 chars by the turns CHECK (data-model §2.3). */
export const shortSpeechTypeValues = [
  'challenge',
  'supplement',
  'rebuttal',
  'question',
] as const;
export const shortSpeechTypeSchema = z.enum(shortSpeechTypeValues);

/** The 19 persisted event types (events.md §4). */
export const eventTypeValues = [
  'state.draft',
  'state.generating',
  'state.ready',
  'state.running',
  'state.finished',
  'state.failed',
  'state.cancelled',
  'run.started',
  'run.finished',
  'run.failed',
  'run.cancelled',
  'agent.status',
  'turn.started',
  'turn.delta',
  'turn.done',
  'consensus.added',
  'consensus.updated',
  'divergence.added',
  'divergence.updated',
] as const;
export const eventTypeSchema = z.enum(eventTypeValues);
export type EventType = z.infer<typeof eventTypeSchema>;

/** The 6 allowed type prefixes (data-model §2.4 CHECK). */
export const eventPrefixValues = [
  'state.',
  'run.',
  'agent.',
  'turn.',
  'consensus.',
  'divergence.',
] as const;

export const agentStateValues = ['idle', 'preparing', 'speaking'] as const;
export const agentStateSchema = z.enum(agentStateValues);
export type AgentState = z.infer<typeof agentStateSchema>;

export const pointStatusValues = ['provisional', 'final', 'dropped'] as const;
export const pointStatusSchema = z.enum(pointStatusValues);
export type PointStatus = z.infer<typeof pointStatusSchema>;

export const ledgerParseStatusValues = ['structured', 'json_mode', 'fallback'] as const;
export const ledgerParseStatusSchema = z.enum(ledgerParseStatusValues);

export const ledgerDecisionValues = ['speak', 'summarize', 'force_stop'] as const;
export const ledgerDecisionSchema = z.enum(ledgerDecisionValues);

export const llmModuleValues = ['guest', 'ledger', 'turn', 'consensus', 'summary'] as const;
export const llmModuleSchema = z.enum(llmModuleValues);

export const llmProviderValues = ['deepseek'] as const;
export const llmProviderSchema = z.enum(llmProviderValues);

export const errorCodeValues = [
  'LLM_NOT_CONFIGURED',
  'LLM_UPSTREAM_ERROR',
  'ALL_SPEAKERS_FAILED',
] as const;
export const errorCodeSchema = z.enum(errorCodeValues);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const runFinishReasonValues = [
  'max_turns',
  'request_satisfied',
  'stalled',
  'empty_transcript',
] as const;
export const runFinishReasonSchema = z.enum(runFinishReasonValues);

/** ISO-8601 UTC with millisecond precision, e.g. 2026-11-17T08:30:00.000Z. */
export const isoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'must be ISO-8601 UTC with ms');

export const idSchema = z.number().int().positive();
