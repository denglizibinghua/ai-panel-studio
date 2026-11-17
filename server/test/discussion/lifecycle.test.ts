import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db';
import { buildApp } from '../../src/app';
import { EventBus } from '../../src/modules/sse/bus';
import {
  createScriptedLlm,
  createTempDb,
  insertDiscussion,
  removeTempFiles,
  seedReadyDiscussion,
  speakLedger,
} from './harness';

const dbs: Db[] = [];

function setup(label: string): { db: Db; app: ReturnType<typeof buildApp> } {
  const db = createTempDb(`${label}-lifecycle`);
  dbs.push(db);
  const bus = new EventBus(db);
  const llm = createScriptedLlm(db, {
    ledger: () => speakLedger('专家1号'),
    speech: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return '这只是测试发言，成本下降不等于体验提升。';
    },
  });
  const app = buildApp({ db, bus, llm: llm.client });
  return { db, app };
}

afterAll(() => {
  for (const db of dbs.splice(0)) {
    db.close();
  }
  removeTempFiles();
});

describe('POST /api/discussions', () => {
  it('creates a draft and writes state.draft at seq=1 with previous_status=null', async () => {
    const { db, app } = setup('create');

    const response = await app.inject({
      method: 'POST',
      url: '/api/discussions',
      payload: { topic: 'AI 会取代初级程序员吗？', expert_count: 4, session_id: 'abc123' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('draft');
    expect(body.expert_count).toBe(4);
    expect(body.last_event_seq).toBe(1);
    expect(body.guests).toEqual([]);

    const event = db
      .prepare('SELECT seq, type, payload FROM events WHERE discussion_id = ?')
      .get(body.id) as { seq: number; type: string; payload: string };
    expect(event.type).toBe('state.draft');
    expect(event.seq).toBe(1);
    expect(JSON.parse(event.payload)).toMatchObject({
      status: 'draft',
      previous_status: null,
    });

    await app.close();
  });

  it('rejects an empty topic / out-of-range expert_count without writing a row', async () => {
    const { db, app } = setup('create-invalid');
    const before = (db.prepare('SELECT COUNT(*) AS c FROM discussions').get() as { c: number }).c;

    const empty = await app.inject({
      method: 'POST',
      url: '/api/discussions',
      payload: { topic: '', expert_count: 4 },
    });
    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/discussions',
      payload: { topic: '合法议题', expert_count: 9 },
    });

    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe('INVALID_INPUT');
    expect(tooMany.statusCode).toBe(400);
    expect((db.prepare('SELECT COUNT(*) AS c FROM discussions').get() as { c: number }).c).toBe(
      before,
    );

    await app.close();
  });
});

describe('GET /api/discussions', () => {
  it('lists by updated_at DESC and filters active=1 to draft/generating/ready/running', async () => {
    const { db, app } = setup('list');
    const finishedId = insertDiscussion(db, { topic: '旧讨论', status: 'finished' });
    const runningId = insertDiscussion(db, { topic: '进行中的讨论', status: 'running' });
    db.prepare("UPDATE discussions SET updated_at = '2026-11-17T00:00:01.000Z' WHERE id = ?").run(
      finishedId,
    );
    db.prepare("UPDATE discussions SET updated_at = '2026-11-17T00:00:02.000Z' WHERE id = ?").run(
      runningId,
    );

    const all = await app.inject({ method: 'GET', url: '/api/discussions' });
    expect(all.statusCode).toBe(200);
    expect(all.json().map((row: { id: number }) => row.id)).toEqual([runningId, finishedId]);

    const active = await app.inject({ method: 'GET', url: '/api/discussions?active=1' });
    expect(active.json().map((row: { id: number }) => row.id)).toEqual([runningId]);

    const invalid = await app.inject({ method: 'GET', url: '/api/discussions?active=2' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('INVALID_INPUT');

    await app.close();
  });
});

describe('GET /api/discussions/:id', () => {
  it('returns the discussion with guests but never turns / agent_status', async () => {
    const { db, app } = setup('detail');
    const seed = seedReadyDiscussion(db, { expertCount: 3 });

    const response = await app.inject({ method: 'GET', url: `/api/discussions/${seed.discussionId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ready');
    expect(body.guests).toHaveLength(4);
    expect(body).not.toHaveProperty('turns');
    expect(body).not.toHaveProperty('agent_status');
    expect(body).not.toHaveProperty('consensus_points');
    expect(body).not.toHaveProperty('ledger');

    const missing = await app.inject({ method: 'GET', url: '/api/discussions/9999' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('DISCUSSION_NOT_FOUND');

    await app.close();
  });
});

describe('POST /api/discussions/:id/start', () => {
  it('rejects a draft discussion with 409 INVALID_STATE_TRANSITION', async () => {
    const { db, app } = setup('start-draft');
    const id = insertDiscussion(db, { status: 'draft' });

    const response = await app.inject({ method: 'POST', url: `/api/discussions/${id}/start` });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_STATE_TRANSITION');

    const row = db.prepare('SELECT status FROM discussions WHERE id = ?').get(id) as {
      status: string;
    };
    expect(row.status).toBe('draft');

    await app.close();
  });

  it('rejects a fourth running discussion with 409 TOO_MANY_RUNNING', async () => {
    const { db, app } = setup('start-limit');
    for (let index = 0; index < 3; index += 1) {
      insertDiscussion(db, { status: 'running', topic: `占用中的讨论${index}` });
    }
    const seed = seedReadyDiscussion(db);

    const response = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/start`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('TOO_MANY_RUNNING');

    const row = db
      .prepare('SELECT status FROM discussions WHERE id = ?')
      .get(seed.discussionId) as { status: string };
    expect(row.status).toBe('ready');

    await app.close();
  });

  it('returns 404 / 409 before 500 when the key is missing', async () => {
    const db = createTempDb('start-nokey');
    dbs.push(db);
    const app = buildApp({ db, bus: new EventBus(db) });
    const original = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const missing = await app.inject({ method: 'POST', url: '/api/discussions/9999/start' });
      expect(missing.statusCode).toBe(404);

      const draftId = insertDiscussion(db, { status: 'draft' });
      const draft = await app.inject({
        method: 'POST',
        url: `/api/discussions/${draftId}/start`,
      });
      expect(draft.statusCode).toBe(409);
      expect(draft.json().code).toBe('INVALID_STATE_TRANSITION');

      const seed = seedReadyDiscussion(db);
      const ready = await app.inject({
        method: 'POST',
        url: `/api/discussions/${seed.discussionId}/start`,
      });
      expect(ready.statusCode).toBe(500);
      expect(ready.json().code).toBe('LLM_NOT_CONFIGURED');
    } finally {
      if (original !== undefined) {
        process.env.DEEPSEEK_API_KEY = original;
      }
      await app.close();
    }
  });

  it('commits state.running + run.started before responding and moves to running', async () => {
    const { db, app } = setup('start-ready');
    const seed = seedReadyDiscussion(db);

    const response = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/start`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('running');
    expect(typeof body.started_at).toBe('string');

    const types = db
      .prepare('SELECT type FROM events WHERE discussion_id = ? ORDER BY seq ASC')
      .all(seed.discussionId) as { type: string }[];
    expect(types.map((row) => row.type)).toContain('state.running');
    expect(types.map((row) => row.type)).toContain('run.started');

    const row = db
      .prepare('SELECT status, started_at FROM discussions WHERE id = ?')
      .get(seed.discussionId) as { status: string; started_at: string };
    expect(row.status).toBe('running');
    expect(row.started_at).toBe(body.started_at);

    // Cancel so the async runner cannot outlive the test database.
    await app.inject({ method: 'POST', url: `/api/discussions/${seed.discussionId}/cancel` });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await app.close();
  });
});

describe('POST /api/discussions/:id/cancel', () => {
  it('moves ready to cancelled with error_code NULL and both terminal events', async () => {
    const { db, app } = setup('cancel-ready');
    const seed = seedReadyDiscussion(db);

    const response = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/cancel`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: seed.discussionId,
      status: 'cancelled',
      error_code: null,
    });

    const row = db
      .prepare('SELECT status, finished_at, error_code FROM discussions WHERE id = ?')
      .get(seed.discussionId) as {
      status: string;
      finished_at: string | null;
      error_code: string | null;
    };
    expect(row.status).toBe('cancelled');
    expect(row.finished_at).not.toBeNull();
    expect(row.error_code).toBeNull();

    const types = db
      .prepare('SELECT type FROM events WHERE discussion_id = ? ORDER BY seq ASC')
      .all(seed.discussionId) as { type: string }[];
    expect(types.map((row) => row.type)).toContain('state.cancelled');
    expect(types.map((row) => row.type)).toContain('run.cancelled');
    expect(types.map((row) => row.type)).not.toContain('run.failed');

    await app.close();
  });

  it('rejects cancelling a terminal discussion with 409 INVALID_STATE_TRANSITION', async () => {
    const { db, app } = setup('cancel-terminal');
    const id = insertDiscussion(db, { status: 'finished' });

    const response = await app.inject({ method: 'POST', url: `/api/discussions/${id}/cancel` });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_STATE_TRANSITION');

    const row = db.prepare('SELECT status FROM discussions WHERE id = ?').get(id) as {
      status: string;
    };
    expect(row.status).toBe('finished');

    await app.close();
  });
});
