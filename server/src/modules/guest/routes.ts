/**
 * POST /api/discussions/:id/guests/generate — writes the draft lineup (`locked=0`).
 * 阵容锁定（locked=1、agent_status、状态事件）属于 S6，本轮不实现。
 */
import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../../db';
import { createDeepSeekClient, type ChatJsonClient } from '../../llm/client';
import {
  GenerateGuestsError,
  generateGuests,
  type GenerateGuestsErrorCode,
} from './generate';

export interface GuestRoutesPluginOptions {
  /** Resolved per request so buildApp stays lazy about the shared connection. */
  db: () => Db;
}

export interface GuestRoutesDeps {
  /** Tests inject a fake; production builds the DeepSeek client per request. */
  llm?: ChatJsonClient;
}

const STATUS_BY_CODE: Record<GenerateGuestsErrorCode, number> = {
  DISCUSSION_NOT_FOUND: 404,
  GUESTS_ALREADY_LOCKED: 409,
  INVALID_STATE_TRANSITION: 409,
  GUEST_OUTPUT_INVALID: 422,
  LLM_NOT_CONFIGURED: 500,
  LLM_UPSTREAM_ERROR: 500,
};

const NOT_FOUND_BODY = { code: 'DISCUSSION_NOT_FOUND', message: '讨论不存在' } as const;

function parseDiscussionId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function guestRoutes(
  deps: GuestRoutesDeps = {},
): FastifyPluginAsync<GuestRoutesPluginOptions> {
  return async (app, opts) => {
    app.post<{ Params: { id: string } }>(
      '/api/discussions/:id/guests/generate',
      async (request, reply) => {
        const discussionId = parseDiscussionId(request.params.id);
        if (discussionId === null) {
          return reply.status(404).send(NOT_FOUND_BODY);
        }

        const db = opts.db();
        const llm = deps.llm ?? createDeepSeekClient({ db });

        try {
          const body = await generateGuests(db, discussionId, { llm });
          return reply.status(200).send(body);
        } catch (error) {
          if (error instanceof GenerateGuestsError) {
            return reply
              .status(STATUS_BY_CODE[error.code])
              .send({ code: error.code, message: error.message });
          }
          throw error;
        }
      },
    );
  };
}
