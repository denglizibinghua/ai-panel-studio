/**
 * Host interjection (AC-1.25, F3 的「追问 / 串联」).
 *
 * Fired every 4 cumulative expert turns, never through the ledger. The question
 * must quote a concrete point from the last turns and push toward the most
 * divisive or least-developed thread — not summarize, not praise. It is written
 * as a normal turn (`speech_type='question'`, guest_id=host) by the runner and
 * is deliberately excluded from `expert_turn_count`, so it never triggers an
 * extraction window.
 *
 * `module: 'turn'` is passed here by design: this is speech generation, not
 * scheduling (data-model §2.9).
 */
import type { ChatJsonClient, ChatJsonMessage } from '../../llm/client';
import type { LedgerRecentTurn, LedgerRosterMember } from '../host/ledger';

export interface InterjectHost {
  id: number;
  name: string;
}

export interface InterjectContext {
  discussion_id: number;
  topic: string;
  host: InterjectHost;
  roster: LedgerRosterMember[];
  recent_turns: LedgerRecentTurn[];
}

const SYSTEM_PROMPT = [
  '你是圆桌讨论的主持人。你的任务是在讨论中途追问一次，把讨论推向更深处。',
  '只输出 JSON：{"content":"..."}，不要在 JSON 之外输出任何文字。',
  '要求：',
  '1. 必须点名引用最近发言里的具体观点（例如「刚才 X 提到……」）；',
  '2. 指向其中最分歧、或最没有被展开的一点，用一个问题逼出立场；',
  '3. 不要复述、不要总结、不要评价「大家说得都很好」；',
  '4. 中文，1–2 句，不超过 120 字。',
].join('\n');

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function parseContentJson(raw: string): string | null {
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
    // Not JSON: fall through to the plain-text fallback below.
  }
  if (body.startsWith('{') || body.startsWith('[')) {
    return null;
  }
  return body.length > 0 ? body : null;
}

/** Keeps the turn inside the 120-char CHECK by cutting at the last sentence end. */
export function truncateShortSpeech(text: string, limit = 120): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  const head = trimmed.slice(0, limit);
  const cut = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('；'),
  );
  return cut > 0 ? head.slice(0, cut + 1) : head;
}

export function buildInterjectMessages(ctx: InterjectContext): ChatJsonMessage[] {
  const recent = ctx.recent_turns
    .slice(-6)
    .map((turn) => `- ${turn.speaker_name}（${turn.speech_type}）：${turn.content}`)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `议题：${ctx.topic}`,
        `嘉宾：${ctx.roster.map((member) => `${member.name}（${member.profession}）`).join('、')}`,
        '最近发言：',
        recent.length > 0 ? recent : '（暂无）',
        '请只输出 {"content":"..."}。',
      ].join('\n'),
    },
  ];
}

/** Returns '' when the model output is unusable; the runner then skips the interjection. */
export async function generateInterjection(
  llm: ChatJsonClient,
  ctx: InterjectContext,
): Promise<string> {
  const raw = await llm.complete({
    messages: buildInterjectMessages(ctx),
    discussionId: ctx.discussion_id,
    module: 'turn',
    validate: (candidate) => parseContentJson(candidate) !== null,
  });

  const content = parseContentJson(raw);
  return content === null ? '' : truncateShortSpeech(content);
}
