import { z } from 'zod';
import { idSchema, isoDateTimeSchema, pointStatusSchema } from './enums';

const pointFields = {
  id: idSchema,
  discussion_id: idSchema,
  text: z.string().min(1).max(120),
  status: pointStatusSchema,
  support_guest_ids: z.array(idSchema).nullable(),
  round_no: z.number().int().min(1).nullable(),
  updated_seq: z.number().int().min(1),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
};

export const consensusPointSchema = z.object(pointFields).strict();
export type ConsensusPoint = z.infer<typeof consensusPointSchema>;

export const divergencePointSchema = z.object(pointFields).strict();
export type DivergencePoint = z.infer<typeof divergencePointSchema>;
