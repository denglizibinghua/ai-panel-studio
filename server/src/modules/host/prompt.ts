import type { ChatJsonMessage } from '../../llm/client';
import type { LedgerContext } from './ledger';

/**
 * Prompt construction for the host ledger (S4). Pure text assembly only —
 * retry/validation lives in `ledger.ts`, mirroring guest/lineup.ts.
 */

const JSON_TEMPLATE = [
  '{',
  '  "is_request_satisfied": {"reason": "", "answer": false},',
  '  "is_in_loop": {"reason": "", "answer": false},',
  '  "is_progress_being_made": {"reason": "", "answer": true},',
  '  "next_speaker": {"reason": "", "answer": ""},',
  '  "speech_type": {"reason": "", "answer": "challenge"},',
  '  "instruction": {"reason": "", "answer": ""}',
  '}',
].join('\n');

function renderRoster(ctx: LedgerContext): string {
  if (ctx.roster.length === 0) {
    return '（当前名单为空，没有可选嘉宾。）';
  }
  return ctx.roster
    .map(
      (member, index) =>
        `${index + 1}. ${member.name}｜${member.profession}｜立场：${member.stance}`,
    )
    .join('\n');
}

function renderRecentTurns(ctx: LedgerContext): string {
  if (ctx.recent_turns.length === 0) {
    return '（暂无发言，这是开场后的第一次调度。请选择最能打开局面的嘉宾。）';
  }
  return ctx.recent_turns
    .map(
      (turn, index) =>
        `${index + 1}. ${turn.speaker_name}（${turn.speech_type}）：${turn.content}`,
    )
    .join('\n');
}

export function buildLedgerMessages(ctx: LedgerContext): ChatJsonMessage[] {
  const system = [
    '你是「AI Panel Studio」圆桌讨论的主持人兼调度器。你的唯一职责是决定下一位发言者与发言方式，不要替嘉宾发言。',
    '',
    '【本轮名单】（每轮重新提供，名单外的人不存在，绝对不能选）',
    renderRoster(ctx),
    '',
    '你只能从这份名单里选人，名单外的人不存在。next_speaker.answer 必须逐字等于名单中的一个姓名。',
    '',
    '【规则】',
    '1. 每次发言 1–2 句，短促有力，不要长篇大论。',
    '2. 如果已有 3 位以上嘉宾表达过同一立场，不要再让人重复该立场；换一个角度，或直接提出挑战。',
    '3. speech_type 只能是 challenge / supplement / rebuttal / question 之一。',
    '4. instruction 是给下一位嘉宾的一句中文指令（≤200 字），写清"回应什么、从哪个角度"。',
    '5. 只输出严格 JSON：不要 markdown 代码块、不要解释、不要多余字段。每项都必须有 reason（一句话依据）与 answer（决策值）。',
    '',
    '【输出格式】',
    JSON_TEMPLATE,
    '',
    '【字段说明】',
    '- is_request_satisfied：议题是否已被充分讨论、可以进入总结收尾。',
    '- is_in_loop：最近发言是否在原地打转、反复重复同一立场。',
    '- is_progress_being_made：是否在产出新论点、新证据。',
    '- next_speaker：下一位发言者的姓名，必须逐字来自上面的名单。',
    '- speech_type：该嘉宾这次发言的类型。',
    '- instruction：给该嘉宾的一句中文指令。',
  ].join('\n');

  const user = [
    `【议题】${ctx.topic}`,
    `【进度】已发生专家发言 ${ctx.expert_turn_count} 条；上一轮停摆计数 ${ctx.prev_stall_count}（0–3，达到 3 表示讨论已停摆）。`,
    '',
    '【最近发言】',
    renderRecentTurns(ctx),
    '',
    '请基于以上信息输出本轮调度决策 JSON。',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function buildLedgerRetryMessages(
  messages: ChatJsonMessage[],
  issues: string[],
): ChatJsonMessage[] {
  const feedback = [
    '上一次输出未通过校验，问题如下（字段路径 / 规则名）：',
    ...issues.slice(0, 20).map((issue) => `- ${issue}`),
    '请修正后重新输出严格 JSON，包含全部 6 个决策项，且 next_speaker.answer 必须来自本轮名单。',
  ].join('\n');
  return [...messages, { role: 'user', content: feedback }];
}
