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
