import { colorIdValues, type ColorId } from '@ai-panel/shared';
import {
  LlmUpstreamError,
  type ChatJsonRequest,
  type ChatJsonTransport,
  type ChatJsonTransportResult,
} from './client';

/**
 * Deterministic offline provider for E2E (SESSION_MAP §S10).
 *
 * This file is the only place that knows what a "模型输出" looks like without a
 * network call. It is wired in by `llm/index.ts` only when `FAKE_LLM=1`; the
 * production path never imports it.
 *
 * Contract it must keep (the modules validate strictly, so a lazy fixture would
 * turn into `ALL_SPEAKERS_FAILED` inside the first second):
 * - `guest`   -> 1 host + N experts, unique names/colours, speaking_order 0..N
 * - `ledger`  -> the exact 6-key decision object, `next_speaker` from the roster
 * - `turn`    -> `{"content":"..."}` (opening ≤400 chars, others ≤120)
 * - `summary` -> `{"content":"..."}` with 150–250 chars, OR the extraction shape
 *                when the prompt is the recorder prompt (same module name)
 *
 * Failure injection is keyed by the topic, not by a config file: a discussion
 * whose topic contains `#fail-turn` gets every **expert** call rejected, while
 * the host opening still succeeds. That asymmetry is deliberate — the retry
 * endpoint only uses `reason='retry_summary'` when the transcript is non-empty
 * (see docs/OPEN_ISSUES + S9 retry.ts); failing *every* `turn` call would leave
 * an empty transcript and exercise the `empty_transcript` branch instead.
 */

/** Topic marker that turns on the failure path (SESSION_MAP §S10 increment 3). */
export const FAKE_FAIL_TOPIC_MARKER = '#fail-turn';

const NAME_POOL: readonly string[] = [
  '林知远',
  '周慕白',
  '陈鹤鸣',
  '苏映雪',
  '顾清和',
  '白露生',
  '方既明',
  '叶澜清',
  '沈砚舟',
];

const PROFESSION_POOL: readonly string[] = [
  '技术评论员',
  '产品经理',
  '社会学研究者',
  '资深工程师',
  '媒体观察者',
  '投资分析师',
  '法律顾问',
  '教育学者',
  '医疗顾问',
];

const STANCE_POOL: readonly string[] = [
  '主张先小范围验证，再决定是否推广',
  '认为风险被高估，应当加快落地',
  '担心失控，主张先立规矩再放行',
  '持中间立场，强调分场景判断',
  '强调成本与公平，反对一刀切',
];

const SPEECH_TYPES = ['challenge', 'supplement', 'rebuttal', 'question'] as const;

const OPENING_MARKER = '开场：';
const INTERJECTION_MARKER = '你的任务是在讨论中途追问一次';
const RECORDER_MARKER = '记录员';

/**
 * 244 chars: inside the 150–250 window the summary module enforces, and long
 * enough that 390px really has to scroll (OPEN_ISSUES §11). Deliberately one
 * coherent paragraph — padding the same closing clause four times reads like a
 * rendering bug in the screenshots.
 */
const SUMMARY_TEXT =
  '本场讨论围绕议题是否应当被直接交付给模型展开，支持与反对双方都给出了具体理由。' +
  '支持的一方认为规则明确、结果可复现的检查适合交给模型，人只负责判断意图和权衡取舍；' +
  '反对的一方担心模型会稳定地放过同一类问题，团队因此慢慢失去自己发现问题的能力。' +
  '双方在责任归属上分歧最大：出错时该由工具的提供方负责，还是由签字确认的人负责。' +
  '关于推进节奏，一方主张先在小范围并行运行再逐步放量，另一方坚持必须先补齐审计与回滚手段。' +
  '讨论最终没有形成一致结论，但把争议收敛成三个可以分别验证的前提，留下了明确的下一步。';

const SUMMARY_MAX_CHARS = 250;

const CONSENSUS_TEMPLATES: readonly string[] = [
  '双方都认可成本压力真实存在，分歧只在由谁承担这一部分。',
  '多数嘉宾同意先做小范围验证，再决定是否全面铺开。',
  '讨论把问题拆成了技术可行性与责任归属两个独立议题。',
];

