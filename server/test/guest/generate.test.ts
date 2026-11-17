import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { guestSchema } from '@ai-panel/shared';
import { buildApp } from '../../src/app';
import { createDb, type Db } from '../../src/db';
import { migrate } from '../../src/db/migrate';
import type { ChatJsonClient, ChatJsonRequest } from '../../src/llm/client';

const dataDir = path.resolve(__dirname, '../data');
const tempFiles: string[] = [];
const originalKey = process.env.DEEPSEEK_API_KEY;

beforeAll(() => {
  // HARD BLOCK: an accidental default-transport path must fail fast, never hit the network.
  delete process.env.DEEPSEEK_API_KEY;
});

afterAll(() => {
  if (originalKey === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = originalKey;
  }
  for (const file of tempFiles) {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${file}${suffix}`, { force: true });
    }
  }
});

const generateResponseSchema = z
  .object({
    discussion_id: z.number().int().positive(),
    status: z.literal('draft'),
    guests: z.array(guestSchema),
  })
  .strict();

const errorResponseSchema = z.object({ code: z.string(), message: z.string() }).strict();

interface GuestFixture {
  name: string;
  profession: string;
  stance: string;
  color_id: string;
  role: 'host' | 'expert';
  speaking_order: number;
}

const HOST_FIXTURE: GuestFixture = {
  name: '主持人林一',
  profession: '圆桌主持人',
  stance: '保持中立并推进讨论',
  color_id: 'amber',
  role: 'host',
  speaking_order: 0,
};

const EXPERT_FIXTURE: GuestFixture = {
  name: '专家甲',
  profession: '教育学者',
  stance: '支持技术辅助教学',
  color_id: 'rose',
  role: 'expert',
  speaking_order: 1,
};

const PALETTE = ['amber', 'rose', 'sky', 'emerald', 'violet', 'orange', 'teal', 'lime', 'indigo'] as const;

function validLineup(expertCount: number): { guests: GuestFixture[] } {
  const guests: GuestFixture[] = [{ ...HOST_FIXTURE }];
  for (let index = 0; index < expertCount; index += 1) {
    guests.push({
      name: `专家${index + 1}号`,
      profession: `领域研究员${index + 1}`,
      stance: `这是第${index + 1}位专家的立场陈述`,
      color_id: PALETTE[index + 1] ?? 'fuchsia',
      role: 'expert',
      speaking_order: index + 1,
    });
  }
  return { guests };
}

interface FakeLlm {
  client: ChatJsonClient;
  calls: ChatJsonRequest[];
}

function createFakeLlm(responses: Array<string | Error>): FakeLlm {
  const calls: ChatJsonRequest[] = [];
  let next = 0;
  const client: ChatJsonClient = {
    async complete(req: ChatJsonRequest): Promise<string> {
      calls.push(req);
      const response = responses[next];
      next += 1;
      if (response === undefined) {
        throw new Error('fake LLM has no response queued');
      }
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
  return { client, calls };
}

interface Harness {
  db: Db;
  app: ReturnType<typeof buildApp>;
  discussionId: number;
}

function createHarness(
  label: string,
  llm: ChatJsonClient,
  options: { expertCount?: number; status?: string } = {},
): Harness {
  const file = path.join(dataDir, `test-guest-${label}-${process.pid}-${Date.now()}.db`);
  tempFiles.push(file);
  const db = createDb(file);
  migrate(db);
  const info = db
    .prepare('INSERT INTO discussions (topic, expert_count, status) VALUES (?, ?, ?)')
    .run('人工智能是否应取代教师', options.expertCount ?? 4, options.status ?? 'draft');
  const discussionId = Number(info.lastInsertRowid);
  const app = buildApp({ db, llm });
  return { db, app, discussionId };
}

async function dispose(harness: Harness): Promise<void> {
  await harness.app.close();
  harness.db.close();
}

function insertGuest(db: Db, discussionId: number, guest: GuestFixture, locked: 0 | 1): number {
  const info = db
    .prepare(
      `INSERT INTO guests (discussion_id, name, profession, stance, color_id, role, speaking_order, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      discussionId,
      guest.name,
      guest.profession,
      guest.stance,
      guest.color_id,
      guest.role,
      guest.speaking_order,
      locked,
    );
  return Number(info.lastInsertRowid);
}

function guestCount(db: Db, discussionId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM guests WHERE discussion_id = ?')
    .get(discussionId) as { count: number };
  return row.count;
}

function generateUrl(discussionId: number): string {
  return `/api/discussions/${discussionId}/guests/generate`;
}

describe('POST /api/discussions/:id/guests/generate', () => {
  it('persists 1 host + 4 experts as locked=0 and returns the draft projection', async () => {
    const fake = createFakeLlm([JSON.stringify(validLineup(4))]);
    const harness = createHarness('valid', fake.client);
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: generateUrl(harness.discussionId),
      });
      expect(response.statusCode).toBe(200);

      const parsed = generateResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      expect(Object.keys(parsed.data).sort()).toEqual(['discussion_id', 'guests', 'status']);
      expect(parsed.data.discussion_id).toBe(harness.discussionId);
      expect(parsed.data.status).toBe('draft');
      expect(parsed.data.guests).toHaveLength(5);
      expect(parsed.data.guests.filter((guest) => guest.role === 'host')).toHaveLength(1);
      expect(parsed.data.guests.filter((guest) => guest.role === 'expert')).toHaveLength(4);
      for (const guest of parsed.data.guests) {
        expect(guest.locked).toBe(false);
        expect(Object.keys(guest).sort()).toEqual([
          'color_id',
          'discussion_id',
          'id',
          'locked',
          'name',
          'profession',
          'role',
          'speaking_order',
          'stance',
        ]);
      }

      const rows = harness.db
        .prepare('SELECT role, locked FROM guests WHERE discussion_id = ?')
        .all(harness.discussionId) as { role: string; locked: number }[];
      expect(rows).toHaveLength(5);
      expect(rows.every((row) => row.locked === 0)).toBe(true);
      expect(rows.filter((row) => row.role === 'host')).toHaveLength(1);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.module).toBe('guest');
      expect(fake.calls[0]?.discussionId).toBe(harness.discussionId);
    } finally {
      await dispose(harness);
    }
  });

  it('retries exactly once when the first output misses a field, then succeeds', async () => {
    const missingField = validLineup(4).guests.map((guest, index) =>
      index === 1 ? { ...guest, profession: undefined } : guest,
    );
    const fake = createFakeLlm([
      JSON.stringify({ guests: missingField }),
      JSON.stringify(validLineup(4)),
    ]);
    const harness = createHarness('retry', fake.client);
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: generateUrl(harness.discussionId),
      });
      expect(response.statusCode).toBe(200);

      const parsed = generateResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.status).toBe('draft');
      expect(parsed.data.guests.every((guest) => guest.locked === false)).toBe(true);
      expect(fake.calls).toHaveLength(2);
      expect(fake.calls[0]?.isRetry).not.toBe(true);
      expect(fake.calls[1]?.isRetry).toBe(true);
      expect(guestCount(harness.db, harness.discussionId)).toBe(5);
    } finally {
      await dispose(harness);
    }
  });

  it('rejects a wrong expert count with 422 and leaves existing rows untouched', async () => {
    const wrongCount = JSON.stringify(validLineup(5));
    const fake = createFakeLlm([wrongCount, wrongCount]);
    const harness = createHarness('count', fake.client);
    const oldGuestId = insertGuest(harness.db, harness.discussionId, HOST_FIXTURE, 0);
    try {
      const before = guestCount(harness.db, harness.discussionId);
      const response = await harness.app.inject({
        method: 'POST',
        url: generateUrl(harness.discussionId),
      });
      expect(response.statusCode).toBe(422);

      const parsed = errorResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.code).toBe('GUEST_OUTPUT_INVALID');
      expect(parsed.data.message.length).toBeLessThanOrEqual(200);
      expect(fake.calls).toHaveLength(2);
      expect(guestCount(harness.db, harness.discussionId)).toBe(before);
      expect(
        harness.db.prepare('SELECT id FROM guests WHERE id = ?').get(oldGuestId),
      ).toBeDefined();
    } finally {
      await dispose(harness);
    }
  });

  it('rejects a duplicate color_id with 422 and leaves the row count unchanged', async () => {
    const duplicateColor = validLineup(4).guests.map((guest, index) =>
      index === 2 ? { ...guest, color_id: 'rose' } : guest,
    );
    const fake = createFakeLlm([
      JSON.stringify({ guests: duplicateColor }),
      JSON.stringify({ guests: duplicateColor }),
    ]);
    const harness = createHarness('color', fake.client);
    try {
      const before = guestCount(harness.db, harness.discussionId);
      const response = await harness.app.inject({
        method: 'POST',
        url: generateUrl(harness.discussionId),
      });
      expect(response.statusCode).toBe(422);

      const parsed = errorResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.code).toBe('GUEST_OUTPUT_INVALID');
      expect(fake.calls).toHaveLength(2);
      expect(guestCount(harness.db, harness.discussionId)).toBe(before);
    } finally {
      await dispose(harness);
    }
  });

  it('returns 409 GUESTS_ALREADY_LOCKED without calling the LLM when locked guests exist', async () => {
    const fake = createFakeLlm([]);
    const harness = createHarness('locked', fake.client);
    insertGuest(harness.db, harness.discussionId, HOST_FIXTURE, 1);
    insertGuest(harness.db, harness.discussionId, EXPERT_FIXTURE, 1);
    try {
      const before = guestCount(harness.db, harness.discussionId);
      const response = await harness.app.inject({
        method: 'POST',
        url: generateUrl(harness.discussionId),
      });
      expect(response.statusCode).toBe(409);

      const parsed = errorResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.code).toBe('GUESTS_ALREADY_LOCKED');
      expect(fake.calls).toHaveLength(0);
      expect(guestCount(harness.db, harness.discussionId)).toBe(before);
    } finally {
      await dispose(harness);
    }
  });

  it('replaces existing locked=0 guests so the lineup stays exactly 5 rows', async () => {
    const fake = createFakeLlm([JSON.stringify(validLineup(4))]);
    const harness = createHarness('replace', fake.client);
    const oldHostId = insertGuest(harness.db, harness.discussionId, HOST_FIXTURE, 0);
    const oldExpertId = insertGuest(harness.db, harness.discussionId, EXPERT_FIXTURE, 0);
    harness.db
      .prepare('INSERT INTO agent_status (discussion_id, guest_id, state) VALUES (?, ?, ?)')
      .run(harness.discussionId, oldHostId, 'idle');
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: generateUrl(harness.discussionId),
      });
      expect(response.statusCode).toBe(200);
      expect(guestCount(harness.db, harness.discussionId)).toBe(5);

      const rows = harness.db
        .prepare('SELECT id, name, color_id, speaking_order FROM guests WHERE discussion_id = ?')
        .all(harness.discussionId) as {
        id: number;
        name: string;
        color_id: string;
        speaking_order: number;
      }[];
      expect(rows).toHaveLength(5);
      expect(rows.some((row) => row.id === oldHostId || row.id === oldExpertId)).toBe(false);
      expect(new Set(rows.map((row) => row.name)).size).toBe(5);
      expect(new Set(rows.map((row) => row.color_id)).size).toBe(5);
      expect(rows.map((row) => row.speaking_order).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);

      const agentStatus = harness.db
        .prepare('SELECT COUNT(*) AS count FROM agent_status WHERE discussion_id = ?')
        .get(harness.discussionId) as { count: number };
      expect(agentStatus.count).toBe(0);
    } finally {
      await dispose(harness);
    }
  });
});
