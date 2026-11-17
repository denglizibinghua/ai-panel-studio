/**
 * GET /api/discussions/:id/events — SSE transport (contracts/events.md §1).
 *
 * The 404 is decided before the stream is opened: an unknown discussion must
 * receive JSON `DISCUSSION_NOT_FOUND` and never an event-stream response
 * (AC-3.6). Everything after that point is owned by `reply.raw`, hence the
 * explicit hijack.
 */
import type { FastifyPluginAsync } from 'fastify';
import { EventBus } from './bus';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
} as const;

/**
 * `Connection` is a hop-by-hop header and **forbidden in HTTP/2** (RFC 9113 §8.2.2).
 * Node's HTTP/1.1 path is fine with it; an h2-terminating proxy may reject the
 * response outright. So it is added only for HTTP/1.x.
 */
function buildHeaders(httpVersionMajor: number): Record<string, string> {
  const headers: Record<string, string> = { ...SSE_HEADERS };
  if (httpVersionMajor <= 1) {
    headers.Connection = 'keep-alive';
  }
  return headers;
}

const NOT_FOUND_BODY = { code: 'DISCUSSION_NOT_FOUND', message: '讨论不存在' } as const;

function parseDiscussionId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function parseLastEventId(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

export function sseRoutes(bus: EventBus): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { id: string } }>(
      '/api/discussions/:id/events',
      async (request, reply) => {
        const discussionId = parseDiscussionId(request.params.id);
        if (discussionId === null || !bus.hasDiscussion(discussionId)) {
          return reply.status(404).send(NOT_FOUND_BODY);
        }

        reply.hijack();
        reply.raw.writeHead(200, buildHeaders(request.raw.httpVersionMajor));
        reply.raw.flushHeaders?.();

        try {
          bus.subscribe(
            discussionId,
            parseLastEventId(request.headers['last-event-id']),
            reply.raw,
          );
        } catch {
          // Headers are already out, so a JSON error is impossible. Ending the
          // response is the only honest outcome (e.g. DB closed mid-shutdown).
          reply.raw.end();
        }
        return reply;
      },
    );
  };
}
