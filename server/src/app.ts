import Fastify, { type FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@ai-panel/shared';
import { getDb, type Db } from './db';
import { isLlmConfigured } from './llm/config';
import type { ChatJsonClient } from './llm/client';
import { guestRoutes } from './modules/guest/routes';
import { confirmRoutes } from './modules/guest/confirm';
import { discussionRoutes } from './modules/discussion/routes';
import { EventBus } from './modules/sse/bus';
import { sseRoutes } from './modules/sse/routes';

export interface BuildAppOptions {
  /** Injected for tests; defaults to the shared process connection. */
  db?: Db;
  /** Injected for tests; production builds a DeepSeek client per guest request. */
  llm?: ChatJsonClient;
  /** Injected for transport tests that need to publish directly. */
  bus?: EventBus;
}

/**
 * GET /health is contractually always HTTP 200 (openapi.yaml HealthStatus):
 * dependency failures are reported in the body, never as a 5xx.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = (): Db => options.db ?? getDb();
  const bus = options.bus ?? new EventBus(db);

  // preClose (not onClose): end hijacked SSE responses BEFORE server.close()
  // starts waiting for open connections, otherwise shutdown hangs whenever a
  // viewer is watching a live discussion.
  app.addHook('preClose', async () => {
    bus.closeAll();
  });

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

  app.register(guestRoutes({ llm: options.llm }), { db: () => options.db ?? getDb() });
  app.register(confirmRoutes(bus), { db });
  app.register(discussionRoutes({ llm: options.llm }), { db, bus });
  app.register(sseRoutes(bus));

  return app;
}
