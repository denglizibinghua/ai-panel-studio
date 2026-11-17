import { z } from 'zod';
import { isoDateTimeSchema } from './enums';

/** GET /health response body (openapi.yaml HealthStatus). Always HTTP 200. */
export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    db: z.enum(['ok', 'error']),
    llm: z.enum(['configured', 'missing']),
    now: isoDateTimeSchema,
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;
