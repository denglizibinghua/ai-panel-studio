/**
 * End-of-run summary (AC-1.14 / AC-1.15 / AC-1.16).
 *
 * The model is asked for a natural-language paragraph, but the prompt is not a
 * contract: the body is hard-validated here. 150–250 chars is enforced at
 * runtime; an out-of-range body triggers exactly one retry, and a second miss is
 * clamped to the boundary (and audited as `llm_calls(is_retry=1, success=0)`).
 * The fixed fallback text is only used when the call itself fails/times out, so
 * a summary turn is never written with an 88-char or 600-char body.
 *
 * Timeout is enforced twice: the client receives the remaining budget and the
 * module also races the promise, so injected clients (tests / future providers)
 * cannot hang the run.
 */
import type { ChatJsonClient, ChatJsonMessage } from '../../llm/client';
import type { LedgerRecentTurn } from '../host/ledger';

export const SUMMARY_MIN_CHARS = 150;
export const SUMMARY_MAX_CHARS = 250;
export const SUMMARY_TIMEOUT_MS = 30_000;

/** AC-1.15: empty transcript still `finished`, with this exact text. */
export const EMPTY_TRANSCRIPT_SUMMARY = '本场讨论未产生有效发言';
/** AC-1.16 / spec §4.3: summary call failed or timed out. */
export const SUMMARY_FAILURE_TEXT = '总结生成失败，请查看完整记录';

export interface SummaryContext {
  discussion_id: number;
  topic: string;
  transcript: LedgerRecentTurn[];
}

export interface SummaryResult {
  text: string;
  failed: boolean;
}

export interface SummaryOptions {
  /** Test seam; production uses `SUMMARY_TIMEOUT_MS` (spec §4.3). */
  timeout_ms?: number;
}

const SYSTEM_PROMPT = [
  '你是圆桌讨论的主持人，现在做收尾总结。',
  '只输出 JSON：{"content":"..."}，不要在 JSON 之外输出任何文字。',
  '要求：150–250 字中文纯文本；自然语言成段，不逐条罗列；',
  '至少点出一处主要分歧；不要出现 JSON 片段、不要评价流程。',
].join('\n');

export function buildSummaryMessages(ctx: SummaryContext): ChatJsonMessage[] {
  const transcript = ctx.transcript
    .map((turn) => `- ${turn.speaker_name}（${turn.speech_type}）：${turn.content}`)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `议题：${ctx.topic}`,
        '全场发言：',
        transcript.length > 0 ? transcript : '（暂无）',
      ].join('\n'),
    },
  ];
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

/** Accepts `{"content":"..."}`; a bare paragraph is tolerated as a fallback. */
function parseSummaryText(raw: string): string | null {
  const body = stripFences(raw);
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'content' in parsed &&
      typeof (parsed as { content: unknown }).content === 'string'
    ) {
      const text = (parsed as { content: string }).content.trim();
      return text.length > 0 ? text : null;
    }
  } catch {
    // Plain-text fallback below.
  }
  if (body.startsWith('{') || body.startsWith('[')) {
    return null;
  }
  return body.length > 0 ? body : null;
}

export function isSummaryLengthValid(text: string): boolean {
  return text.length >= SUMMARY_MIN_CHARS && text.length <= SUMMARY_MAX_CHARS;
}

const PAD_CLAUSE = '以上是本次讨论的主要脉络，相关问题仍有待进一步验证。';

function cutAtPunctuation(text: string): string {
  const head = text.slice(0, SUMMARY_MAX_CHARS);
  const cut = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('；'),
    head.lastIndexOf('，'),
  );
  if (cut + 1 >= SUMMARY_MIN_CHARS) {
    return head.slice(0, cut + 1);
  }
  return head;
}

/**
 * Forces a model body into 150–250 chars. Padding is a neutral closing clause
 * (never invented facts); truncation prefers the last sentence punctuation.
 */
export function clampSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length > SUMMARY_MAX_CHARS) {
    return cutAtPunctuation(trimmed);
  }
  let padded = trimmed;
  while (padded.length < SUMMARY_MIN_CHARS) {
    padded += PAD_CLAUSE;
  }
  return padded.length > SUMMARY_MAX_CHARS ? cutAtPunctuation(padded) : padded;
}

interface Attempt {
  text: string | null;
  inRange: boolean;
  failed: boolean;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('SUMMARY_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function attemptSummary(
  llm: ChatJsonClient,
  ctx: SummaryContext,
  isRetry: boolean,
  timeoutMs: number,
): Promise<Attempt> {
  try {
    const call = llm.complete({
      messages: buildSummaryMessages(ctx),
      discussionId: ctx.discussion_id,
      module: 'summary',
      isRetry,
      timeoutMs,
      validate: (candidate) => {
        const text = parseSummaryText(candidate);
        return text !== null && isSummaryLengthValid(text);
      },
    });
    // If the race below times out, this call keeps running in the background;
    // attach a handler so its eventual rejection is never "unhandled".
    void call.catch(() => undefined);
    const raw = await withTimeout(call, timeoutMs);
    const text = parseSummaryText(raw);
    return {
      text,
      inRange: text !== null && isSummaryLengthValid(text),
      failed: false,
    };
  } catch {
    return { text: null, inRange: false, failed: true };
  }
}

export async function generateSummary(
  llm: ChatJsonClient,
  ctx: SummaryContext,
  options: SummaryOptions = {},
): Promise<SummaryResult> {
  const deadline = Date.now() + (options.timeout_ms ?? SUMMARY_TIMEOUT_MS);
  const remaining = (): number => Math.max(1, deadline - Date.now());

  const first = await attemptSummary(llm, ctx, false, remaining());
  if (first.inRange && first.text !== null) {
    return { text: first.text, failed: false };
  }
  if (first.failed) {
    return { text: SUMMARY_FAILURE_TEXT, failed: true };
  }

  // One retry for an out-of-range body. The audit sees is_retry=1; `validate`
  // marks success=0 when this attempt is still outside the range.
  const second = await attemptSummary(llm, ctx, true, remaining());
  if (second.inRange && second.text !== null) {
    return { text: second.text, failed: false };
  }

  const candidate = second.text ?? first.text;
  if (candidate !== null) {
    return { text: clampSummary(candidate), failed: false };
  }
  return { text: SUMMARY_FAILURE_TEXT, failed: true };
}
