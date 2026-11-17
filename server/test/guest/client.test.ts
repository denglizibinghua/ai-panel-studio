import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../src/db';
import { migrate } from '../../src/db/migrate';
import {
  LlmNotConfiguredError,
  LlmUpstreamError,
  createDeepSeekClient,
  type ChatJsonTransport,
} from '../../src/llm/client';

const dataDir = path.resolve(__dirname, '../data');
const tempFiles: string[] = [];
const originalKey = process.env.DEEPSEEK_API_KEY;

beforeAll(() => {
  // HARD BLOCK: the default-transport test below must fail fast, never hit the network.
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

function createTestDb(label: string): Db {
  const file = path.join(dataDir, `test-guest-client-${label}-${process.pid}-${Date.now()}.db`);
  tempFiles.push(file);
  const db = createDb(file);
  migrate(db);
  return db;
}

interface LlmCallRow {
  module: string;
  provider: string;
  model: string;
  success: number;
  error_summary: string | null;
  is_retry: number;
}

function readCalls(db: Db): LlmCallRow[] {
  return db
    .prepare(
      'SELECT module, provider, model, success, error_summary, is_retry FROM llm_calls ORDER BY id',
    )
    .all() as LlmCallRow[];
}

const baseRequest = {
  messages: [{ role: 'system' as const, content: 'test' }],
  module: 'guest' as const,
};

describe('createDeepSeekClient audit (llm_calls.success per data-model §2.9)', () => {
  it('writes success=1 when the validate predicate accepts the body', async () => {
    const db = createTestDb('success');
    const transport: ChatJsonTransport = async () => ({ raw: '{"guests":[]}' });
    try {
      const client = createDeepSeekClient({ transport, db });
      const raw = await client.complete({ ...baseRequest, validate: () => true });
      expect(raw).toBe('{"guests":[]}');

      const calls = readCalls(db);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.module).toBe('guest');
      expect(calls[0]?.provider).toBe('deepseek');
      expect(calls[0]?.model).toBe('deepseek-chat');
      expect(calls[0]?.success).toBe(1);
      expect(calls[0]?.error_summary).toBeNull();
      expect(calls[0]?.is_retry).toBe(0);
    } finally {
      db.close();
    }
  });

  it('writes success=0 with LLM_OUTPUT_INVALID when the predicate rejects, still returning raw', async () => {
    const db = createTestDb('invalid');
    const transport: ChatJsonTransport = async () => ({ raw: 'not json' });
    try {
      const client = createDeepSeekClient({ transport, db });
      const raw = await client.complete({ ...baseRequest, validate: () => false });
      expect(raw).toBe('not json');

      const calls = readCalls(db);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.success).toBe(0);
      expect(calls[0]?.error_summary).toBe('LLM_OUTPUT_INVALID');
    } finally {
      db.close();
    }
  });

  it('writes success=0 with an LLM_UPSTREAM_ERROR summary when the transport throws', async () => {
    const db = createTestDb('upstream');
    const transport: ChatJsonTransport = async () => {
      throw new Error('boom');
    };
    try {
      const client = createDeepSeekClient({ transport, db });
      await expect(
        client.complete({ ...baseRequest, validate: () => true }),
      ).rejects.toBeInstanceOf(LlmUpstreamError);

      const calls = readCalls(db);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.success).toBe(0);
      expect(calls[0]?.error_summary).toContain('LLM_UPSTREAM_ERROR');
    } finally {
      db.close();
    }
  });

  it('fails fast with LLM_NOT_CONFIGURED on the default transport when the key is unset', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const db = createTestDb('missing-key');
    try {
      const client = createDeepSeekClient({ db });
      let caught: unknown;
      try {
        await client.complete(baseRequest);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LlmNotConfiguredError);
      expect(caught instanceof LlmNotConfiguredError ? caught.code : null).toBe(
        'LLM_NOT_CONFIGURED',
      );

      const calls = readCalls(db);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.success).toBe(0);
      expect(calls[0]?.error_summary).toBe('LLM_NOT_CONFIGURED');
    } finally {
      db.close();
    }
  });
});
