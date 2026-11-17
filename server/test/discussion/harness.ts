import fs from 'node:fs';
import path from 'node:path';
import { createDb, type Db } from '../../src/db';
import { migrate } from '../../src/db/migrate';
import {
  createDeepSeekClient,
  type ChatJsonClient,
  type ChatJsonRequest,
} from '../../src/llm/client';

export const dataDir = path.resolve(__dirname, '../data');
const tempFiles: string[] = [];
let counter = 0;

export function createTempDb(label: string): Db {
  counter += 1;
  const file = path.join(dataDir, `test-${label}-${process.pid}-${counter}.db`);
  tempFiles.push(file);
  const db = createDb(file);
  migrate(db);
  return db;
}

export function removeTempFiles(): void {
  for (const file of tempFiles.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${file}${suffix}`, { force: true });
      } catch {
        // Windows can hold a handle briefly after an aborted assertion.
      }
    }
  }
}

export function insertDiscussion(
  db: Db,
  options: { topic?: string; expertCount?: number; status?: string } = {},
): number {
  const info = db
    .prepare('INSERT INTO discussions (topic, expert_count, status) VALUES (?, ?, ?)')
    .run(
      options.topic ?? '人工智能是否应取代初级程序员',
      options.expertCount ?? 2,
      options.status ?? 'draft',
    );
  return Number(info.lastInsertRowid);
}

const PALETTE = ['amber', 'rose', 'sky', 'emerald', 'violet', 'orange', 'teal', 'lime', 'indigo'];

export interface Lineup {
  hostId: number;
  expertIds: number[];
}

export function insertLineup(
  db: Db,
  discussionId: number,
  expertCount = 2,
  locked: 0 | 1 = 1,
): Lineup {
  const insert = db.prepare(
    `INSERT INTO guests (discussion_id, name, profession, stance, color_id, role, speaking_order, locked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const host = insert.run(
    discussionId,
    '主持人林一',
    '圆桌主持人',
    '保持中立并推进讨论',
    PALETTE[0],
    'host',
    0,
    locked,
  );
  const hostId = Number(host.lastInsertRowid);
  const expertIds: number[] = [];
  for (let index = 0; index < expertCount; index += 1) {
    const row = insert.run(
      discussionId,
      `专家${index + 1}号`,
      `领域研究员${index + 1}`,
      `第${index + 1}位专家的立场陈述`,
      PALETTE[index + 1] ?? 'fuchsia',
      'expert',
      index + 1,
      locked,
    );
    expertIds.push(Number(row.lastInsertRowid));
  }
  return { hostId, expertIds };
}

export function seedAgentStatus(db: Db, discussionId: number, guestIds: number[]): void {  const insert = db.prepare(
    `INSERT INTO agent_status (discussion_id, guest_id, state, focus, updated_seq, updated_at)
     VALUES (?, ?, 'idle', NULL, 1, ?)`,
  );
  const at = new Date().toISOString();
  for (const guestId of guestIds) {
    insert.run(discussionId, guestId, at);
  }
}

export interface ReadySeed extends Lineup {
  discussionId: number;
}

/**
 * Direct-runner tests skip the HTTP start endpoint; this mirrors the row change
 * it makes (`state.running` / `run.started` are irrelevant to the loop).
 */
export function markRunning(db: Db, discussionId: number): void {
  db.prepare("UPDATE discussions SET status = 'running', started_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    discussionId,
  );
}

export function seedReadyDiscussion(
  db: Db,
  options: { topic?: string; expertCount?: number } = {},
): ReadySeed {
  const discussionId = insertDiscussion(db, {
    topic: options.topic,
    expertCount: options.expertCount,
    status: 'ready',
  });
  const lineup = insertLineup(db, discussionId, options.expertCount ?? 2, 1);
  seedAgentStatus(db, discussionId, [lineup.hostId, ...lineup.expertIds]);
  return { discussionId, ...lineup };
}

export type PromptKind = 'ledger' | 'speech' | 'interject' | 'extract' | 'summary';

export interface ScriptedCall {
  kind: PromptKind;
  request: ChatJsonRequest;
  prompt: string;
}

export interface Script {
  ledger: (index: number, prompt: string) => unknown;
  speech: (index: number, prompt: string) => string | Promise<string>;
  interject?: (index: number, prompt: string) => string | Promise<string>;
  extract?: (index: number, prompt: string) => unknown;
  summary?: (prompt: string) => string | Promise<string>;
}

export interface FakeLlm {
  client: ChatJsonClient;
  calls: ScriptedCall[];
  byKind(kind: PromptKind): ScriptedCall[];
}

export function classifyPrompt(module: string, prompt: string): PromptKind {
  if (module === 'ledger') {
    return 'ledger';
  }
  if (module === 'summary') {
    return prompt.includes('记录员') ? 'extract' : 'summary';
  }
  return prompt.includes('中途追问') ? 'interject' : 'speech';
}

export function promptText(request: ChatJsonRequest): string {
  return request.messages.map((message) => message.content).join('\n');
}

/**
 * Wraps a scripted transport in the real DeepSeek client so `llm_calls` rows are
 * written exactly as production would (`module` comes from the caller).
 */
export function createScriptedLlm(db: Db, script: Script): FakeLlm {
  const calls: ScriptedCall[] = [];
  const counters = new Map<PromptKind, number>();

  const client = createDeepSeekClient({
    db,
    transport: async (request) => {
      const prompt = promptText(request);
      const kind = classifyPrompt(request.module, prompt);
      const index = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, index);
      calls.push({ kind, request, prompt });

      switch (kind) {
        case 'ledger':
          return { raw: JSON.stringify(script.ledger(index, prompt)) };
        case 'speech':
          return { raw: JSON.stringify({ content: await script.speech(index, prompt) }) };
        case 'interject':
          return {
            raw: JSON.stringify({
              content:
                script.interject?.(index, prompt) ??
                `追问第${index}次：刚才专家1号提到成本，那体验这一面怎么解释？`,
            }),
          };
        case 'extract':
          return {
            raw: JSON.stringify(
              script.extract?.(index, prompt) ?? { consensus: [], divergence: [] },
            ),
          };
        case 'summary':
          return {
            raw: JSON.stringify({
              content:
                script.summary?.(prompt) ??
                '本场讨论围绕议题展开：多数嘉宾认可技术会改变工作方式，但在成本与体验谁更优先上存在明显分歧，一方强调效率与价格，另一方强调信任与长期体验。整体看，讨论从可行性转向了边界条件，但尚未给出统一结论。',
            }),
          };
        default:
          throw new Error(`unknown prompt kind: ${String(kind)}`);
      }
    },
  });

  return {
    client,
    calls,
    byKind(kind) {
      return calls.filter((call) => call.kind === kind);
    },
  };
}

/** A ledger object that keeps the discussion moving without stalling. */
export function speakLedger(speaker: string): unknown {
  return {
    is_request_satisfied: { reason: '讨论还在展开', answer: false },
    is_in_loop: { reason: '出现新角度', answer: false },
    is_progress_being_made: { reason: '有新论据', answer: true },
    next_speaker: { reason: '最久未发言', answer: speaker },
    speech_type: { reason: '补充新角度', answer: 'supplement' },
    instruction: { reason: '给出一个具体例子', answer: '给出一个具体例子' },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitFor(
  check: () => boolean,
  timeoutMs = 3000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
