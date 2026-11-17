import { z } from 'zod';
import { idSchema, isoDateTimeSchema, shortSpeechTypeValues, speechTypeSchema } from './enums';

const SHORT_SPEECH_TYPES: ReadonlySet<string> = new Set(shortSpeechTypeValues);

/**
 * One `turns` row. The content bound mirrors the dual-branch CHECK in
 * data-model.md §2.3: expert speech <= 120 chars, host opening/summary <= 400.
 */
export const turnSchema = z
  .object({
    id: idSchema,
    discussion_id: idSchema,
    guest_id: idSchema,
    turn_no: z.number().int().min(1),
    speech_type: speechTypeSchema,
    content: z.string().min(1),
    created_at: isoDateTimeSchema,
  })
  .strict()
  .superRefine((turn, ctx) => {
    const limit = SHORT_SPEECH_TYPES.has(turn.speech_type) ? 120 : 400;
    if (turn.content.length > limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: `content exceeds ${limit} chars for speech_type=${turn.speech_type}`,
      });
    }
  });
export type Turn = z.infer<typeof turnSchema>;
