import Fastify, { type FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@ai-panel/shared';
import { getDb, type Db } from './db';
import { isLlmConfigured } from './llm/config';

export interface BuildAppOptions {
  /** Injected for tests; defaults to the shared process connection. */
  db?: Db;
}

/**
 * GET /health is contractually always HTTP 200 (openapi.yaml HealthStatus):
 * dependency failures are reported in the body, never as a 5xx.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => {
    let db: 'ok' | 'error' = 'ok';
    try {
      const database = options.db ?? getDb();
      database.prepare('SELECT 1').get();
    } catch {
      db = 'error';
    }

    const llm = isLlmConfigured() ? 'configured' : 'missing';

    return healthResponseSchema.parse({
      status: 'ok',
      db,
      llm,
      now: new Date().toISOString(),
    });
  });

  return app;
}
