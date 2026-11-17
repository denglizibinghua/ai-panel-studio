import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { computeStallDelta, requestLedger, type LedgerContext } from '../../src/modules/host/ledger';
import { createDb, type Db } from '../../src/db';
import { migrate } from '../../src/db/migrate';
import {
  createDeepSeekClient,
  type ChatJsonClient,
  type ChatJsonRequest,
  type ChatJsonTransport,
} from '../../src/llm/client';

const dataDir = path.resolve(__dirname, '../data');
const tempFiles: string[] = [];

afterAll(() => {
  for (const file of tempFiles) {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${file}${suffix}`, { force: true });
    }
  }
});

const ROSTER = [
  { id: 11, name: '专家甲', profession: '教育学者', stance: '支持技术辅助教学' },
  { id: 12, name: '专家乙', profession: '一线教师', stance: '担心技术取代教师' },
  { id: 13, name: '专家丙', profession: '政策研究员', stance: '主张分阶段推进' },
] as const;

function makeContext(overrides: Partial<LedgerContext> = {}): LedgerContext {
  return {
    discussion_id: 1,
    topic: '人工智能是否应取代教师',
    roster: ROSTER.map((member) => ({ ...member })),
    recent_turns: [],
    expert_turn_count: 0,
    prev_stall_count: 0,
    ...overrides,
  };
}

function item<T>(answer: T, reason = '一句话依据'): { reason: string; answer: T } {
  return { reason, answer };
}

function validDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    is_request_satisfied: item(false, '议题仍在推进'),
    is_in_loop: item(false, '出现了新论点'),
    is_progress_being_made: item(true, '给出了新证据'),
    next_speaker: item('专家乙', '她尚未表达立场'),
    speech_type: item('challenge', '需要正面质疑'),
    instruction: item('请反驳"技术可以完全替代教师"的观点', '聚焦可替代性'),
    ...overrides,
  };
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

function createRepeatingLlm(raw: string): FakeLlm {
  const calls: ChatJsonRequest[] = [];
  const client: ChatJsonClient = {
    async complete(req: ChatJsonRequest): Promise<string> {
      calls.push(req);
      return raw;
    },
  };
  return { client, calls };
}

describe('requestLedger — parse layers', () => {
  it('parses a well-formed decision as structured and resolves next_guest_id from the roster', async () => {
    const fake = createFakeLlm([JSON.stringify(validDecision())]);
    const ctx = makeContext();
    const outcome = await requestLedger(fake.client, ctx);

    expect(outcome.parse_status).toBe('structured');
    expect(outcome.next_guest_id).toBe(12);
    expect(outcome.next_speaker_name).toBe('专家乙');
    expect(outcome.speech_type).toBe('challenge');
    expect(outcome.instruction).toBe('请反驳"技术可以完全替代教师"的观点');
    expect(outcome.is_request_satisfied).toBe(false);
    expect(outcome.is_in_loop).toBe(false);
    expect(outcome.is_progress_being_made).toBe(true);
    expect(outcome.stall_count).toBe(0);
    expect(outcome.issues).toEqual([]);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.module).toBe('ledger');
    expect(fake.calls[0]?.discussionId).toBe(1);
    expect(fake.calls[0]?.isRetry).not.toBe(true);
  });

  it('accepts a ```json fenced body', async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validDecision())}\n\`\`\``;
    const fake = createFakeLlm([fenced]);
    const outcome = await requestLedger(fake.client, makeContext());

    expect(outcome.parse_status).toBe('structured');
    expect(outcome.next_guest_id).toBe(12);
    expect(fake.calls).toHaveLength(1);
  });

  it('retries once with issue feedback when a reason is missing, then reports json_mode', async () => {
    const missingReason = JSON.stringify(
      validDecision({ speech_type: { answer: 'challenge' } }),
    );
    const fake = createFakeLlm([missingReason, JSON.stringify(validDecision())]);
    const outcome = await requestLedger(fake.client, makeContext());

    expect(outcome.parse_status).toBe('json_mode');
    expect(outcome.next_guest_id).toBe(12);
    expect(outcome.issues).toEqual([]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.isRetry).toBe(true);
    expect(fake.calls[1]?.module).toBe('ledger');

    const retryMessages = fake.calls[1]?.messages ?? [];
    const lastMessage = retryMessages[retryMessages.length - 1];
    expect(lastMessage?.content).toContain('speech_type.reason');
  });

  it('falls back to the most stale speaker when next_speaker stays outside the roster', async () => {
    const offRoster = JSON.stringify(validDecision({ next_speaker: item('名单外的嘉宾') }));
    const fake = createFakeLlm([offRoster, offRoster]);
    const ctx = makeContext({
      recent_turns: [
        { guest_id: 12, speaker_name: '专家乙', speech_type: 'challenge', content: '我先说' },
        { guest_id: 13, speaker_name: '专家丙', speech_type: 'supplement', content: '补充一点' },
      ],
      expert_turn_count: 2,
    });
    const outcome = await requestLedger(fake.client, ctx);

    expect(outcome.parse_status).toBe('fallback');
    expect(outcome.next_guest_id).toBe(11);
    expect(outcome.next_speaker_name).toBe('专家甲');
    expect(outcome.speech_type).toBe('supplement');
    expect(outcome.instruction).toBeNull();
    expect(outcome.issues).toContain('next_speaker.answer: not_in_roster');
    expect(outcome.stall_count).toBe(1);
    expect(fake.calls).toHaveLength(2);
  });

  it('falls back after two unparseable bodies without a third attempt', async () => {
    const fake = createFakeLlm(['not json', 'still not json']);
    const outcome = await requestLedger(fake.client, makeContext());

    expect(outcome.parse_status).toBe('fallback');
    expect(outcome.speech_type).toBe('supplement');
    expect(outcome.issues).toEqual(['(root): invalid_json']);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.isRetry).toBe(true);
  });
});

