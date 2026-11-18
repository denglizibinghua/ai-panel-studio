import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db';
import { buildApp } from '../../src/app';
import { createDeepSeekClient, type ChatJsonRequest } from '../../src/llm/client';
import { runDiscussion } from '../../src/modules/turn/runner';
import {
  EMPTY_TRANSCRIPT_SUMMARY,
  SUMMARY_FAILURE_TEXT,
  SUMMARY_TIMEOUT_MS,
} from '../../src/modules/summary/summary';
import {
  createScriptedLlm,
  createTempDb,
  markRunning,
  removeTempFiles,
  seedReadyDiscussion,
  sleep,
  speakLedger,
} from '../discussion/harness';

const dbs: Db[] = [];

function tempDb(label: string): Db {
  const db = createTempDb(`summary-${label}`);
  dbs.push(db);
  return db;
}

afterAll(() => {
  for (const db of dbs.splice(0)) {
    db.close();
  }
  removeTempFiles();
});

function count(db: Db, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number };
  return row.count;
}

const OPENING = '开场白：本场讨论围绕 AI 是否取代初级程序员展开。';

const VALID_SUMMARY =
  '本场讨论围绕人工智能是否应取代初级程序员展开，多数嘉宾认为重复性编码会先被自动化，但需求澄清与系统设计仍需要人来把关。主要分歧在于成本与体验谁更优先：一方强调效率与价格，另一方强调信任与长期体验。整体看，讨论没有给出统一结论，但把问题从能不能替代推进到了在哪些环节替代，并留下责任边界与质量验证的追问。';

function summarizeNow(): unknown {
  return {
    is_request_satisfied: { reason: '议题已无需继续', answer: true },
    is_in_loop: { reason: '无循环', answer: false },
    is_progress_being_made: { reason: '已满足', answer: true },
    next_speaker: { reason: '无需发言', answer: '专家1号' },
    speech_type: { reason: '总结即可', answer: 'supplement' },
    instruction: { reason: '收束', answer: '无需继续' },
  };
}

describe('S9 fallback — empty transcript', () => {
  it('writes the fixed summary, keeps finished, and never calls the summary model', async () => {
    const db = tempDb('empty');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: () => summarizeNow(),
      speech: () => {
        throw new Error('opening down');
      },
    });

    const outcome = await runDiscussion(seed.discussionId, { db, llm: llm.client });

    expect(outcome.status).toBe('finished');
    expect(outcome.reason).toBe('empty_transcript');
    expect(EMPTY_TRANSCRIPT_SUMMARY).toBe('本场讨论未产生有效发言');

    const discussion = db
      .prepare('SELECT status, summary_text, error_code FROM discussions WHERE id = ?')
      .get(seed.discussionId) as {
      status: string;
      summary_text: string;
      error_code: string | null;
    };
    expect(discussion.status).toBe('finished');
    expect(discussion.summary_text).toBe(EMPTY_TRANSCRIPT_SUMMARY);
    expect(discussion.error_code).toBeNull();

    const turns = db
      .prepare(
        "SELECT content FROM turns WHERE discussion_id = ? AND speech_type = 'summary'",
      )
      .all(seed.discussionId) as { content: string }[];
    expect(turns).toHaveLength(1);
    // INV-9: the redundant snapshot is byte-equal to the authoritative turn.
    expect(turns[0]?.content).toBe(discussion.summary_text);

    const finished = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'")
      .get(seed.discussionId) as { payload: string };
    expect(JSON.parse(finished.payload)).toMatchObject({
      reason: 'empty_transcript',
      expert_turn_count: 0,
      summary_failed: false,
    });

    // No transcript means no summary model call at all.
    expect(llm.byKind('summary')).toHaveLength(0);
  });
});

describe('S9 fallback — every expert call fails', () => {
  it('marks the discussion failed and emits run.failed without a summary turn', async () => {
    const db = tempDb('all-fail');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech: (index, prompt) => {
        if (prompt.includes('用一两句话开场')) {
          return OPENING;
        }
        throw new Error('expert down');
      },
    });

    const outcome = await runDiscussion(seed.discussionId, { db, llm: llm.client });

    expect(outcome.status).toBe('failed');
    expect(outcome.expert_turn_count).toBe(0);

    const discussion = db
      .prepare('SELECT status, error_code FROM discussions WHERE id = ?')
      .get(seed.discussionId) as { status: string; error_code: string | null };
    expect(discussion.status).toBe('failed');
    expect(discussion.error_code).toBe('ALL_SPEAKERS_FAILED');

    expect(
      count(
        db,
        "SELECT COUNT(*) AS count FROM turns WHERE discussion_id = ? AND speech_type = 'summary'",
        seed.discussionId,
      ),
    ).toBe(0);

    const failed = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.failed'")
      .get(seed.discussionId) as { payload: string } | undefined;
    expect(failed).toBeDefined();
    expect(JSON.parse(failed?.payload ?? '{}')).toMatchObject({
      error_code: 'ALL_SPEAKERS_FAILED',
    });

    expect(
      count(
        db,
        "SELECT COUNT(*) AS count FROM events WHERE discussion_id = ? AND type = 'run.finished'",
        seed.discussionId,
      ),
    ).toBe(0);
  });
});

