/**
 * Discussion lifecycle REST endpoints (openapi.yaml /api/discussions*).
 *
 * `POST /start` commits `state.running` + `run.started`, then fires the runner
 * with `setImmediate` so the HTTP response never waits for the first model call.
 * The registry lets `POST /cancel` abort that in-flight run.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db';
import { createDeepSeekClient, type ChatJsonClient } from '../../llm/client';
import { isLlmConfigured } from '../../llm/config';
import { EventBus } from '../sse/bus';
import { runDiscussion } from '../turn/runner';
import { cancelDiscussion } from './cancel';
import { DiscussionError } from './errors';
import { createRunRegistry, type RunRegistry } from './registry';
import {
  createDiscussion,
  createDiscussionBodySchema,
  listDiscussions,
  loadDetail,
} from './service';
import { startDiscussion } from './start';
import { loadDiscussionStatus } from './status';

export interface DiscussionRoutesDeps {
  /** Tests inject a fake; production builds the DeepSeek client per request. */
  llm?: ChatJsonClient;
}

export interface DiscussionRoutesOptions {
  db: () => Db;
  bus: EventBus;
  registry?: RunRegistry;
}

const NOT_FOUND_BODY = { code: 'DISCUSSION_NOT_FOUND', message: '讨论不存在' } as const;

function parseDiscussionId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function statusForError(code: DiscussionError['code']): number {
  if (code === 'DISCUSSION_NOT_FOUND') {
    return 404;
  }
  if (code === 'INVALID_INPUT') {
    return 400;
  }
  return 409;
}

export function discussionRoutes(
  deps: DiscussionRoutesDeps = {},
): FastifyPluginAsync<DiscussionRoutesOptions> {
  return async (app, opts) => {
    const registry = opts.registry ?? createRunRegistry();

    app.post('/api/discussions', async (request, reply) => {
      const parsed = createDiscussionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ code: 'INVALID_INPUT', message: '议题或人数不合法' });
      }
      const body = createDiscussion(opts.db(), parsed.data, { bus: opts.bus });
      return reply.status(201).send(body);
    });

    app.get<{ Querystring: { active?: string } }>('/api/discussions', async (request, reply) => {
      const raw = request.query.active;
      let activeOnly = false;
      if (raw !== undefined) {
        if (raw !== '0' && raw !== '1') {
          return reply.status(400).send({ code: 'INVALID_INPUT', message: 'active 只能是 0 或 1' });
        }
        activeOnly = raw === '1';
      }
      return reply.status(200).send(listDiscussions(opts.db(), activeOnly));
    });

    app.get<{ Params: { id: string } }>('/api/discussions/:id', async (request, reply) => {
      const discussionId = parseDiscussionId(request.params.id);
      if (discussionId === null) {
        return reply.status(404).send(NOT_FOUND_BODY);
      }
      const detail = loadDetail(opts.db(), discussionId);
      if (detail === null) {
        return reply.status(404).send(NOT_FOUND_BODY);
      }
      return reply.status(200).send(detail);
    });

    app.post<{ Params: { id: string } }>('/api/discussions/:id/start', async (request, reply) => {
      const discussionId = parseDiscussionId(request.params.id);
      if (discussionId === null) {
        return reply.status(404).send(NOT_FOUND_BODY);
      }

      const db = opts.db();
      // Preflight 404/409 BEFORE the key probe: openapi gives those precedence
      // over 500 LLM_NOT_CONFIGURED, and a missing discussion must stay 404.
      const currentStatus = loadDiscussionStatus(db, discussionId);
      if (currentStatus === null) {
        return reply.status(404).send(NOT_FOUND_BODY);
      }
      if (currentStatus !== 'ready') {
        return reply
          .status(409)
          .send({ code: 'INVALID_STATE_TRANSITION', message: '只有 ready 状态可以开始' });
      }
      // openapi start: 500 LLM_NOT_CONFIGURED when the opening cannot be produced.
      // Injected clients (tests) bypass the key probe, as in guest/generate.
      if (deps.llm === undefined && !isLlmConfigured()) {
        return reply
          .status(500)
          .send({ code: 'LLM_NOT_CONFIGURED', message: '未配置 DEEPSEEK_API_KEY' });
      }
      try {
        const body = startDiscussion(db, discussionId, { bus: opts.bus });
        const llm = deps.llm ?? createDeepSeekClient({ db });
        const controller = registry.start(discussionId);

        setImmediate(() => {
          void runDiscussion(discussionId, {
            db,
            llm,
            bus: opts.bus,
            signal: controller.signal,
          })
            .catch((error: unknown) => {
              console.error(
                '[runner] crashed:',
                error instanceof Error ? error.message : 'unknown error',
              );
            })
            .finally(() => registry.finish(discussionId, controller));
        });

        return reply.status(200).send(body);
      } catch (error) {
        if (error instanceof DiscussionError) {
          return reply
            .status(statusForError(error.code))
            .send({ code: error.code, message: error.message });
        }
        throw error;
      }
    });

    app.post<{ Params: { id: string } }>('/api/discussions/:id/cancel', async (request, reply) => {
      const discussionId = parseDiscussionId(request.params.id);
      if (discussionId === null) {
        return reply.status(404).send(NOT_FOUND_BODY);
      }
      try {
        const body = cancelDiscussion(opts.db(), discussionId, { bus: opts.bus });
        registry.abort(discussionId);
        return reply.status(200).send(body);
      } catch (error) {
        if (error instanceof DiscussionError) {
          return reply
            .status(statusForError(error.code))
            .send({ code: error.code, message: error.message });
        }
        throw error;
      }
    });
  };
}
