import { z } from 'zod';
import { colorIdSchema, colorIdValues, guestRoleSchema } from '@ai-panel/shared';
import type { ChatJsonMessage } from '../../llm/client';

/**
 * LLM lineup contract: prompt construction + strict validation of one raw attempt.
 * The service owns retry/persistence; this file owns "is this output acceptable?".
 */

export const llmGuestSchema = z
  .object({
    name: z.string().trim().min(1).max(32),
    profession: z.string().trim().min(1).max(40),
    stance: z.string().trim().min(1).max(60),
    color_id: colorIdSchema,
    role: guestRoleSchema,
    speaking_order: z.number().int().min(0).max(8),
  })
  .strict();

export type LlmGuest = z.infer<typeof llmGuestSchema>;

const llmGuestsSchema = z.object({ guests: z.array(llmGuestSchema) }).strict();

export interface LineupAttempt {
  ok: boolean;
  guests: LlmGuest[];
  issues: string[];
  raw: string;
}

export function buildLineupMessages(topic: string, expertCount: number): ChatJsonMessage[] {
  const system = [
    '你是「AI Panel Studio」的嘉宾阵容设计师。',
    `请生成 1 位主持人（role="host"）和 ${expertCount} 位专家（role="expert"），共 ${expertCount + 1} 人。`,
    '只输出严格 JSON，不要 markdown 代码块、不要任何解释，格式为：',
    '{"guests":[{"name":"","profession":"","stance":"","color_id":"","role":"host|expert","speaking_order":0}]}',
    `color_id 必须从 10 色板中选取且互不重复：${colorIdValues.join(', ')}。`,
    'name 互不重复，全部使用中文输出。',
    'name ≤32 字，profession ≤40 字，stance 为一句话且 ≤60 字。',
    `speaking_order 为整数，必须恰好覆盖 0 到 ${expertCount}，主持人必须为 0。`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `议题：${topic}\n专家人数：${expertCount}\n请输出 1 位主持人和 ${expertCount} 位专家组成的嘉宾阵容 JSON。`,
    },
  ];
}

export function buildRetryMessages(
  messages: ChatJsonMessage[],
  issues: string[],
): ChatJsonMessage[] {
  const feedback = [
    '上一次输出未通过校验，问题如下（字段路径 / 规则名）：',
    ...issues.slice(0, 20).map((issue) => `- ${issue}`),
    '请修正后重新输出严格 JSON，只包含 guests 数组。',
  ].join('\n');
  return [...messages, { role: 'user', content: feedback }];
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function validateLineup(raw: string, expertCount: number): LineupAttempt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, guests: [], issues: ['(root): invalid_json'], raw };
  }

  const result = llmGuestsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`,
    );
    return { ok: false, guests: [], issues, raw };
  }

  const guests = result.data.guests;
  const issues: string[] = [];
  const hosts = guests.filter((guest) => guest.role === 'host');
  const experts = guests.filter((guest) => guest.role === 'expert');

  if (hosts.length !== 1) {
    issues.push(`guests.role: host_count expected 1, got ${hosts.length}`);
  }
  if (experts.length !== expertCount) {
    issues.push(`guests.role: expert_count expected ${expertCount}, got ${experts.length}`);
  }
  if (guests.length !== expertCount + 1) {
    issues.push(`guests: total_count expected ${expertCount + 1}, got ${guests.length}`);
  }
  if (new Set(guests.map((guest) => guest.color_id)).size !== guests.length) {
    issues.push('guests.color_id: duplicate_color');
  }
  if (new Set(guests.map((guest) => guest.name)).size !== guests.length) {
    issues.push('guests.name: duplicate_name');
  }

  const orders = guests.map((guest) => guest.speaking_order).sort((a, b) => a - b);
  if (!orders.every((order, index) => order === index)) {
    issues.push(`guests.speaking_order: expected_unique_range_0_to_${guests.length - 1}`);
  }
  const host = hosts[0];
  if (host !== undefined && host.speaking_order !== 0) {
    issues.push('guests.speaking_order: host_must_be_0');
  }

  if (issues.length > 0) {
    return { ok: false, guests: [], issues, raw };
  }
  return { ok: true, guests, issues: [], raw };
}