const DIVERGENCE_TEMPLATES: readonly string[] = [
  '推进节奏应该由市场自己决定，还是先由监管划定边界。',
  '出错时的第一责任落在工具提供方，还是落在签字确认的人。',
  '评审应当追求覆盖率，还是优先保证高风险路径不遗漏。',
];

function readDelayMs(): number {
  const raw = process.env.FAKE_LLM_DELAY_MS;
  if (raw === undefined) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * System and user text must be read separately.
 *
 * The user message embeds the recent transcript, and the opening's own text
 * starts with `开场：` — so matching that marker against the whole prompt makes
 * every later expert turn look like an opening (and silently disables failure
 * injection). Role-routing markers only ever appear in the system message.
 */
function systemOf(req: ChatJsonRequest): string {
  return req.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
}

function userOf(req: ChatJsonRequest): string {
  return req.messages
    .filter((message) => message.role !== 'system')
    .map((message) => message.content)
    .join('\n');
}

function pick(pool: readonly string[], index: number): string {
  const size = pool.length;
  const value = pool[((index % size) + size) % size];
  return value ?? pool[0] ?? '';
}

function colorAt(index: number): ColorId {
  const value = colorIdValues[index % colorIdValues.length];
  return value ?? 'amber';
}

/** `议题：xxx` (guest / turn / summary) or `【议题】xxx` (ledger). */
function readTopic(prompt: string): string {
  const inline = /议题：([^\n]+)/.exec(prompt)?.[1];
  if (inline !== undefined) {
    return inline.trim();
  }
  const bracketed = /【议题】([^\n]+)/.exec(prompt)?.[1];
  return bracketed?.trim() ?? '';
}

function readExpertCount(prompt: string): number {
  const direct = /专家人数：(\d+)/.exec(prompt)?.[1];
  if (direct !== undefined) {
    return clampExpertCount(Number.parseInt(direct, 10));
  }
  const total = /共\s*(\d+)\s*人/.exec(prompt)?.[1];
  if (total !== undefined) {
    return clampExpertCount(Number.parseInt(total, 10) - 1);
  }
  return 4;
}

function clampExpertCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 4;
  }
  return Math.min(8, Math.max(1, Math.trunc(value)));
}

/** Roster lines are `1. 姓名｜职业｜立场：...` (host/prompt.ts renderRoster). */
function readRosterNames(prompt: string): string[] {
  const names: string[] = [];
  const pattern = /^\s*\d+\.\s*([^｜\n]+)｜/gm;
  let match = pattern.exec(prompt);
  while (match !== null) {
    const name = match[1]?.trim();
    if (name !== undefined && name.length > 0) {
      names.push(name);
    }
    match = pattern.exec(prompt);
  }
  return names;
}

interface FakeGuest {
  name: string;
  profession: string;
  stance: string;
  color_id: ColorId;
  role: 'host' | 'expert';
  speaking_order: number;
}

function buildLineup(user: string): string {
  const expertCount = readExpertCount(user);
  const guests: FakeGuest[] = [
    {
      name: pick(NAME_POOL, 0),
      profession: pick(PROFESSION_POOL, 0),
      stance: pick(STANCE_POOL, 0),
      color_id: colorAt(0),
      role: 'host',
      speaking_order: 0,
    },
  ];
  for (let index = 1; index <= expertCount; index += 1) {
    guests.push({
      name: pick(NAME_POOL, index),
      profession: pick(PROFESSION_POOL, index),
      stance: pick(STANCE_POOL, index),
      color_id: colorAt(index),
      role: 'expert',
      speaking_order: index,
    });
  }
  return JSON.stringify({ guests });
}

function buildLedger(system: string, rotation: number): string {
  const names = readRosterNames(system);
  const fallback = pick(NAME_POOL, 1);
  const speaker = names.length > 0 ? (names[rotation % names.length] ?? fallback) : fallback;
  const speechType = SPEECH_TYPES[rotation % SPEECH_TYPES.length] ?? 'supplement';

  return JSON.stringify({
    is_request_satisfied: {
      reason: '议题仍有未被展开的角度，继续讨论',
      answer: false,
    },
    is_in_loop: {
      reason: '本轮引入了新的角度，没有重复已知立场',
      answer: false,
    },
    is_progress_being_made: {
      reason: '出现了新的论据与反问',
      answer: true,
    },
    next_speaker: {
      reason: '按轮转顺序轮到该嘉宾补充',
      answer: speaker,
    },
    speech_type: {
      reason: '换一种切入方式推进讨论',
      answer: speechType,
    },
    instruction: {
      reason: '需要落到具体证据',
      answer: '请用一个具体场景说明这个判断成立的前提。',
    },
  });
}

