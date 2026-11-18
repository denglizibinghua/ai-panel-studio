import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db';
import { runDiscussion } from '../../src/modules/turn/runner';
import {
  generateSummary,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CHARS,
} from '../../src/modules/summary/summary';
import { finalizePoints } from '../../src/modules/summary/merge';
import { extractPoints, persistExtraction } from '../../src/modules/summary/extract';
import {
  createScriptedLlm,
  createTempDb,
  markRunning,
  removeTempFiles,
  seedReadyDiscussion,
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

const OPENING = '开场白：本场讨论围绕 AI 是否取代初级程序员展开。';

const VALID_SUMMARY =
  '本场讨论围绕人工智能是否应取代初级程序员展开，多数嘉宾认为重复性编码会先被自动化，但需求澄清与系统设计仍需要人来把关。主要分歧在于成本与体验谁更优先：一方强调效率与价格，另一方强调信任与长期体验。整体看，讨论没有给出统一结论，但把问题从能不能替代推进到了在哪些环节替代，并留下责任边界与质量验证的追问。';

function tooShort(): string {
  return '太短了，只有一句话，没有展开主要分歧，也没有交代讨论的边界与结论。';
}

function tooLong(): string {
  return '过长'.repeat(300);
}

function speech(index: number, prompt: string): string {
  return prompt.includes('用一两句话开场')
    ? OPENING
    : `专家发言第${index}条：成本与体验必须一起衡量。`;
}

describe('summary hard length validation (150–250)', () => {
  it('retries once, then clamps an invalid summary and records a failed retry audit row', async () => {
    const db = tempDb('clamp');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    let summaryCalls = 0;
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech,
      summary: () => {
        summaryCalls += 1;
        return summaryCalls === 1 ? tooShort() : tooLong();
      },
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm: llm.client,
      // One expert turn finishes before the first extraction window, so the
      // `llm_calls(module='summary')` rows below are summary-only.
      max_expert_turns: 1,
    });

    expect(outcome.status).toBe('finished');
    expect(llm.byKind('summary')).toHaveLength(2);
    expect(llm.byKind('summary')[0]?.request.isRetry).not.toBe(true);
    expect(llm.byKind('summary')[1]?.request.isRetry).toBe(true);

    const row = db
      .prepare('SELECT summary_text FROM discussions WHERE id = ?')
      .get(seed.discussionId) as { summary_text: string };
    const content = row.summary_text;
    expect(content.length).toBeGreaterThanOrEqual(SUMMARY_MIN_CHARS);
    expect(content.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);

    const turn = db
      .prepare(
        "SELECT content FROM turns WHERE discussion_id = ? AND speech_type = 'summary'",
      )
      .get(seed.discussionId) as { content: string };
    // INV-9 survives clamping.
    expect(turn.content).toBe(content);

    const audit = db
      .prepare(
        "SELECT is_retry, success FROM llm_calls WHERE discussion_id = ? AND module = 'summary' ORDER BY id ASC",
      )
      .all(seed.discussionId) as { is_retry: number; success: number }[];
    expect(audit).toEqual([
      { is_retry: 0, success: 0 },
      { is_retry: 1, success: 0 },
    ]);
  });

  it('accepts the retry verbatim when it lands inside the range', async () => {
    const db = tempDb('retry-ok');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);
    let summaryCalls = 0;
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech,
      summary: () => {
        summaryCalls += 1;
        return summaryCalls === 1 ? tooShort() : VALID_SUMMARY;
      },
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm: llm.client,
      max_expert_turns: 1,
    });

    expect(outcome.status).toBe('finished');
    const row = db
      .prepare('SELECT summary_text FROM discussions WHERE id = ?')
      .get(seed.discussionId) as { summary_text: string };
    expect(row.summary_text).toBe(VALID_SUMMARY);
    expect(llm.byKind('summary')).toHaveLength(2);
    expect(llm.byKind('summary')[1]?.request.isRetry).toBe(true);

    const audit = db
      .prepare(
        "SELECT is_retry, success FROM llm_calls WHERE discussion_id = ? AND module = 'summary' ORDER BY id ASC",
      )
      .all(seed.discussionId) as { is_retry: number; success: number }[];
    expect(audit).toEqual([
      { is_retry: 0, success: 0 },
      { is_retry: 1, success: 1 },
    ]);
  });

  it('generateSummary never returns an out-of-range model body', async () => {
    const db = tempDb('direct-clamp');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const llm = createScriptedLlm(db, {
      ledger: () => speakLedger('专家1号'),
      speech: () => OPENING,
      summary: () => '短。',
    });

    const result = await generateSummary(
      llm.client,
      {
        discussion_id: seed.discussionId,
        topic: '人工智能是否应取代初级程序员',
        transcript: [
          {
            guest_id: seed.expertIds[0] ?? 0,
            speaker_name: '专家1号',
            speech_type: 'supplement',
            content: '成本会下降，但体验未必。',
          },
        ],
      },
      { timeout_ms: 1_000 },
    );

    expect(result.failed).toBe(false);
    expect(result.text.length).toBeGreaterThanOrEqual(SUMMARY_MIN_CHARS);
    expect(result.text.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
  });
});