describe('computeStallDelta', () => {
  it('counts up on loop or no progress, caps at 3', () => {
    expect(computeStallDelta(false, false, 0)).toBe(1);
    expect(computeStallDelta(false, false, 1)).toBe(2);
    expect(computeStallDelta(false, false, 2)).toBe(3);
    expect(computeStallDelta(false, false, 3)).toBe(3);
    expect(computeStallDelta(true, true, 1)).toBe(2);
  });

  it('cools down by 1 on progress and never drops below 0', () => {
    expect(computeStallDelta(false, true, 3)).toBe(2);
    expect(computeStallDelta(false, true, 1)).toBe(0);
    expect(computeStallDelta(false, true, 0)).toBe(0);
  });
});

describe('requestLedger — no hidden state', () => {
  it('returns an identical outcome for the same input across two calls', async () => {
    const raw = JSON.stringify(validDecision({ is_in_loop: item(false), is_progress_being_made: item(true) }));
    const fake = createRepeatingLlm(raw);
    const ctx = makeContext({ prev_stall_count: 2 });

    const first = await requestLedger(fake.client, ctx);
    const second = await requestLedger(fake.client, ctx);

    expect(second).toEqual(first);
    expect(first.stall_count).toBe(1);
    expect(second.stall_count).toBe(1);
    expect(fake.calls).toHaveLength(2);
  });
});

describe('requestLedger — audit attribution (llm_calls)', () => {
  it("writes module='ledger' to llm_calls for a real client call", async () => {
    const file = path.join(dataDir, `test-host-ledger-${process.pid}-${Date.now()}.db`);
    tempFiles.push(file);
    const db: Db = createDb(file);
    migrate(db);

    const info = db
      .prepare('INSERT INTO discussions (topic, expert_count, status) VALUES (?, ?, ?)')
      .run('人工智能是否应取代教师', 3, 'running');
    const discussionId = Number(info.lastInsertRowid);

    const transport: ChatJsonTransport = async () => ({ raw: JSON.stringify(validDecision()) });
    const client = createDeepSeekClient({ transport, db });

    try {
      const outcome = await requestLedger(
        client,
        makeContext({ discussion_id: discussionId }),
      );
      expect(outcome.parse_status).toBe('structured');

      const rows = db
        .prepare('SELECT discussion_id, module, is_retry, success FROM llm_calls ORDER BY id')
        .all() as {
        discussion_id: number | null;
        module: string;
        is_retry: number;
        success: number;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]?.module).toBe('ledger');
      expect(rows[0]?.discussion_id).toBe(discussionId);
      expect(rows[0]?.is_retry).toBe(0);
      expect(rows[0]?.success).toBe(1);
    } finally {
      db.close();
    }
  });
});
