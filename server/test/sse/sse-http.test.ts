import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { EventBus } from '../../src/modules/sse/bus';
import {
  createTempDb,
  disposeTempDb,
  insertDiscussion,
  openSseStream,
  parseFrames,
  removeTempFiles,
  sleep,
  waitFor,
} from './helpers';

afterAll(removeTempFiles);

function framesWithId(text: string): number[] {
  return parseFrames(text)
    .filter((frame) => frame.id !== null)
    .map((frame) => frame.id as number);
}

function agentPayload(guestId: number, focus: string): Record<string, unknown> {
  return { guest_id: guestId, state: 'idle', focus };
}

describe('GET /api/discussions/:id/events (real HTTP)', () => {
  it('streams two concurrent discussions side by side without crossover', async () => {
    const db = createTempDb('http-isolation');
    const bus = new EventBus(db);
    const app = buildApp({ db, bus });
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const discussionA = insertDiscussion(db, { topic: '讨论 A' });
    const discussionB = insertDiscussion(db, { topic: '讨论 B' });

    const streamA = await openSseStream(`${baseUrl}/api/discussions/${discussionA}/events`);
    const streamB = await openSseStream(`${baseUrl}/api/discussions/${discussionB}/events`);

    try {
      await waitFor(() => streamA.text().includes('event: caught_up'));
      await waitFor(() => streamB.text().includes('event: caught_up'));

      expect(streamA.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
      expect(streamA.headers.get('cache-control')).toBe('no-cache, no-transform');
      expect(streamA.headers.get('x-accel-buffering')).toBe('no');

      for (let index = 1; index <= 5; index += 1) {
        bus.publish(discussionA, 'agent.status', agentPayload(index, `A-${index}`));
      }
      for (let index = 1; index <= 5; index += 1) {
        bus.publish(discussionB, 'agent.status', agentPayload(index, `B-${index}`));
      }

      await waitFor(() => framesWithId(streamA.text()).length >= 5);
      await waitFor(() => framesWithId(streamB.text()).length >= 5);

      const parsedA = parseFrames(streamA.text());
      const parsedB = parseFrames(streamB.text());
      const persistedA = parsedA.filter((frame) => frame.id !== null);
      const persistedB = parsedB.filter((frame) => frame.id !== null);

      expect(persistedA.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5]);
      expect(persistedB.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5]);
      expect(persistedA.every((frame) => frame.data?.includes('"A-'))).toBe(true);
      expect(persistedA.some((frame) => frame.data?.includes('"B-'))).toBe(false);
      expect(persistedB.every((frame) => frame.data?.includes('"B-'))).toBe(true);
      expect(persistedB.some((frame) => frame.data?.includes('"A-'))).toBe(false);

      const replay = await openSseStream(
        `${baseUrl}/api/discussions/${discussionA}/events`,
        3,
      );
      try {
        await waitFor(() => replay.text().includes('event: caught_up'));
        const replayFrames = parseFrames(replay.text());
        expect(replayFrames.filter((frame) => frame.id !== null).map((frame) => frame.id)).toEqual([
          4, 5,
        ]);
        expect(replay.text()).not.toContain('id: 3\n');
        expect(replay.text()).toContain('{"up_to_seq":5}');
      } finally {
        replay.controller.abort();
        await replay.done;
      }
    } finally {
      streamA.controller.abort();
      streamB.controller.abort();
      await streamA.done;
      await streamB.done;
      await waitFor(() => bus.subscriberCount(discussionA) === 0);
      await waitFor(() => bus.subscriberCount(discussionB) === 0);
      expect(bus.totalSubscriberCount()).toBe(0);
      await app.close();
      disposeTempDb(db);
    }
  });

  it('ends live streams and resolves app.close() during shutdown', async () => {
    const db = createTempDb('http-shutdown');
    const bus = new EventBus(db);
    const app = buildApp({ db, bus });
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const discussionId = insertDiscussion(db);
    const stream = await openSseStream(`${baseUrl}/api/discussions/${discussionId}/events`);

    await waitFor(() => stream.text().includes('event: caught_up'));
    expect(bus.subscriberCount(discussionId)).toBe(1);

    try {
      const closing = app.close();
      await Promise.race([
        closing,
        sleep(2000).then(() => {
          throw new Error('app.close() hung while an SSE client was connected');
        }),
      ]);
      await stream.done;
      expect(bus.totalSubscriberCount()).toBe(0);
    } finally {
      stream.controller.abort();
      await stream.done;
      disposeTempDb(db);
    }
  });

  it('answers 404 with JSON and never opens a stream for an unknown discussion', async () => {    const db = createTempDb('http-404');
    const bus = new EventBus(db);
    const app = buildApp({ db, bus });
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

    try {
      const response = await fetch(`${baseUrl}/api/discussions/999999/events`);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({
        code: 'DISCUSSION_NOT_FOUND',
        message: '讨论不存在',
      });
    } finally {
      await app.close();
      disposeTempDb(db);
    }
  });
});