describe('S9 fallback — summary timeout (>30s budget)', () => {
  it('finishes with the fixed failure text and summary_failed=true instead of hanging', async () => {
    const db = tempDb('timeout');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);

    // A hand-built transport (not the harness) is required here: the harness's
    // summary branch is synchronous, so an async throw would escape as an
    // unhandled rejection instead of exercising the module's timeout race.
    const summaryRequests: ChatJsonRequest[] = [];
    const llm = createDeepSeekClient({
      db,
      transport: async (request) => {
        if (request.module === 'ledger') {
          return { raw: JSON.stringify(speakLedger('专家1号')) };
        }
        if (request.module === 'turn') {
          const prompt = request.messages.map((message) => message.content).join('\n');
          return {
            raw: JSON.stringify({
              content: prompt.includes('用一两句话开场')
                ? OPENING
                : '专家发言：成本与体验必须一起衡量。',
            }),
          };
        }
        summaryRequests.push(request);
        await sleep(150);
        throw new Error('summary transport timeout');
      },
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm,
      // One expert turn finishes before the first extraction window, so the
      // `llm_calls(module='summary')` rows below are summary-only.
      max_expert_turns: 1,
      // Test seam: production uses the spec's 30s budget.
      summary_timeout_ms: 20,
    });

    expect(outcome.status).toBe('finished');
    expect(SUMMARY_TIMEOUT_MS).toBe(30_000);
    expect(SUMMARY_FAILURE_TEXT).toBe('总结生成失败，请查看完整记录');

    const discussion = db
      .prepare('SELECT status, summary_text, error_code FROM discussions WHERE id = ?')
      .get(seed.discussionId) as {
      status: string;
      summary_text: string;
      error_code: string | null;
    };
    expect(discussion.status).toBe('finished');
    expect(discussion.summary_text).toBe(SUMMARY_FAILURE_TEXT);
    expect(discussion.error_code).toBeNull();

    const finished = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'")
      .get(seed.discussionId) as { payload: string };
    expect(JSON.parse(finished.payload)).toMatchObject({
      summary_failed: true,
    });

    const request = summaryRequests[0];
    expect(request?.module).toBe('summary');
    expect(request?.timeoutMs).toBeTypeOf('number');
    expect(request?.timeoutMs).toBeLessThanOrEqual(20);

    // Let the abandoned transport settle so its failed audit row is on disk.
    await sleep(200);
    const audit = db
      .prepare(
        "SELECT is_retry, success FROM llm_calls WHERE discussion_id = ? AND module = 'summary' ORDER BY id ASC",
      )
      .all(seed.discussionId) as { is_retry: number; success: number }[];
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit.every((row) => row.success === 0)).toBe(true);
  });
});

describe('S9 retry-summary — preconditions and success path', () => {
  it('rejects failed discussions whose error_code is not ALL_SPEAKERS_FAILED with 409', async () => {
    const db = tempDb('retry-precondition');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const at = new Date().toISOString();
    db.prepare(
      "UPDATE discussions SET status = 'failed', error_code = 'LLM_UPSTREAM_ERROR', finished_at = ? WHERE id = ?",
    ).run(at, seed.discussionId);

    const llm = createScriptedLlm(db, {
      ledger: () => speakLedger('专家1号'),
      speech: () => OPENING,
    });
    const app = buildApp({ db, llm: llm.client });

    const response = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/retry-summary`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });

    const row = db
      .prepare('SELECT status, error_code, summary_text FROM discussions WHERE id = ?')
      .get(seed.discussionId) as {
      status: string;
      error_code: string | null;
      summary_text: string | null;
    };
    expect(row.status).toBe('failed');
    expect(row.error_code).toBe('LLM_UPSTREAM_ERROR');
    expect(row.summary_text).toBeNull();
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('turns ALL_SPEAKERS_FAILED into finished with a summary turn and run.finished', async () => {
    const db = tempDb('retry-success');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const at = new Date().toISOString();
    db.prepare(
      "UPDATE discussions SET status = 'failed', error_code = 'ALL_SPEAKERS_FAILED', finished_at = ? WHERE id = ?",
    ).run(at, seed.discussionId);
    // A host opening survived before every expert call failed.
    db.prepare(
      `INSERT INTO turns (discussion_id, guest_id, turn_no, speech_type, content, created_at)
       VALUES (?, ?, 1, 'opening', ?, ?)`,
    ).run(seed.discussionId, seed.hostId, OPENING, at);

    const llm = createScriptedLlm(db, {
      ledger: () => speakLedger('专家1号'),
      speech: () => OPENING,
      summary: () => VALID_SUMMARY,
    });
    const app = buildApp({ db, llm: llm.client });

    const response = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/retry-summary`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: number; status: string; summary_text: string };
    expect(body.id).toBe(seed.discussionId);
    expect(body.status).toBe('finished');

    const row = db
      .prepare('SELECT status, error_code, summary_text FROM discussions WHERE id = ?')
      .get(seed.discussionId) as {
      status: string;
      error_code: string | null;
      summary_text: string;
    };
    expect(row.status).toBe('finished');
    expect(row.error_code).toBeNull();
    expect(row.summary_text).toBe(VALID_SUMMARY);

    const summaryTurn = db
      .prepare(
        "SELECT content FROM turns WHERE discussion_id = ? AND speech_type = 'summary'",
      )
      .get(seed.discussionId) as { content: string } | undefined;
    expect(summaryTurn?.content).toBe(row.summary_text);

    const finished = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'")
      .get(seed.discussionId) as { payload: string } | undefined;
    expect(finished).toBeDefined();
    expect(JSON.parse(finished?.payload ?? '{}')).toMatchObject({
      reason: 'retry_summary',
      expert_turn_count: 0,
      summary_failed: false,
    });

    const again = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/retry-summary`,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });

    await app.close();
  });
});
