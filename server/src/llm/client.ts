import { z } from 'zod';
import type { LlmModule } from '@ai-panel/shared';
import type { Db } from '../db';
import { getLlmApiKey, getLlmModel } from './config';

/**
 * The single LLM exit for the whole server (AGENTS.md §6.1).
 * Callers receive raw JSON text; domain validation belongs to the module service.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatJsonMessage {
  role: ChatRole;
  content: string;
}

export interface ChatJsonRequest {
  messages: ChatJsonMessage[];
  model?: string;
  timeoutMs?: number;
  discussionId?: number | null;
  /** 落 `llm_calls.module`；与 server/src/modules/ 同名（data-model §2.9）。 */
  module: LlmModule;
  isRetry?: boolean;
  /**
   * Pure predicate deciding whether the raw body counts as a successful call
   * for `llm_calls.success` (data-model §2.9). The client never imports domain
   * validators; callers pass their own. The raw body is returned either way.
   */
  validate?: (raw: string) => boolean;
}

export interface ChatJsonTransportResult {
  raw: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  model?: string;
}

export type ChatJsonTransport = (req: ChatJsonRequest) => Promise<ChatJsonTransportResult>;

export interface ChatJsonClient {
  complete(req: ChatJsonRequest): Promise<string>;
}

export type LlmErrorCode = 'LLM_NOT_CONFIGURED' | 'LLM_UPSTREAM_ERROR';

export class LlmError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

export class LlmNotConfiguredError extends LlmError {
  constructor(message = 'LLM_NOT_CONFIGURED') {
    super('LLM_NOT_CONFIGURED', message);
    this.name = 'LlmNotConfiguredError';
  }
}

export class LlmUpstreamError extends LlmError {
  constructor(message = 'LLM_UPSTREAM_ERROR') {
    super('LLM_UPSTREAM_ERROR', message);
    this.name = 'LlmUpstreamError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

const envelopeSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

function createDefaultTransport(): ChatJsonTransport {
  return async (req) => {
    const apiKey = getLlmApiKey();
    if (apiKey === null) {
      throw new LlmNotConfiguredError();
    }

    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model ?? getLlmModel(),
        messages: req.messages,
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new LlmUpstreamError(`LLM_UPSTREAM_ERROR HTTP ${response.status}`);
    }

    const envelope = envelopeSchema.safeParse(await response.json());
    const content = envelope.success ? envelope.data.choices[0]?.message.content : undefined;
    if (!envelope.success || content === undefined) {
      throw new LlmUpstreamError('LLM_UPSTREAM_ERROR unparseable envelope');
    }

    return {
      raw: content,
      ...(envelope.data.usage ?? {}),
      ...(envelope.data.model !== undefined ? { model: envelope.data.model } : {}),
    };
  };
}

function normalizeError(error: unknown): LlmError {
  if (error instanceof LlmError) {
    return error;
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new LlmUpstreamError('LLM_UPSTREAM_ERROR timeout');
  }
  return new LlmUpstreamError('LLM_UPSTREAM_ERROR request failed');
}

interface AuditEntry {
  discussionId: number | null;
  module: LlmModule;
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  isRetry: boolean;
  success: boolean;
  errorSummary: string | null;
}

function insertAuditRow(db: Db | null, entry: AuditEntry): void {
  if (db === null) {
    return;
  }
  try {
    db.prepare(
      `INSERT INTO llm_calls
         (discussion_id, module, provider, model, duration_ms,
          prompt_tokens, completion_tokens, total_tokens, is_retry, success, error_summary)
       VALUES (?, ?, 'deepseek', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.discussionId,
      entry.module,
      entry.model.slice(0, 64),
      entry.durationMs,
      entry.promptTokens ?? null,
      entry.completionTokens ?? null,
      entry.totalTokens ?? null,
      entry.isRetry ? 1 : 0,
      entry.success ? 1 : 0,
      entry.errorSummary,
    );
  } catch (error) {
    console.warn(
      'llm_calls audit insert failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}

export function createDeepSeekClient(
  deps: { transport?: ChatJsonTransport; db?: Db | null } = {},
): ChatJsonClient {
  const db = deps.db ?? null;
  const transport = deps.transport ?? createDefaultTransport();

  return {
    async complete(req: ChatJsonRequest): Promise<string> {
      const model = req.model ?? getLlmModel();
      const startedAt = Date.now();
      try {
        const result = await transport(req);
        const valid = req.validate === undefined ? true : req.validate(result.raw);
        insertAuditRow(db, {
          discussionId: req.discussionId ?? null,
          module: req.module,
          model: result.model ?? model,
          durationMs: Date.now() - startedAt,
          promptTokens: result.prompt_tokens,
          completionTokens: result.completion_tokens,
          totalTokens: result.total_tokens,
          isRetry: req.isRetry === true,
          success: valid,
          errorSummary: valid ? null : 'LLM_OUTPUT_INVALID',
        });
        return result.raw;
      } catch (error) {
        const normalized = normalizeError(error);
        insertAuditRow(db, {
          discussionId: req.discussionId ?? null,
          module: req.module,
          model,
          durationMs: Date.now() - startedAt,
          isRetry: req.isRetry === true,
          success: false,
          errorSummary: normalized.message.slice(0, 200),
        });
        throw normalized;
      }
    },
  };
}
