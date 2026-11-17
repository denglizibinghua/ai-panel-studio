import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agentStateSchema,
  colorIdValues,
  discussionStatusValues,
  eventPayloadSchemaByType,
  eventPrefixValues,
  eventTypeSchema,
  eventTypeValues,
  pointStatusSchema,
  speechTypeValues,
  turnSchema,
} from '@ai-panel/shared';
import { createDb, type Db } from '../src/db';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';

const TABLES = [
  'discussions',
  'guests',
  'turns',
  'events',
  'ledger',
  'consensus_points',
  'divergence_points',
  'agent_status',
  'llm_calls',
] as const;

const dataDir = path.resolve(__dirname, '../data');
const dbPath = path.join(dataDir, `test-seed-${process.pid}-${Date.now()}.db`);

let db: Db;

interface DiscussionRow {
  id: number;
  status: string;
  sample: number;
  expert_count: number;
  summary_text: string | null;
  last_event_seq: number;
}

interface GuestRow {
  discussion_id: number;
  id: number;
  role: string;
  color_id: string;
  speaking_order: number;
  locked: number;
}

interface TurnRow {
  id: number;
  discussion_id: number;
  guest_id: number;
  turn_no: number;
  speech_type: string;
  content: string;
  created_at: string;
}

interface PointRow {
  discussion_id: number;
  text: string;
  status: string;
  updated_seq: number;
}

interface EventRow {
  discussion_id: number;
  seq: number;
  type: string;
  payload: string;
}

interface AgentStatusRow {
  discussion_id: number;
  guest_id: number;
  state: string;
  updated_seq: number;
}

function countRows(table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get());
}

function all<T>(sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const list = groups.get(groupKey);
    if (list === undefined) {
      groups.set(groupKey, [row]);
    } else {
      list.push(row);
    }
  }
  return groups;
}

