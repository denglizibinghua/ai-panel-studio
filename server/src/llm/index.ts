import type { Db } from '../db';
import { createDeepSeekClient, type ChatJsonClient } from './client';
import { createFakeTransport } from './fake';

/**
 * Provider selection point for the whole server (SESSION_MAP §S10).
 *
 * `createLlmOverride` returns `undefined` unless `FAKE_LLM=1`. Returning
 * `undefined` (rather than a client) is deliberate: the routes own the
 * `deps.llm === undefined && !isLlmConfigured()` preflight, so a real client
 * built here would silently swallow the contract's 500 `LLM_NOT_CONFIGURED`.
 *
 * The fake is injected at the **transport** level, not by replacing the
 * client, so `llm_calls` audit rows, retry flags and `success` marking all run
 * the production code path.
 */
export function isFakeLlmEnabled(): boolean {
  return process.env.FAKE_LLM === '1';
}

export interface LlmClientDeps {
  db?: Db | null;
}

export function createFakeLlmClient(deps: LlmClientDeps = {}): ChatJsonClient {
  return createDeepSeekClient({ db: deps.db ?? null, transport: createFakeTransport() });
}

export function createLlmOverride(deps: LlmClientDeps = {}): ChatJsonClient | undefined {
  return isFakeLlmEnabled() ? createFakeLlmClient(deps) : undefined;
}
