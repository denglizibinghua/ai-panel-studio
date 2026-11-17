import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@ai-panel/shared';
import { buildApp } from '../src/app';
import { createDb } from '../src/db';

const dataDir = path.resolve(__dirname, '../data');
const tempFiles: string[] = [];

function tempDbPath(label: string): string {
  const file = path.join(dataDir, `test-health-${label}-${process.pid}-${Date.now()}.db`);
  tempFiles.push(file);
  return file;
}

const originalKey = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

afterAll(() => {
  for (const file of tempFiles) {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${file}${suffix}`, { force: true });
    }
  }
});

describe('GET /health', () => {
  it('returns 200 with the exact HealthStatus shape and llm=missing when the key is unset', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const db = createDb(tempDbPath('missing'));
    const app = buildApp({ db });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);

      const parsed = healthResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.status).toBe('ok');
      expect(parsed.data.db).toBe('ok');
      expect(parsed.data.llm).toBe('missing');
      expect(Object.keys(parsed.data).sort()).toEqual(['db', 'llm', 'now', 'status']);
    } finally {
      await app.close();
      db.close();
    }
  });

  it('reports llm=configured when DEEPSEEK_API_KEY is a non-empty string', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key-not-used';
    const db = createDb(tempDbPath('configured'));
    const app = buildApp({ db });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);

      const parsed = healthResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.llm).toBe('configured');
    } finally {
      await app.close();
      db.close();
    }
  });

  it('still returns 200 with db=error when the database connection is closed', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const db = createDb(tempDbPath('closed'));
    db.close();
    const app = buildApp({ db });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);

      const parsed = healthResponseSchema.safeParse(response.json());
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.status).toBe('ok');
      expect(parsed.data.db).toBe('error');
      expect(parsed.data.llm).toBe('missing');
    } finally {
      await app.close();
    }
  });
});
