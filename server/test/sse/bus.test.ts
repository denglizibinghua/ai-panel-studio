import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db';
import { EventBus, normalizeLastEventId, type EventBusOptions } from '../../src/modules/sse/bus';
import { PublishError } from '../../src/modules/sse/publish';
import {
  createTempDb,
  disposeTempDb,
  FakeSink,
  insertDiscussion,
  parseFrames,
  removeTempFiles,
  sleep,
  type ParsedFrame,
} from './helpers';

afterAll(removeTempFiles);

async function withBus(
  label: string,
  options: EventBusOptions,
  body: (db: Db, bus: EventBus) => Promise<void> | void,
): Promise<void> {
  const db = createTempDb(label);
  const bus = new EventBus(db, options);
  try {
    await body(db, bus);
  } finally {
    bus.closeAll();
    disposeTempDb(db);
  }
}

function persisted(frames: ParsedFrame[]): ParsedFrame[] {
  return frames.filter((frame) => frame.id !== null);
}

function caughtUp(frames: ParsedFrame[]): ParsedFrame[] {
  return frames.filter((frame) => frame.event === 'caught_up');
}

function agentPayload(guestId: number, focus: string | null): Record<string, unknown> {
  return { guest_id: guestId, state: 'idle', focus };
}

function eventCount(db: Db, discussionId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM events WHERE discussion_id = ?')
    .get(discussionId) as { count: number };
  return row.count;
}

