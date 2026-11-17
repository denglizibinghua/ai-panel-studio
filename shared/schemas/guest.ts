import { z } from 'zod';
import { colorIdSchema, guestRoleSchema, idSchema, isoDateTimeSchema } from './enums';

/**
 * API projection of one `guests` row (openapi.yaml Guest schema).
 * `locked` is a boolean in the contract; the DB stores 0/1.
 */
export const guestSchema = z
  .object({
    id: idSchema,
    discussion_id: idSchema,
    name: z.string().min(1).max(32),
    profession: z.string().min(1).max(40),
    stance: z.string().min(1).max(60),
    color_id: colorIdSchema,
    role: guestRoleSchema,
    speaking_order: z.number().int().min(0).max(8),
    locked: z.boolean(),
  })
  .strict();
export type Guest = z.infer<typeof guestSchema>;

/** DB-row projection used by seed/tests (locked stored as 0 | 1). */
export const guestRowSchema = guestSchema
  .omit({ locked: true })
  .extend({
    locked: z.union([z.literal(0), z.literal(1)]),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type GuestRow = z.infer<typeof guestRowSchema>;
