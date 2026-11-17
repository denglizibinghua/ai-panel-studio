import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db';
import { buildApp } from '../../src/app';
import { EventBus } from '../../src/modules/sse/bus';
import { runDiscussion } from '../../src/modules/turn/runner';
import {
  createScriptedLlm,
  createTempDb,
  removeTempFiles,
  markRunning,
  seedReadyDiscussion,
  sleep,
  speakLedger,
  waitFor,
} from '../discussion/harness';

const dbs: Db[] = [];

function tempDb(label: string): Db {
  const db = createTempDb(`runner-${label}`);
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

const OPENING = '开场白：本场讨论围绕 AI 是否取代初级程序员展开，核心分歧在成本与体验。';

describe('runDiscussion — full run', () => {
  it('finishes with a summary turn, provisional points, and turn/summary audit rows', async () => {
    const db = tempDb('full');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech: (index, prompt) =>
        prompt.includes('用一两句话开场')
          ? OPENING
          : `专家发言第${index}条：成本下降不等于体验提升，需要具体证据。`,
      extract: (index) => ({
        consensus: [`共识第${index}条：技术会改变工作方式。`],
        divergence: [`分歧第${index}条：成本与体验谁更优先。`],
      }),
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm: llm.client,
      max_expert_turns: 6,
    });

    expect(outcome.status).toBe('finished');
    expect(outcome.reason).toBe('max_turns');
    expect(outcome.expert_turn_count).toBe(6);

    const discussion = db
      .prepare('SELECT status, summary_text, error_code FROM discussions WHERE id = ?')
      .get(seed.discussionId) as {
      status: string;
      summary_text: string;
      error_code: string | null;
    };
    expect(discussion.status).toBe('finished');
    expect(discussion.error_code).toBeNull();

    const summaryTurn = db
      .prepare(
        "SELECT content FROM turns WHERE discussion_id = ? AND speech_type = 'summary'",
      )
      .get(seed.discussionId) as { content: string } | undefined;
    expect(summaryTurn).toBeDefined();
    // INV-9: the two summary copies are byte-equal.
    expect(summaryTurn?.content).toBe(discussion.summary_text);

    expect(
      count(db, 'SELECT COUNT(*) AS count FROM turns WHERE discussion_id = ?', seed.discussionId),
    ).toBeGreaterThanOrEqual(6);

    // Every 2 expert turns -> one extraction window (3 windows for 6 experts).
    const consensus = db
      .prepare('SELECT text, status, updated_seq FROM consensus_points WHERE discussion_id = ?')
      .all(seed.discussionId) as { text: string; status: string; updated_seq: number }[];
    expect(consensus).toHaveLength(3);
    expect(consensus.every((row) => row.status === 'provisional')).toBe(true);
    expect(
      count(
        db,
        "SELECT COUNT(*) AS count FROM divergence_points WHERE discussion_id = ? AND status = 'provisional'",
        seed.discussionId,
      ),
    ).toBe(3);

    const pointEvent = db
      .prepare(
        "SELECT seq FROM events WHERE discussion_id = ? AND type = 'consensus.added' ORDER BY seq ASC LIMIT 1",
      )
      .get(seed.discussionId) as { seq: number } | undefined;
    expect(pointEvent).toBeDefined();
    expect(Math.min(...consensus.map((row) => row.updated_seq))).toBeGreaterThanOrEqual(
      pointEvent?.seq ?? 0,
    );

    const finished = db
      .prepare(
        "SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'",
      )
      .get(seed.discussionId) as { payload: string } | undefined;
    expect(finished).toBeDefined();
    expect(JSON.parse(finished?.payload ?? '{}')).toMatchObject({
      reason: 'max_turns',
      expert_turn_count: 6,
      summary_failed: false,
    });

    // New DoD: turn and summary each have their own llm_calls rows.
    const modules = db
      .prepare(
        'SELECT module, COUNT(*) AS count FROM llm_calls WHERE discussion_id = ? GROUP BY module',
      )
      .all(seed.discussionId) as { module: string; count: number }[];
    const byModule = new Map(modules.map((row) => [row.module, row.count]));
    expect(byModule.get('ledger') ?? 0).toBeGreaterThan(0);
    expect(byModule.get('turn') ?? 0).toBeGreaterThan(0);
    expect(byModule.get('summary') ?? 0).toBeGreaterThan(0);

    // decide's transcript must contain the host opening turn.
    const firstLedgerPrompt = llm.byKind('ledger')[0]?.prompt ?? '';
    expect(firstLedgerPrompt).toContain('开场白');
  });
});