describe('extract support_guest_ids mapping', () => {
  it('maps roster names back to guest ids, drops unknown names, and persists the union', async () => {
    const db = tempDb('support');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const roster = [
      {
        id: seed.expertIds[0] as number,
        name: '专家1号',
        profession: '领域研究员1',
        stance: '第1位专家的立场陈述',
      },
      {
        id: seed.expertIds[1] as number,
        name: '专家2号',
        profession: '领域研究员2',
        stance: '第2位专家的立场陈述',
      },
    ];
    const llm = createScriptedLlm(db, {
      ledger: () => speakLedger('专家1号'),
      speech: () => OPENING,
      extract: () => ({
        consensus: [
          {
            text: '专家1号与专家2号都认可成本会下降，但节奏不同。',
            supporters: ['专家1号', '专家2号'],
          },
        ],
        divergence: [
          {
            text: '专家1号认为体验优先，专家2号认为价格优先；路人甲不表态。',
            supporters: ['专家1号', '专家2号', '路人甲'],
          },
        ],
      }),
    });

    const points = await extractPoints(llm.client, {
      discussion_id: seed.discussionId,
      topic: '人工智能是否应取代初级程序员',
      transcript: [
        {
          guest_id: roster[0]?.id ?? 0,
          speaker_name: '专家1号',
          speech_type: 'supplement',
          content: '成本会下降，但体验未必。',
        },
      ],
      roster,
    });

    const at = new Date().toISOString();
    persistExtraction(db, {
      discussionId: seed.discussionId,
      roundNo: 1,
      points,
      at,
      roster,
    });

    const consensus = db
      .prepare(
        'SELECT text, support_guest_ids, status FROM consensus_points WHERE discussion_id = ?',
      )
      .get(seed.discussionId) as {
      text: string;
      support_guest_ids: string;
      status: string;
    };
    expect(consensus.status).toBe('provisional');
    expect(JSON.parse(consensus.support_guest_ids)).toEqual([
      roster[0]?.id,
      roster[1]?.id,
    ]);

    const divergence = db
      .prepare(
        'SELECT support_guest_ids FROM divergence_points WHERE discussion_id = ?',
      )
      .get(seed.discussionId) as { support_guest_ids: string };
    // 路人甲 is not in the roster: unknown names are discarded, never guessed.
    expect(JSON.parse(divergence.support_guest_ids)).toEqual([
      roster[0]?.id,
      roster[1]?.id,
    ]);

    const event = db
      .prepare(
        "SELECT payload FROM events WHERE discussion_id = ? AND type = 'consensus.added'",
      )
      .get(seed.discussionId) as { payload: string };
    expect(JSON.parse(event.payload).support_guest_ids).toEqual([
      roster[0]?.id,
      roster[1]?.id,
    ]);
  });
});

describe('merge finalization', () => {
  it('dedupes provisional rows, marks keepers final, drops duplicates, and unions support', () => {
    const db = tempDb('merge');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const at = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO consensus_points
         (discussion_id, text, status, support_guest_ids, round_no, updated_seq, created_at, updated_at)
       VALUES (?, ?, 'provisional', ?, 1, 1, ?, ?)`,
    );
    const first = seed.expertIds[0] as number;
    const second = seed.expertIds[1] as number;
    insert.run(seed.discussionId, '成本会下降。', JSON.stringify([first]), at, at);
    insert.run(seed.discussionId, '成本会下降', JSON.stringify([second]), at, at);
    insert.run(seed.discussionId, '体验更重要。', '[]', at, at);

    const result = finalizePoints(db, {
      discussionId: seed.discussionId,
      at,
    });

    const rows = db
      .prepare(
        'SELECT id, text, status, support_guest_ids, updated_seq FROM consensus_points WHERE discussion_id = ? ORDER BY id ASC',
      )
      .all(seed.discussionId) as {
      id: number;
      text: string;
      status: string;
      support_guest_ids: string;
      updated_seq: number;
    }[];
    expect(rows).toHaveLength(3);

    const keeper = rows.find((row) => row.text === '成本会下降。');
    const duplicate = rows.find((row) => row.text === '成本会下降');
    const distinct = rows.find((row) => row.text === '体验更重要。');

    expect(keeper?.status).toBe('final');
    expect(JSON.parse(keeper?.support_guest_ids ?? '[]')).toEqual([first, second]);
    expect(duplicate?.status).toBe('dropped');
    expect(distinct?.status).toBe('final');
    expect(result.consensus.final).toBe(2);
    expect(result.consensus.dropped).toBe(1);

    const events = db
      .prepare(
        "SELECT seq, payload FROM events WHERE discussion_id = ? AND type = 'consensus.updated' ORDER BY seq ASC",
      )
      .all(seed.discussionId) as { seq: number; payload: string }[];
    expect(events).toHaveLength(3);
    for (const event of events) {
      const payload = JSON.parse(event.payload) as {
        status: string;
        support_guest_ids: number[];
      };
      expect(['final', 'dropped']).toContain(payload.status);
    }
    const seqs = new Set(events.map((event) => event.seq));
    expect(rows.every((row) => seqs.has(row.updated_seq))).toBe(true);

    const before = db
      .prepare('SELECT COUNT(*) AS count FROM events WHERE discussion_id = ?')
      .get(seed.discussionId) as { count: number };
    // Idempotent: a second pass has no provisional rows, so nothing is emitted
    // and `dropped` can never resurrect.
    finalizePoints(db, { discussionId: seed.discussionId, at });
    const after = db
      .prepare('SELECT COUNT(*) AS count FROM events WHERE discussion_id = ?')
      .get(seed.discussionId) as { count: number };
    expect(after.count).toBe(before.count);

    const dropped = db
      .prepare(
        "SELECT COUNT(*) AS count FROM consensus_points WHERE discussion_id = ? AND status = 'dropped'",
      )
      .get(seed.discussionId) as { count: number };
    expect(dropped.count).toBe(1);
  });
});
