import { z } from 'zod';
import {
  discussionStatusSchema,
  guestRowSchema,
  guestSchema,
  idSchema,
  type Guest,
} from '@ai-panel/shared';
import type { Db } from '../../db';
import { LlmError, type ChatJsonClient, type ChatJsonMessage } from '../../llm/client';
import {
  buildLineupMessages,
  buildRetryMessages,
  validateLineup,
  type LineupAttempt,
} from './lineup';

export type GenerateGuestsErrorCode =
  | 'DISCUSSION_NOT_FOUND'
  | 'GUESTS_ALREADY_LOCKED'
  | 'INVALID_STATE_TRANSITION'
  | 'GUEST_OUTPUT_INVALID'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_UPSTREAM_ERROR';

export class GenerateGuestsError extends Error {
  readonly code: GenerateGuestsErrorCode;

  constructor(code: GenerateGuestsErrorCode, message: string) {
    super(message);
    this.name = 'GenerateGuestsError';
    this.code = code;
  }
}

export interface GenerateGuestsResponse {
  discussion_id: number;
  status: 'draft';
  guests: Guest[];
}

export interface GenerateGuestsDeps {
  llm: ChatJsonClient;
  now?: () => Date;
}

const discussionRowSchema = z.object({
  id: idSchema,
  topic: z.string().min(1).max(200),
  expert_count: z.number().int().min(1).max(8),
  status: discussionStatusSchema,
});

const generateGuestsResponseSchema = z
  .object({
    discussion_id: idSchema,
    status: z.literal('draft'),
    guests: z.array(guestSchema).min(2).max(9),
  })
  .strict();

const guestProjectionSchema = guestRowSchema.omit({ created_at: true });

async function requestAttempt(
  llm: ChatJsonClient,
  discussionId: number,
  expertCount: number,
  messages: ChatJsonMessage[],
  isRetry: boolean,
): Promise<LineupAttempt> {
  let raw: string;
  try {
    raw = await llm.complete({
      messages,
      discussionId,
      module: 'guest',
      isRetry,
      validate: (candidate) => validateLineup(candidate, expertCount).ok,
    });
  } catch (error) {
    if (error instanceof LlmError) {
      const message =
        error.code === 'LLM_NOT_CONFIGURED' ? '未配置 DEEPSEEK_API_KEY' : '模型服务不可用';
      throw new GenerateGuestsError(error.code, message);
    }
    throw new GenerateGuestsError('LLM_UPSTREAM_ERROR', '模型服务不可用');
  }
  return validateLineup(raw, expertCount);
}

function loadDiscussion(db: Db, discussionId: number): z.infer<typeof discussionRowSchema> {
  const row = db
    .prepare('SELECT id, topic, expert_count, status FROM discussions WHERE id = ?')
    .get(discussionId);
  if (row === undefined) {
    throw new GenerateGuestsError('DISCUSSION_NOT_FOUND', '讨论不存在');
  }
  const parsed = discussionRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new Error('discussions row violates schema invariants');
  }
  return parsed.data;
}

function persistGuests(
  db: Db,
  discussionId: number,
  guests: LineupAttempt['guests'],
  now: () => Date,
): GenerateGuestsResponse {
  const timestamp = now().toISOString();

  const replace = db.transaction((): Guest[] => {
    const staleIds = db
      .prepare('SELECT id FROM guests WHERE discussion_id = ? AND locked = 0')
      .all(discussionId) as { id: number }[];

    if (staleIds.length > 0) {
      const placeholders = staleIds.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM agent_status WHERE discussion_id = ? AND guest_id IN (${placeholders})`,
      ).run(discussionId, ...staleIds.map((row) => row.id));
    }
    db.prepare('DELETE FROM guests WHERE discussion_id = ? AND locked = 0').run(discussionId);

    const insert = db.prepare(
      `INSERT INTO guests (discussion_id, name, profession, stance, color_id, role, speaking_order, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    );
    for (const guest of guests) {
      insert.run(
        discussionId,
        guest.name,
        guest.profession,
        guest.stance,
        guest.color_id,
        guest.role,
        guest.speaking_order,
      );
    }

    db.prepare('UPDATE discussions SET updated_at = ? WHERE id = ?').run(timestamp, discussionId);

    const rows = db
      .prepare(
        `SELECT id, discussion_id, name, profession, stance, color_id, role, speaking_order, locked
         FROM guests WHERE discussion_id = ? ORDER BY speaking_order ASC, id ASC`,
      )
      .all(discussionId);

    return rows.map((row) => {
      const parsed = guestProjectionSchema.parse(row);
      return {
        id: parsed.id,
        discussion_id: parsed.discussion_id,
        name: parsed.name,
        profession: parsed.profession,
        stance: parsed.stance,
        color_id: parsed.color_id,
        role: parsed.role,
        speaking_order: parsed.speaking_order,
        locked: parsed.locked === 1,
      };
    });
  });

  return generateGuestsResponseSchema.parse({
    discussion_id: discussionId,
    status: 'draft',
    guests: replace(),
  });
}

export async function generateGuests(
  db: Db,
  discussionId: number,
  deps: GenerateGuestsDeps,
): Promise<GenerateGuestsResponse> {
  const discussion = loadDiscussion(db, discussionId);

  const lockedRow = db
    .prepare('SELECT id FROM guests WHERE discussion_id = ? AND locked = 1 LIMIT 1')
    .get(discussionId);
  if (lockedRow !== undefined) {
    throw new GenerateGuestsError('GUESTS_ALREADY_LOCKED', '阵容已确认，不可重新生成');
  }
  if (discussion.status !== 'draft') {
    throw new GenerateGuestsError('INVALID_STATE_TRANSITION', '当前状态不允许生成嘉宾');
  }

  const messages = buildLineupMessages(discussion.topic, discussion.expert_count);
  let attempt = await requestAttempt(
    deps.llm,
    discussionId,
    discussion.expert_count,
    messages,
    false,
  );
  if (!attempt.ok) {
    console.warn('[guest] invalid LLM output (attempt 1):', attempt.issues.join('; '));
    console.warn('[guest] invalid raw output (attempt 1):', attempt.raw);
    attempt = await requestAttempt(
      deps.llm,
      discussionId,
      discussion.expert_count,
      buildRetryMessages(messages, attempt.issues),
      true,
    );
    if (!attempt.ok) {
      console.warn('[guest] invalid LLM output (attempt 2):', attempt.issues.join('; '));
      console.warn('[guest] invalid raw output (attempt 2):', attempt.raw);
      throw new GenerateGuestsError('GUEST_OUTPUT_INVALID', '嘉宾输出校验失败');
    }
  }

  return persistGuests(db, discussionId, attempt.guests, deps.now ?? (() => new Date()));
}