describe('EventBus', () => {
  it('keeps two concurrent discussions fully isolated', async () => {
    await withBus('bus-isolation', {}, (db, bus) => {
      const discussionA = insertDiscussion(db, { topic: '讨论 A' });
      const discussionB = insertDiscussion(db, { topic: '讨论 B' });
      const sinkA = new FakeSink();
      const sinkB = new FakeSink();

      bus.subscribe(discussionA, 0, sinkA);
      bus.subscribe(discussionB, 0, sinkB);

      // caught_up reflects the sequence at subscribe time: still zero.
      expect(caughtUp(parseFrames(sinkA.text))[0]?.data).toBe('{"up_to_seq":0}');

      for (let index = 1; index <= 5; index += 1) {
        bus.publish(discussionA, 'agent.status', agentPayload(index, `A-${index}`));
      }
      for (let index = 1; index <= 5; index += 1) {
        bus.publish(discussionB, 'agent.status', agentPayload(index, `B-${index}`));
      }

      const framesA = parseFrames(sinkA.text);
      const framesB = parseFrames(sinkB.text);
      const persistedA = persisted(framesA);
      const persistedB = persisted(framesB);

      expect(persistedA.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5]);
      expect(persistedB.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5]);

      expect(persistedA.every((frame) => frame.data?.includes('"A-'))).toBe(true);
      expect(persistedA.some((frame) => frame.data?.includes('"B-'))).toBe(false);
      expect(persistedB.every((frame) => frame.data?.includes('"B-'))).toBe(true);
      expect(persistedB.some((frame) => frame.data?.includes('"A-'))).toBe(false);

      expect(caughtUp(framesA)).toHaveLength(1);
      expect(caughtUp(framesB)).toHaveLength(1);
    });
  });

  it('replays strictly seq > Last-Event-ID and then sends caught_up', async () => {
    await withBus('bus-replay', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);

      for (let index = 1; index <= 5; index += 1) {
        bus.publish(discussionId, 'agent.status', agentPayload(index, `focus-${index}`));
      }

      const sink = new FakeSink();
      bus.subscribe(discussionId, 3, sink);

      const frames = parseFrames(sink.text);
      const replay = persisted(frames);

      expect(replay.map((frame) => frame.id)).toEqual([4, 5]);
      expect(replay.some((frame) => frame.id === 3)).toBe(false);
      expect(replay.every((frame) => frame.event === 'agent.status')).toBe(true);

      const tail = frames[frames.length - 1];
      expect(tail?.event).toBe('caught_up');
      expect(tail?.id).toBeNull();
      expect(tail?.data).toBe('{"up_to_seq":5}');
    });
  });

  it('replays everything for k=0 and nothing for k >= last_event_seq', async () => {
    await withBus('bus-replay-bounds', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);
      for (let index = 1; index <= 4; index += 1) {
        bus.publish(discussionId, 'agent.status', agentPayload(index, null));
      }

      const fromZero = new FakeSink();
      bus.subscribe(discussionId, '0', fromZero);
      expect(persisted(parseFrames(fromZero.text)).map((frame) => frame.id)).toEqual([
        1, 2, 3, 4,
      ]);

      const fromBeyond = new FakeSink();
      bus.subscribe(discussionId, 4, fromBeyond);
      const beyondFrames = parseFrames(fromBeyond.text);
      expect(persisted(beyondFrames)).toHaveLength(0);
      expect(caughtUp(beyondFrames)[0]?.data).toBe('{"up_to_seq":4}');

      const garbage = new FakeSink();
      bus.subscribe(discussionId, 'not-a-number', garbage);
      expect(persisted(parseFrames(garbage.text))).toHaveLength(4);
    });
  });

  it('removes the subscriber and stops the heartbeat after close', async () => {
    await withBus('bus-cleanup', { heartbeatMs: 20 }, async (db, bus) => {
      const discussionId = insertDiscussion(db);
      const sink = new FakeSink();

      bus.subscribe(discussionId, 0, sink);
      expect(bus.subscriberCount(discussionId)).toBe(1);

      await sleep(90);
      expect(sink.pingCount).toBeGreaterThanOrEqual(2);
      expect(sink.text).toContain(': ping\n\n');

      sink.emit('close');
      expect(bus.subscriberCount(discussionId)).toBe(0);
      expect(bus.totalSubscriberCount()).toBe(0);

      const pingsAtClose = sink.pingCount;
      await sleep(90);
      expect(sink.pingCount).toBe(pingsAtClose);
    });
  });

  it('cleans up when the sink fails mid-stream', async () => {
    await withBus('bus-write-error', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);
      let writes = 0;
      const failing = {
        write(): boolean {
          writes += 1;
          if (writes > 1) {
            throw new Error('socket closed');
          }
          return true;
        },
        on(): unknown {
          return undefined;
        },
      };

      bus.subscribe(discussionId, 0, failing);
      expect(bus.subscriberCount(discussionId)).toBe(1);

      bus.publish(discussionId, 'agent.status', agentPayload(1, 'boom'));
      expect(bus.subscriberCount(discussionId)).toBe(0);
    });
  });

  it('publishes turn.delta without an id and without touching the events table', async () => {
    await withBus('bus-ephemeral', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);
      const sink = new FakeSink();
      bus.subscribe(discussionId, 0, sink);

      const rowsBefore = eventCount(db, discussionId);
      bus.publishEphemeral(discussionId, 'turn.delta', {
        guest_id: 1,
        turn_no: 1,
        delta: '我认为',
      });

      const frames = parseFrames(sink.text);
      const deltaFrames = frames.filter((frame) => frame.event === 'turn.delta');
      expect(deltaFrames).toHaveLength(1);
      expect(deltaFrames[0]?.id).toBeNull();
      expect(deltaFrames[0]?.data).toBe('{"guest_id":1,"turn_no":1,"delta":"我认为"}');
      expect(eventCount(db, discussionId)).toBe(rowsBefore);
    });
  });

  it('rejects every non-turn.delta type on the ephemeral path', async () => {
    await withBus('bus-ephemeral-whitelist', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);
      const sink = new FakeSink();
      bus.subscribe(discussionId, 0, sink);

      expect(() =>
        bus.publishEphemeral(discussionId, 'turn.done', {
          guest_id: 1,
          turn_no: 1,
          speech_type: 'challenge',
          content: '不该走易失通道',
          created_at: '2026-11-17T08:00:00.000Z',
        }),
      ).toThrow(PublishError);

      try {
        bus.publishEphemeral(discussionId, 'agent.status', agentPayload(1, 'nope'));
      } catch (error) {
        expect(error instanceof PublishError ? error.code : null).toBe(
          'EPHEMERAL_TYPE_NOT_ALLOWED',
        );
      }

      expect(parseFrames(sink.text).some((frame) => frame.event === 'turn.done')).toBe(false);
      expect(eventCount(db, discussionId)).toBe(0);
    });
  });

  it('refuses to persist turn.delta through publish (seq pollution guard)', async () => {
    await withBus('bus-delta-guard', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);

      try {
        bus.publish(discussionId, 'turn.delta', { guest_id: 1, turn_no: 1, delta: '半句' });
        throw new Error('publish must reject turn.delta');
      } catch (error) {
        expect(error instanceof PublishError ? error.code : null).toBe(
          'TURN_DELTA_NOT_PERSISTED',
        );
      }

      expect(eventCount(db, discussionId)).toBe(0);
      const discussion = db
        .prepare('SELECT last_event_seq FROM discussions WHERE id = ?')
        .get(discussionId) as { last_event_seq: number };
      expect(discussion.last_event_seq).toBe(0);
    });
  });

  it('rejects invalid payloads and unknown discussions without writing', async () => {
    await withBus('bus-validation', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);

      expect(() =>
        bus.publish(discussionId, 'agent.status', {
          guest_id: 1,
          state: 'thinking',
          focus: null,
        }),
      ).toThrow(PublishError);

      try {
        bus.publish(999_999, 'agent.status', agentPayload(1, null));
      } catch (error) {
        expect(error instanceof PublishError ? error.code : null).toBe('DISCUSSION_NOT_FOUND');
      }

      expect(eventCount(db, discussionId)).toBe(0);
    });
  });

  it('refuses to publish inside a caller transaction (push-before-commit guard)', async () => {
    await withBus('bus-nested-publish', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);
      const sink = new FakeSink();
      bus.subscribe(discussionId, 0, sink);
      const framesBefore = persisted(parseFrames(sink.text)).length;

      const outer = db.transaction(() => {
        bus.publish(discussionId, 'agent.status', agentPayload(1, 'inside'));
      });

      try {
        outer.immediate();
        throw new Error('publish must refuse a nested transaction');
      } catch (error) {
        expect(error instanceof PublishError ? error.code : null).toBe(
          'PUBLISH_INSIDE_TRANSACTION',
        );
      }

      expect(eventCount(db, discussionId)).toBe(0);
      const discussion = db
        .prepare('SELECT last_event_seq FROM discussions WHERE id = ?')
        .get(discussionId) as { last_event_seq: number };
      expect(discussion.last_event_seq).toBe(0);
      expect(persisted(parseFrames(sink.text))).toHaveLength(framesBefore);
    });
  });

  it('rejects payloads whose value contradicts the event type', async () => {
    await withBus('bus-type-invariants', {}, (db, bus) => {
      const discussionId = insertDiscussion(db);
      const iso = '2026-11-17T08:00:00.000Z';

      expect(() =>
        bus.publish(discussionId, 'state.ready', {
          status: 'running',
          previous_status: 'draft',
          updated_at: iso,
        }),
      ).toThrow(PublishError);

      expect(() =>
        bus.publish(discussionId, 'consensus.added', {
          point_id: 1,
          text: '一句话共识',
          status: 'final',
          support_guest_ids: [],
          round_no: 1,
        }),
      ).toThrow(PublishError);

      expect(() =>
        bus.publish(discussionId, 'divergence.updated', {
          point_id: 1,
          text: '一句话分歧',
          status: 'provisional',
          support_guest_ids: [],
          round_no: 1,
        }),
      ).toThrow(PublishError);

      expect(eventCount(db, discussionId)).toBe(0);
    });
  });

  it('normalizes malformed Last-Event-ID to zero', () => {
    expect(normalizeLastEventId(undefined)).toBe(0);
    expect(normalizeLastEventId(null)).toBe(0);
    expect(normalizeLastEventId(-3)).toBe(0);
    expect(normalizeLastEventId('abc')).toBe(0);
    expect(normalizeLastEventId('3')).toBe(3);
    expect(normalizeLastEventId(3)).toBe(3);
  });
});