describe('runDiscussion — host interjections', () => {
  it('inserts exactly 3 host questions after 12 expert turns without inflating expert_turn_count', async () => {
    const db = tempDb('interject');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech: (index, prompt) =>
        prompt.includes('用一两句话开场')
          ? OPENING
          : `专家发言第${index}条：成本与体验必须一起衡量。`,
      interject: (index) => `追问第${index}次：刚才专家1号提到成本，那体验这一面怎么解释？`,
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm: llm.client,
      max_expert_turns: 12,
    });

    expect(outcome.status).toBe('finished');
    expect(outcome.expert_turn_count).toBe(12);

    const questions = db
      .prepare(
        "SELECT guest_id FROM turns WHERE discussion_id = ? AND speech_type = 'question' ORDER BY turn_no ASC",
      )
      .all(seed.discussionId) as { guest_id: number }[];
    expect(questions).toHaveLength(3);
    expect(questions.every((row) => row.guest_id === seed.hostId)).toBe(true);

    const finished = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'")
      .get(seed.discussionId) as { payload: string };
    expect(JSON.parse(finished.payload).expert_turn_count).toBe(12);

    const expertTurns = db
      .prepare(
        `SELECT t.turn_no, t.guest_id
           FROM turns t JOIN guests g ON g.id = t.guest_id
          WHERE t.discussion_id = ? AND g.role = 'expert'
          ORDER BY t.turn_no ASC`,
      )
      .all(seed.discussionId) as { turn_no: number; guest_id: number }[];
    expect(expertTurns).toHaveLength(12);
    for (let index = 1; index < expertTurns.length; index += 1) {
      expect(expertTurns[index]?.guest_id).not.toBe(expertTurns[index - 1]?.guest_id);
    }

    // A later ledger prompt must include the interjection, proving host turns are
    // part of the transcript handed to decide.
    const prompts = llm.byKind('ledger').map((call) => call.prompt);
    expect(prompts.some((prompt) => prompt.includes('追问第1次'))).toBe(true);
  });
});

describe('runDiscussion — stall chaining', () => {
  it('force-stops on the third ledger round, not the fourth', async () => {
    const db = tempDb('stall');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: () => ({
        is_request_satisfied: { reason: '尚未满足', answer: false },
        is_in_loop: { reason: '观点重复', answer: true },
        is_progress_being_made: { reason: '没有新论据', answer: false },
        next_speaker: { reason: '轮到下一位', answer: '专家1号' },
        speech_type: { reason: '补充', answer: 'supplement' },
        instruction: { reason: '重复上一轮', answer: '换个角度' },
      }),
      speech: (index, prompt) =>
        prompt.includes('用一两句话开场') ? OPENING : `重复观点第${index}条：还是成本问题。`,
    });

    const outcome = await runDiscussion(seed.discussionId, { db, llm: llm.client });

    expect(outcome.status).toBe('finished');
    expect(outcome.reason).toBe('stalled');
    // Round 1 and 2 speak; round 3 has prev_stall_count=2 -> ledger returns 3 ->
    // decide must force_stop immediately. A broken chain keeps speaking.
    expect(outcome.expert_turn_count).toBe(2);

    const ledger = db
      .prepare(
        'SELECT turn_no, decision, stall_count FROM ledger WHERE discussion_id = ? ORDER BY id ASC',
      )
      .all(seed.discussionId) as {
      turn_no: number;
      decision: string;
      stall_count: number;
    }[];
    expect(ledger).toHaveLength(3);
    expect(ledger.map((row) => row.stall_count)).toEqual([1, 2, 3]);
    expect(ledger[2]?.decision).toBe('force_stop');

    const finished = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'")
      .get(seed.discussionId) as { payload: string };
    expect(JSON.parse(finished.payload).reason).toBe('stalled');
    expect(JSON.parse(finished.payload).expert_turn_count).toBe(2);
  });
});