beforeAll(() => {
  db = createDb(dbPath);
  migrate(db);
  seed(db);
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe('migrations and seed', () => {
  it('creates exactly the 9 contract tables', () => {
    const rows = all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'",
    );
    expect(rows.map((row) => row.name).sort()).toEqual([...TABLES].sort());
  });

  it('seeds 5 sample discussions, 25 guests and 5 hosts', () => {
    const discussions = all<DiscussionRow>('SELECT id, status, sample, expert_count, summary_text, last_event_seq FROM discussions');
    expect(discussions).toHaveLength(5);
    expect(discussions.every((row) => row.sample === 1)).toBe(true);
    expect(discussions.every((row) => row.expert_count === 4)).toBe(true);

    const statuses = discussions.map((row) => row.status).sort();
    expect(statuses).toEqual(['draft', 'finished', 'finished', 'finished', 'ready']);

    const guests = all<GuestRow>('SELECT id, discussion_id, role, color_id, speaking_order, locked FROM guests');
    expect(guests).toHaveLength(25);
    expect(guests.filter((row) => row.role === 'host')).toHaveLength(5);
    expect(guests.filter((row) => row.role === 'expert')).toHaveLength(20);
    // draft 场阵容待确认：locked=0；其余 4 场已确认：locked=1（data-model §6）
    expect(guests.filter((row) => row.locked === 1)).toHaveLength(20);
    expect(guests.filter((row) => row.locked === 0)).toHaveLength(5);
    expect(new Set(guests.map((row) => row.color_id)).size).toBe(10);

    const perDiscussion = groupBy(guests, (row) => row.discussion_id);
    for (const rows of perDiscussion.values()) {
      expect(rows).toHaveLength(5);
      expect(rows.filter((row) => row.role === 'host')).toHaveLength(1);
      expect(new Set(rows.map((row) => row.speaking_order)).size).toBe(5);
    }
  });

  it('is idempotent on repeated seed runs', () => {
    const before = TABLES.map((table) => countRows(table));
    seed(db);
    const after = TABLES.map((table) => countRows(table));
    expect(after).toEqual(before);
    expect(countRows('discussions')).toBe(5);
    expect(countRows('guests')).toBe(25);
  });

  it('keeps 8-12 contiguous turns per finished discussion with >= 3 speech types', () => {
    const turns = all<TurnRow>('SELECT id, discussion_id, guest_id, turn_no, speech_type, content, created_at FROM turns');
    const discussions = all<DiscussionRow>('SELECT id, status, sample, expert_count, summary_text, last_event_seq FROM discussions');
    const perDiscussion = groupBy(turns, (row) => row.discussion_id);
    // 只有 finished 场有 transcript；draft / ready 必须 0 条（data-model §6）
    expect(perDiscussion.size).toBe(3);
    const finishedIds = new Set(
      discussions.filter((row) => row.status === 'finished').map((row) => row.id),
    );
    for (const [discussionId, rows] of perDiscussion) {
      expect(finishedIds.has(discussionId)).toBe(true);
      expect(rows.length).toBeGreaterThanOrEqual(8);
      expect(rows.length).toBeLessThanOrEqual(12);
      const sorted = [...rows].sort((a, b) => a.turn_no - b.turn_no);
      expect(sorted.map((row) => row.turn_no)).toEqual(sorted.map((_, index) => index + 1));
      expect(new Set(rows.map((row) => row.speech_type)).size).toBeGreaterThanOrEqual(3);
      for (const row of rows) {
        expect(turnSchema.safeParse(row).success).toBe(true);
      }
    }
    for (const discussion of discussions) {
      if (discussion.status !== 'finished') {
        expect(perDiscussion.get(discussion.id)).toBeUndefined();
      }
    }
  });

  it('has exactly one 150-250 char summary turn per finished discussion', () => {
    const discussions = all<DiscussionRow>('SELECT id, status, sample, expert_count, summary_text, last_event_seq FROM discussions');
    const turns = all<TurnRow>('SELECT id, discussion_id, guest_id, turn_no, speech_type, content, created_at FROM turns');
    const byDiscussion = groupBy(turns, (row) => row.discussion_id);
    for (const discussion of discussions) {
      const summaries = (byDiscussion.get(discussion.id) ?? []).filter(
        (row) => row.speech_type === 'summary',
      );
      if (discussion.status === 'finished') {
        expect(summaries).toHaveLength(1);
        const summary = summaries[0];
        if (summary === undefined || discussion.summary_text === null) {
          throw new Error('missing summary');
        }
        expect(summary.content).toBe(discussion.summary_text);
        expect(summary.content.length).toBeGreaterThanOrEqual(150);
        expect(summary.content.length).toBeLessThanOrEqual(250);
      } else {
        expect(summaries).toHaveLength(0);
        expect(discussion.summary_text).toBeNull();
      }
    }
  });

  it('writes 2 consensus + 2 divergence points per discussion with real updated_seq', () => {
    const events = all<EventRow>('SELECT discussion_id, seq, type, payload FROM events');
    const seqsByDiscussion = new Map<number, Set<number>>();
    for (const event of events) {
      const set = seqsByDiscussion.get(event.discussion_id) ?? new Set<number>();
      set.add(event.seq);
      seqsByDiscussion.set(event.discussion_id, set);
    }

    const discussions = all<DiscussionRow>('SELECT id, status, sample, expert_count, summary_text, last_event_seq FROM discussions');
    const statusById = new Map(discussions.map((row) => [row.id, row.status]));

    for (const table of ['consensus_points', 'divergence_points']) {
      const points = all<PointRow>(`SELECT discussion_id, text, status, updated_seq FROM ${table}`);
      // 只有 3 场 finished 有共识/分歧（data-model §6）
      expect(points).toHaveLength(6);
      const perDiscussion = groupBy(points, (row) => row.discussion_id);
      expect(perDiscussion.size).toBe(3);
      for (const [discussionId, rows] of perDiscussion) {
        expect(rows).toHaveLength(2);
        expect(statusById.get(discussionId)).toBe('finished');
        for (const row of rows) {
          expect(pointStatusSchema.safeParse(row.status).success).toBe(true);
          expect(row.status).toBe('final');
          expect(seqsByDiscussion.get(discussionId)?.has(row.updated_seq)).toBe(true);
        }
      }
    }
  });

  it('produces replayable events: contiguous seq, whitelisted types, valid payloads', () => {
    const discussions = all<DiscussionRow>('SELECT id, status, sample, expert_count, summary_text, last_event_seq FROM discussions');
    const events = all<EventRow>('SELECT discussion_id, seq, type, payload FROM events');
    const perDiscussion = groupBy(events, (row) => row.discussion_id);

    for (const discussion of discussions) {
      const rows = [...(perDiscussion.get(discussion.id) ?? [])].sort((a, b) => a.seq - b.seq);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((row) => row.seq)).toEqual(rows.map((_, index) => index + 1));
      expect(discussion.last_event_seq).toBe(rows.length);

      for (const row of rows) {
        const type = eventTypeSchema.safeParse(row.type);
        expect(type.success).toBe(true);
        if (!type.success) {
          continue;
        }
        expect(eventPrefixValues.some((prefix) => row.type.startsWith(prefix))).toBe(true);
        expect(row.payload.length).toBeLessThanOrEqual(4096);
        const payload: unknown = JSON.parse(row.payload);
        expect(eventPayloadSchemaByType[type.data].safeParse(payload).success).toBe(true);
      }

      const types = new Set(rows.map((row) => row.type));
      if (discussion.status === 'finished') {
        expect(types.has('state.running')).toBe(true);
        expect(types.has('run.started')).toBe(true);
        expect(types.has('state.finished')).toBe(true);
        expect(types.has('run.finished')).toBe(true);
        expect(types.has('consensus.updated')).toBe(true);
        expect(types.has('divergence.updated')).toBe(true);
        expect(types.has('turn.started')).toBe(true);
        expect(types.has('turn.done')).toBe(true);
        expect(types.has('consensus.added')).toBe(true);
        expect(types.has('divergence.added')).toBe(true);
      }
      if (discussion.status === 'ready') {
        expect(types.has('state.ready')).toBe(true);
        expect(types.has('agent.status')).toBe(true);
        // 未开始：不得有 run.* / turn.*
        expect(types.has('run.started')).toBe(false);
        expect(types.has('turn.started')).toBe(false);
      }
      if (discussion.status === 'draft') {
        expect(types.has('state.ready')).toBe(false);
        expect(types.has('agent.status')).toBe(false);
        expect(types.has('turn.started')).toBe(false);
      }
    }
  });

  it('has one agent_status row and one agent.status event per guest', () => {
    const guests = all<{ id: number; discussion_id: number }>('SELECT id, discussion_id FROM guests');
    const statuses = all<AgentStatusRow>('SELECT discussion_id, guest_id, state, updated_seq FROM agent_status');
    const events = all<EventRow>('SELECT discussion_id, seq, type, payload FROM events');

    // draft 场不建 agent_status（AC-1.7 只在 confirm 时建）：4 场 × 5 人 = 20
    expect(statuses).toHaveLength(20);
    const draftIds = new Set(
      all<DiscussionRow>('SELECT id, status, sample, expert_count, summary_text, last_event_seq FROM discussions')
        .filter((row) => row.status === 'draft')
        .map((row) => row.id),
    );
    const statusByGuest = new Map(statuses.map((row) => [`${row.discussion_id}:${row.guest_id}`, row]));
    const seqsByDiscussion = new Map<number, Set<number>>();
    const agentEvents = new Map<string, number>();
    for (const event of events) {
      const set = seqsByDiscussion.get(event.discussion_id) ?? new Set<number>();
      set.add(event.seq);
      seqsByDiscussion.set(event.discussion_id, set);
      if (event.type === 'agent.status') {
        const payload = JSON.parse(event.payload) as { guest_id?: number };
        if (typeof payload.guest_id === 'number') {
          const key = `${event.discussion_id}:${payload.guest_id}`;
          agentEvents.set(key, (agentEvents.get(key) ?? 0) + 1);
        }
      }
    }

    for (const guest of guests) {
      const key = `${guest.discussion_id}:${guest.id}`;
      const status = statusByGuest.get(key);
      if (draftIds.has(guest.discussion_id)) {
        expect(status).toBeUndefined();
        expect(agentEvents.get(key)).toBeUndefined();
        continue;
      }
      expect(status).toBeDefined();
      if (status === undefined) {
        continue;
      }
      expect(agentStateSchema.safeParse(status.state).success).toBe(true);
      expect(status.updated_seq).toBeGreaterThan(0);
      expect(seqsByDiscussion.get(guest.discussion_id)?.has(status.updated_seq)).toBe(true);
      expect(agentEvents.get(key)).toBe(1);
    }
  });

  it('keeps the shared enums at the contract sizes', () => {
    expect(discussionStatusValues).toHaveLength(7);
    expect(colorIdValues).toHaveLength(10);
    expect(speechTypeValues).toHaveLength(6);
    expect(eventPrefixValues).toHaveLength(6);
    expect(eventTypeValues).toHaveLength(19);
  });
});
