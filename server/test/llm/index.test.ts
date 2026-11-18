import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLlmOverride, isFakeLlmEnabled } from '../../src/llm';

/**
 * Guard rail for the entry-point wiring (SESSION_MAP §S10).
 *
 * `server/src/index.ts` passes `createLlmOverride({ db })` into `buildApp`. If
 * this ever returned a *real* client when `FAKE_LLM` is unset, the routes'
 * `deps.llm === undefined && !isLlmConfigured()` preflight would never fire and
 * the contractual 500 `LLM_NOT_CONFIGURED` would silently disappear — with no
 * test turning red. These two assertions are the thing that turns red.
 */

const original = process.env.FAKE_LLM;

beforeEach(() => {
  delete process.env.FAKE_LLM;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.FAKE_LLM;
  } else {
    process.env.FAKE_LLM = original;
  }
});

describe('createLlmOverride', () => {
  it('returns undefined when FAKE_LLM is not set', () => {
    expect(isFakeLlmEnabled()).toBe(false);
    expect(createLlmOverride()).toBeUndefined();
  });

  it('returns undefined for any value other than "1"', () => {
    process.env.FAKE_LLM = '0';
    expect(createLlmOverride()).toBeUndefined();

    process.env.FAKE_LLM = 'true';
    expect(createLlmOverride()).toBeUndefined();
  });

  it('returns a ready client when FAKE_LLM=1', () => {
    process.env.FAKE_LLM = '1';
    expect(isFakeLlmEnabled()).toBe(true);

    const client = createLlmOverride();
    expect(client).toBeDefined();
    expect(typeof client?.complete).toBe('function');
  });
});
