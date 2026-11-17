import { z } from 'zod';
import {
  idSchema,
  isoDateTimeSchema,
  ledgerDecisionSchema,
  ledgerParseStatusSchema,
  shortSpeechTypeSchema,
} from './enums';

const bit = z.union([z.literal(0), z.literal(1)]);

/** One `ledger` row (data-model.md §2.5). Never exposed to clients. */
export const ledgerSchema = z
  .object({
    id: idSchema,
    discussion_id: idSchema,
    turn_no: z.number().int().min(0),
    is_request_satisfied: bit.nullable(),
    is_in_loop: bit.nullable(),
    is_progress_being_made: bit.nullable(),
    next_guest_id: idSchema.nullable(),
    speech_type: shortSpeechTypeSchema.nullable(),
    instruction: z.string().max(200).nullable(),
    parse_status: ledgerParseStatusSchema,
    stall_count: z.number().int().min(0).max(3),
    decision: ledgerDecisionSchema,
    raw_json: z.string().max(4096).nullable(),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type Ledger = z.infer<typeof ledgerSchema>;

/**
 * Magentic-One style decision item: every answer must ship a one-line reason,
 * so `ledger.raw_json` stays reviewable without storing a prompt.
 */
const reasonSchema = z.string().trim().min(1).max(300);

const decisionItemSchema = <T extends z.ZodTypeAny>(answer: T) =>
  z.object({ reason: reasonSchema, answer }).strict();

export const ledgerBooleanDecisionSchema = decisionItemSchema(z.boolean());
export const ledgerNameDecisionSchema = decisionItemSchema(z.string().trim().min(1).max(32));
export const ledgerSpeechTypeDecisionSchema = decisionItemSchema(shortSpeechTypeSchema);
export const ledgerInstructionDecisionSchema = decisionItemSchema(z.string().trim().min(1).max(200));

/** The exact JSON the host model must emit once per turn (ledger prompt). */
export const llmLedgerDecisionSchema = z
  .object({
    is_request_satisfied: ledgerBooleanDecisionSchema,
    is_in_loop: ledgerBooleanDecisionSchema,
    is_progress_being_made: ledgerBooleanDecisionSchema,
    next_speaker: ledgerNameDecisionSchema,
    speech_type: ledgerSpeechTypeDecisionSchema,
    instruction: ledgerInstructionDecisionSchema,
  })
  .strict();
export type LlmLedgerDecision = z.infer<typeof llmLedgerDecisionSchema>;