function buildTurn(system: string, rotation: number): string {
  if (system.includes(OPENING_MARKER)) {
    return JSON.stringify({
      content:
        '开场：本场议题的关键分歧在短期收益与长期代价之间，请各位先亮明立场，再说明你判断成立的前提。',
    });
  }
  if (system.includes(INTERJECTION_MARKER)) {
    return JSON.stringify({
      content: '刚才提到的代价能否用一个具体数字说明？如果换一个场景，这个结论还成立吗？',
    });
  }
  return JSON.stringify({
    content: `第${rotation}次发言：这个判断成立的前提需要拆开看，我倾向于先验证关键假设，再谈是否推广。`,
  });
}

function buildSummary(): string {
  const text =
    SUMMARY_TEXT.length > SUMMARY_MAX_CHARS ? SUMMARY_TEXT.slice(0, SUMMARY_MAX_CHARS) : SUMMARY_TEXT;
  return JSON.stringify({ content: text });
}

function buildExtraction(rotation: number): string {
  const index = rotation % CONSENSUS_TEMPLATES.length;
  return JSON.stringify({
    consensus: [CONSENSUS_TEMPLATES[index] ?? '双方都认可成本压力真实存在。'],
    divergence: [DIVERGENCE_TEMPLATES[index] ?? '推进节奏应该由市场决定，还是先由监管划定边界。'],
  });
}

interface FakeState {
  readonly ledgerCalls: Map<number, number>;
  readonly turnCalls: Map<number, number>;
  readonly extractCalls: Map<number, number>;
}

function bump(map: Map<number, number>, key: number): number {
  const next = (map.get(key) ?? 0) + 1;
  map.set(key, next);
  return next;
}

function keyOf(req: ChatJsonRequest): number {
  return req.discussionId ?? 0;
}

function shouldFail(req: ChatJsonRequest, system: string, user: string): boolean {
  if (req.module !== 'turn') {
    return false;
  }
  if (!readTopic(user).includes(FAKE_FAIL_TOPIC_MARKER)) {
    return false;
  }
  // Keep the host opening alive: an empty transcript sends retry-summary down
  // the \`empty_transcript\` branch, which is not what this scenario tests.
  return !system.includes(OPENING_MARKER);
}

function respond(req: ChatJsonRequest, system: string, user: string, state: FakeState): string {
  if (req.module === 'guest') {
    return buildLineup(user);
  }
  if (req.module === 'ledger') {
    return buildLedger(system, bump(state.ledgerCalls, keyOf(req)) - 1);
  }
  if (req.module === 'turn') {
    return buildTurn(system, bump(state.turnCalls, keyOf(req)));
  }
  // module === 'summary' covers both the recorder (extraction) and the closing
  // summary; only the system prompt tells them apart.
  if (system.includes(RECORDER_MARKER)) {
    return buildExtraction(bump(state.extractCalls, keyOf(req)));
  }
  return buildSummary();
}

export interface FakeTransportOptions {
  /** Fixed per-call latency; defaults to `FAKE_LLM_DELAY_MS`. */
  delayMs?: number;
}

export function createFakeTransport(options: FakeTransportOptions = {}): ChatJsonTransport {
  const delayMs = options.delayMs ?? readDelayMs();
  const state: FakeState = {
    ledgerCalls: new Map(),
    turnCalls: new Map(),
    extractCalls: new Map(),
  };

  return async (req: ChatJsonRequest): Promise<ChatJsonTransportResult> => {
    await sleep(delayMs);
    const system = systemOf(req);
    const user = userOf(req);
    if (shouldFail(req, system, user)) {
      throw new LlmUpstreamError('LLM_UPSTREAM_ERROR fake injected failure');
    }
    return {
      raw: respond(req, system, user, state),
      model: 'fake-llm',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
  };
}
