import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db';
import { runDiscussion } from '../../src/modules/turn/runner';
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
  const db = createTempDb(`speaking-${label}`);
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

const SPEECH_DELAY_MS = 60;

interface AgentFrameRow {
  seq: number;
  created_at: string;
  payload: string;
}

interface TurnRow {
  seq: number;
  guest_id: number;
  created_at: string;
}

describe('speaking frame ordering (S8 review item 1)', () => {
  it('commits speaking before the model call and keeps it visible for the call duration', async () => {
    const db = tempDb('order');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    markRunning(db, seed.discussionId);

    let sawSpeakingBeforeCall = false;
    const llm = createScriptedLlm(db, {
      ledger: (index) => speakLedger(index % 2 === 1 ? '专家1号' : '专家2号'),
      speech: async (index, prompt) => {
        if (prompt.includes('用一两句话开场')) {
          return OPENING;
        }
        // We are inside the model call: the newest agent frame must already be
        // `speaking`. Under the old ordering it was still `preparing`.
        const latest = db
          .prepare(
            "SELECT payload FROM events WHERE discussion_id = ? AND type = 'agent.status' ORDER BY seq DESC LIMIT 1",
          )
          .get(seed.discussionId) as { payload: string } | undefined;
        if (latest !== undefined) {
          const payload = JSON.parse(latest.payload) as {
            guest_id: number;
            state: string;
          };
          if (payload.state === 'speaking' && seed.expertIds.includes(payload.guest_id)) {
            sawSpeakingBeforeCall = true;
          }
        }
        await sleep(SPEECH_DELAY_MS);
        return `专家发言第${index}条：成本与体验必须一起衡量。`;
      },
      summary: () => VALID_SUMMARY,
    });

    const outcome = await runDiscussion(seed.discussionId, {
      db,
      llm: llm.client,
      max_expert_turns: 2,
    });

    expect(outcome.status).toBe('finished');
    expect(sawSpeakingBeforeCall).toBe(true);

    const expertTurns = db
      .prepare(
        `SELECT e.seq, t.guest_id, t.created_at
           FROM turns t
           JOIN guests g ON g.id = t.guest_id
           JOIN events e ON e.discussion_id = t.discussion_id
                        AND e.type = 'turn.done'
                        AND json_extract(e.payload, '$.turn_no') = t.turn_no
          WHERE t.discussion_id = ? AND g.role = 'expert'
          ORDER BY e.seq ASC`,
      )
      .all(seed.discussionId) as TurnRow[];
    expect(expertTurns).toHaveLength(2);

    const frames = db
      .prepare(
        "SELECT seq, created_at, payload FROM events WHERE discussion_id = ? AND type = 'agent.status' ORDER BY seq ASC",
      )
      .all(seed.discussionId) as AgentFrameRow[];

    for (const turn of expertTurns) {
      const speaking = frames
        .filter((frame) => {
          if (frame.seq >= turn.seq) return false;
          const payload = JSON.parse(frame.payload) as { guest_id: number; state: string };
          return payload.guest_id === turn.guest_id && payload.state === 'speaking';
        })
        .at(-1);
      expect(speaking).toBeDefined();

      const idle = frames.find((frame) => {
        if (frame.seq <= turn.seq) return false;
        const payload = JSON.parse(frame.payload) as { guest_id: number; state: string };
        return payload.guest_id === turn.guest_id && payload.state === 'idle';
      });
      expect(idle).toBeDefined();

      // speaking -> turn.done -> idle, each in its own seq slot.
      expect(speaking?.seq ?? Infinity).toBeLessThan(turn.seq);
      expect(turn.seq).toBeLessThan(idle?.seq ?? -Infinity);

      // Visible speaking duration tracks the model call, not a fixed UI dwell.
      const visibleFor = Date.parse(turn.created_at) - Date.parse(speaking?.created_at ?? '');
      expect(visibleFor).toBeGreaterThanOrEqual(SPEECH_DELAY_MS - 10);
      expect(visibleFor).toBeLessThan(1_000);
    }

    // No streaming was added: zero delta frames is still a valid run.
    const deltas = db
      .prepare(
        "SELECT COUNT(*) AS count FROM events WHERE discussion_id = ? AND type = 'turn.delta'",
      )
      .get(seed.discussionId) as { count: number };
    expect(deltas.count).toBe(0);
  });
});