describe('runDiscussion — failure paths', () => {
  it('survives two consecutive failed speeches without breaching uq_ledger_turn', async () => {
    const db = tempDb('fail-twice');
    // Three experts: two failures are degraded, not "all speakers failed".
    const seed = seedReadyDiscussion(db, { expertCount: 3 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech: (index, prompt) => {
        if (prompt.includes('用一两句话开场')) {
          return OPENING;
        }
        if (index === 2 || index === 3) {
          throw new Error('upstream boom');
        }
        return `补位发言第${index}条：成本与体验必须一起看。`;
      },
      extract: () => ({ consensus: [], divergence: [] }),
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm: llm.client,
      max_expert_turns: 4,
    });

    expect(outcome.status).toBe('finished');
    expect(outcome.expert_turn_count).toBe(4);

    const ledger = db
      .prepare('SELECT turn_no FROM ledger WHERE discussion_id = ? ORDER BY id')
      .all(seed.discussionId) as { turn_no: number }[];
    expect(new Set(ledger.map((row) => row.turn_no)).size).toBe(ledger.length);
    expect(ledger.length).toBeGreaterThan(4);
  });

  it('writes the fixed empty-transcript summary when no turn survives', async () => {
    const db = tempDb('empty');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: () => ({
        is_request_satisfied: { reason: '议题已无需继续', answer: true },
        is_in_loop: { reason: '无循环', answer: false },
        is_progress_being_made: { reason: '已满足', answer: true },
        next_speaker: { reason: '无需发言', answer: '专家1号' },
        speech_type: { reason: '总结即可', answer: 'supplement' },
        instruction: { reason: '收束', answer: '无需继续' },
      }),
      speech: () => {
        throw new Error('opening down');
      },
    });

    const outcome = await runDiscussion(seed.discussionId, { db, llm: llm.client });

    expect(outcome.status).toBe('finished');
    expect(outcome.reason).toBe('empty_transcript');

    const discussion = db
      .prepare('SELECT status, summary_text, error_code FROM discussions WHERE id = ?')
      .get(seed.discussionId) as {
      status: string;
      summary_text: string;
      error_code: string | null;
    };
    expect(discussion.status).toBe('finished');
    expect(discussion.summary_text).toBe('本场讨论未产生有效发言');
    expect(discussion.error_code).toBeNull();

    const finished = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'")
      .get(seed.discussionId) as { payload: string };
    expect(JSON.parse(finished.payload)).toMatchObject({
      reason: 'empty_transcript',
      expert_turn_count: 0,
      summary_failed: false,
    });
  });

  it('fails the discussion with ALL_SPEAKERS_FAILED when every expert call fails', async () => {
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

    const failed = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.failed'")
      .get(seed.discussionId) as { payload: string } | undefined;
    expect(failed).toBeDefined();
    expect(JSON.parse(failed?.payload ?? '{}')).toMatchObject({
      error_code: 'ALL_SPEAKERS_FAILED',
    });
  });

  it('falls back to the fixed summary text and still finishes when summary generation fails', async () => {
    const db = tempDb('summary-fail');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech: (index, prompt) =>
        prompt.includes('用一两句话开场')
          ? OPENING
          : `专家发言第${index}条：成本与体验必须一起衡量。`,
      summary: () => {
        throw new Error('summary down');
      },
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm: llm.client,
      max_expert_turns: 2,
    });

    expect(outcome.status).toBe('finished');

    const discussion = db
      .prepare('SELECT status, summary_text FROM discussions WHERE id = ?')
      .get(seed.discussionId) as { status: string; summary_text: string };
    expect(discussion.status).toBe('finished');
    expect(discussion.summary_text).toBe('总结生成失败，请查看完整记录');

    const finished = db
      .prepare("SELECT payload FROM events WHERE discussion_id = ? AND type = 'run.finished'")
      .get(seed.discussionId) as { payload: string };
    expect(JSON.parse(finished.payload).summary_failed).toBe(true);
  });
});

describe('runDiscussion — cancel', () => {
  it('stops producing turns, keeps error_code NULL, and never writes state.finished', async () => {
    const db = tempDb('cancel');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const bus = new EventBus(db);
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech: async (index, prompt) => {
        await sleep(30);
        return prompt.includes('用一两句话开场')
          ? OPENING
          : `专家发言第${index}条：成本与体验必须一起衡量。`;
      },
    });
    const app = buildApp({ db, bus, llm: llm.client });

    const started = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/start`,
    });
    expect(started.statusCode).toBe(200);

    await waitFor(
      () =>
        count(
          db,
          'SELECT COUNT(*) AS count FROM turns WHERE discussion_id = ?',
          seed.discussionId,
        ) >= 2,
      5000,
    );

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/discussions/${seed.discussionId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().error_code).toBeNull();

    const frozen = count(
      db,
      'SELECT COUNT(*) AS count FROM turns WHERE discussion_id = ?',
      seed.discussionId,
    );
    await sleep(300);
    const later = count(
      db,
      'SELECT COUNT(*) AS count FROM turns WHERE discussion_id = ?',
      seed.discussionId,
    );
    expect(later).toBe(frozen);

    const row = db
      .prepare('SELECT status, error_code FROM discussions WHERE id = ?')
      .get(seed.discussionId) as { status: string; error_code: string | null };
    expect(row.status).toBe('cancelled');
    expect(row.error_code).toBeNull();

    const types = db
      .prepare('SELECT type FROM events WHERE discussion_id = ?')
      .all(seed.discussionId) as { type: string }[];
    const names = types.map((event) => event.type);
    expect(names).toContain('state.cancelled');
    expect(names).toContain('run.cancelled');
    expect(names).not.toContain('state.finished');
    expect(names).not.toContain('run.finished');

    await app.close();
  });
});
