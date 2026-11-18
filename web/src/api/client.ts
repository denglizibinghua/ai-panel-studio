import type { ApiErrorBody } from './types';
import type {
  CancelDiscussionResponse,
  ConfirmGuestsResponse,
  DiscussionDetail,
  DiscussionSummary,
  GenerateGuestsResponse,
  RetrySummaryResponse,
  StartDiscussionResponse,
} from './types';

/**
 * Same-origin HTTP client for the local API (AGENTS §6.2: the browser never
 * holds a key and only talks to `/api`).
 *
 * - Base is `/api`; Vite's dev proxy forwards it to 127.0.0.1:8787.
 * - Every request carries a 15s timeout (`AbortSignal.timeout`).
 * - Non-2xx bodies are the contract's `{code, message}` shape; a non-JSON body
 *   degrades to a generic message instead of leaking HTML or a stack trace.
 * - No camelCase conversion lives here (AGENTS §6.10).
 */

const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 15_000;

/** `/health` lives outside `/api` (Vite proxies both — see vite.config.ts). */
const HEALTH_PATH = '/health';

/**
 * AC-3.8: the anonymous creator id. Persisted in localStorage (UUID) and sent
 * on create; the frontend hides write entries when a discussion's `session_id`
 * does not match. The backend does not authorise on it (v1 has no auth).
 */
const SESSION_KEY = 'ai-panel-session-id';
let cachedSessionId: string | null = null;

function randomUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getSessionId(): string {
  if (cachedSessionId !== null) {
    return cachedSessionId;
  }
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing !== null && existing.length > 0 && existing.length <= 64) {
      cachedSessionId = existing;
      return existing;
    }
  } catch {
    // Storage can be unavailable (private mode / blocked): fall through and
    // keep a per-tab id so this page session still owns what it creates.
  }
  const created = randomUuid();
  cachedSessionId = created;
  try {
    window.localStorage.setItem(SESSION_KEY, created);
  } catch {
    // Ignore: the in-memory id above is still usable for this tab.
  }
  return created;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toApiErrorBody(value: unknown): ApiErrorBody | null {
  if (!isRecord(value)) {
    return null;
  }
  const { code, message } = value;
  if (typeof code !== 'string' || typeof message !== 'string') {
    return null;
  }
  return { code, message };
}

function fallbackMessage(status: number): string {
  return `请求失败（HTTP ${status}）`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(0, 'REQUEST_TIMEOUT', '请求超时，请稍后重试');
    }
    throw new ApiError(0, 'NETWORK_ERROR', '网络异常，请确认后端服务正在运行');
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const errorBody = toApiErrorBody(body);
    if (errorBody !== null) {
      throw new ApiError(response.status, errorBody.code, errorBody.message);
    }
    throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', fallbackMessage(response.status));
  }

  if (body === null) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', '服务端返回了无法解析的内容');
  }

  return body as T;
}

export function listDiscussions(): Promise<DiscussionSummary[]> {
  return request<DiscussionSummary[]>(`${API_BASE}/discussions`);
}

export function createDiscussion(input: {
  topic: string;
  expert_count: number;
  session_id?: string;
}): Promise<DiscussionDetail> {
  const sessionId = input.session_id ?? getSessionId();
  return request<DiscussionDetail>(`${API_BASE}/discussions`, {
    method: 'POST',
    body: sessionId.length > 0 ? { ...input, session_id: sessionId } : input,
  });
}

export function getDiscussion(id: number): Promise<DiscussionDetail> {
  return request<DiscussionDetail>(`${API_BASE}/discussions/${id}`);
}

export function generateGuests(id: number): Promise<GenerateGuestsResponse> {
  return request<GenerateGuestsResponse>(`${API_BASE}/discussions/${id}/guests/generate`, {
    method: 'POST',
  });
}

export function confirmGuests(id: number): Promise<ConfirmGuestsResponse> {
  return request<ConfirmGuestsResponse>(`${API_BASE}/discussions/${id}/guests/confirm`, {
    method: 'POST',
  });
}

export function startDiscussion(id: number): Promise<StartDiscussionResponse> {
  return request<StartDiscussionResponse>(`${API_BASE}/discussions/${id}/start`, {
    method: 'POST',
  });
}

export function cancelDiscussion(id: number): Promise<CancelDiscussionResponse> {
  return request<CancelDiscussionResponse>(`${API_BASE}/discussions/${id}/cancel`, {
    method: 'POST',
  });
}

/** S9: `failed (ALL_SPEAKERS_FAILED) → finished`; 409 for any other status. */
export function retrySummary(id: number): Promise<RetrySummaryResponse> {
  return request<RetrySummaryResponse>(`${API_BASE}/discussions/${id}/retry-summary`, {
    method: 'POST',
  });
}

export interface HealthStatus {
  status: string;
  db: string;
  llm: string;
  now: string;
}

export function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>(HEALTH_PATH);
}

/** Message safe to show in an `AppEmpty` hint (never raw JSON / stack traces). */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '请求失败';
}
