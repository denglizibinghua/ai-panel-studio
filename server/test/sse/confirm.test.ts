import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import type { Db } from '../../src/db';
import { EventBus } from '../../src/modules/sse/bus';
import { statePayloadSchema } from '@ai-panel/shared';
import {
  createTempDb,
  disposeTempDb,
  FakeSink,
  insertDiscussion,
  insertFullLineup,
  parseFrames,
  removeTempFiles,
} from './helpers';

afterAll(removeTempFiles);

interface ConfirmHarness {
  db: Db;
  app: ReturnType<typeof buildApp>;
  bus: EventBus;
}

function createHarness(label: string): ConfirmHarness {
  const db = createTempDb(label);
  const bus = new EventBus(db);
  const app = buildApp({ db, bus });
  return { db, app, bus };
}

function confirmUrl(discussionId: number): string {
  return `/api/discussions/${discussionId}/guests/confirm`;
}

describe('POST /api/discussions/:id/guests/confirm', () => {
  it('locks the lineup and writes one idle agent.status event per guest', async () => {
    const harness = createHarness('confirm-ok');
    try {
      const discussionId = insertDiscussion(harness.db, { expertCount: 4 });
      const guestIds = insertFullLineup(harness.db, discussionId, 4, 0);

      const response = await harness.app.inject({
        method: 'POST',
        url: confirmUrl(discussionId),
      });
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        discussion_id: number;
        status: string;
        guests: { id: number; locked: boolean }[];
      };
      expect(body.discussion_id).toBe(discussionId);
      expect(body.status).toBe('ready');
      expect(body.guests).toHaveLength(5);
      expect(body.guests.map((guest) => guest.id).sort((a, b) => a - b)).toEqual(
        [...guestIds].sort((a, b) => a - b),
      );
      expect(body.guests.every((guest) => guest.locked)).toBe(true);

      const guestRows = harness.db
        .prepare('SELECT id, locked FROM guests WHERE discussion_id = ?')
        .all(discussionId) as { id: number; locked: number }[];
      expect(guestRows).toHaveLength(5);
      expect(guestRows.every((row) => row.locked === 1)).toBe(true);

      const agentRows = harness.db
        .prepare(
          `SELECT guest_id, state, focus, updated_seq
             FROM agent_status WHERE discussion_id = ? ORDER BY guest_id`,
        )
        .all(discussionId) as {
        guest_id: number;
        state: string;
        focus: string | null;
        updated_seq: number;
      }[];
      expect(agentRows).toHaveLength(5);
      expect(new Set(agentRows.map((row) => row.guest_id)).size).toBe(5);
      expect(agentRows.every((row) => row.state === 'idle')).toBe(true);
      expect(agentRows.every((row) => row.focus === null)).toBe(true);
      expect(agentRows.every((row) => row.updated_seq > 0)).toBe(true);
      expect(new Set(agentRows.map((row) => row.updated_seq)).size).toBe(5);

      const events = harness.db
        .prepare(
          `SELECT seq, type, payload FROM events
            WHERE discussion_id = ? ORDER BY seq ASC`,
        )
        .all(discussionId) as { seq: number; type: string; payload: string }[];
      expect(events).toHaveLength(6);
      expect(events.slice(0, 5).every((event) => event.type === 'agent.status')).toBe(true);
      expect(events[5]?.type).toBe('state.ready');

      for (const row of agentRows) {
        const event = events.find((candidate) => candidate.seq === row.updated_seq);
        expect(event).toBeDefined();
        expect(event?.type).toBe('agent.status');
        const payload = JSON.parse(event?.payload ?? '{}') as {
          guest_id: number;
          state: string;
          focus: string | null;
        };
        expect(payload.guest_id).toBe(row.guest_id);
        expect(payload.state).toBe('idle');
        expect(payload.focus).toBeNull();
      }

      const readyPayload = statePayloadSchema.parse(JSON.parse(events[5]?.payload ?? '{}'));
      expect(readyPayload.status).toBe('ready');
      expect(readyPayload.previous_status).toBe('draft');
      expect(readyPayload.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const discussion = harness.db
        .prepare('SELECT status, last_event_seq FROM discussions WHERE id = ?')
        .get(discussionId) as { status: string; last_event_seq: number };
      expect(discussion.status).toBe('ready');
      expect(discussion.last_event_seq).toBe(6);
    } finally {
      await harness.app.close();
      disposeTempDb(harness.db);
    }
  });

  it('rejects a lineup whose row count != expert_count + 1 without any side effect', async () => {
    const harness = createHarness('confirm-mismatch');
    try {
      const discussionId = insertDiscussion(harness.db, { expertCount: 4 });
      insertFullLineup(harness.db, discussionId, 2, 0);

      const response = await harness.app.inject({
        method: 'POST',
        url: confirmUrl(discussionId),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'GUEST_COUNT_MISMATCH',
        message: '嘉宾数量与 expert_count 不匹配',
      });

      const guests = harness.db
        .prepare('SELECT locked FROM guests WHERE discussion_id = ?')
        .all(discussionId) as { locked: number }[];
      expect(guests.every((row) => row.locked === 0)).toBe(true);

      const agentCount = harness.db
        .prepare('SELECT COUNT(*) AS count FROM agent_status WHERE discussion_id = ?')
        .get(discussionId) as { count: number };
      expect(agentCount.count).toBe(0);

      const eventCount = harness.db
        .prepare('SELECT COUNT(*) AS count FROM events WHERE discussion_id = ?')
        .get(discussionId) as { count: number };
      expect(eventCount.count).toBe(0);

      const discussion = harness.db
        .prepare('SELECT status, last_event_seq FROM discussions WHERE id = ?')
        .get(discussionId) as { status: string; last_event_seq: number };
      expect(discussion.status).toBe('draft');
      expect(discussion.last_event_seq).toBe(0);
    } finally {
      await harness.app.close();
      disposeTempDb(harness.db);
    }
  });

  it('rejects a second confirm and a discussion with no guests', async () => {
    const harness = createHarness('confirm-state');
    try {
      const readyId = insertDiscussion(harness.db, { expertCount: 4, status: 'ready' });
      insertFullLineup(harness.db, readyId, 4, 0);
      const readyResponse = await harness.app.inject({
        method: 'POST',
        url: confirmUrl(readyId),
      });
      expect(readyResponse.statusCode).toBe(409);
      expect((readyResponse.json() as { code: string }).code).toBe('INVALID_STATE_TRANSITION');

      const emptyId = insertDiscussion(harness.db, { expertCount: 4 });
      const emptyResponse = await harness.app.inject({
        method: 'POST',
        url: confirmUrl(emptyId),
      });
      expect(emptyResponse.statusCode).toBe(409);
      // 0 行同样满足 AC-1.7b 的「行数 ≠ expert_count + 1」，不用另一个错误码开特例
      expect((emptyResponse.json() as { code: string }).code).toBe('GUEST_COUNT_MISMATCH');

      const missingResponse = await harness.app.inject({
        method: 'POST',
        url: confirmUrl(999_999),
      });
      expect(missingResponse.statusCode).toBe(404);
      expect((missingResponse.json() as { code: string }).code).toBe('DISCUSSION_NOT_FOUND');
    } finally {
      await harness.app.close();
      disposeTempDb(harness.db);
    }
  });

  it('pushes the agent.status and state.ready events to live subscribers', async () => {
    const harness = createHarness('confirm-broadcast');
    try {
      const discussionId = insertDiscussion(harness.db, { expertCount: 4 });
      insertFullLineup(harness.db, discussionId, 4, 0);
      const sink = new FakeSink();
      harness.bus.subscribe(discussionId, 0, sink);

      const response = await harness.app.inject({
        method: 'POST',
        url: confirmUrl(discussionId),
      });
      expect(response.statusCode).toBe(200);

      const frames = parseFrames(sink.text);
      const persisted = frames.filter((frame) => frame.id !== null);
      expect(persisted.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(persisted.filter((frame) => frame.event === 'agent.status')).toHaveLength(5);
      expect(persisted[5]?.event).toBe('state.ready');
      expect(frames[0]?.event).toBe('caught_up');
      expect(frames[0]?.data).toBe('{"up_to_seq":0}');
    } finally {
      await harness.app.close();
      disposeTempDb(harness.db);
    }
  });
});
