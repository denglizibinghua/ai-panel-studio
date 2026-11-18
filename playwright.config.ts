import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * S10 E2E (SESSION_MAP §S10).
 *
 * One browser context for the whole flow: `sessionId` lives in localStorage and
 * AC-3.8 decides write access by it, so a fresh context would lose every write
 * entry (the run fails with "button not found").
 *
 * The server runs with `FAKE_LLM=1` — the real DeepSeek path takes 1–3 minutes
 * per discussion, so the timeout is 180s even though the fake answers in
 * milliseconds. Seed runs first so the home page always has 进行中 / 已结束
 * groups, and re-runs stay green (seed is idempotent via `sample=1`).
 *
 * E2E owns its database: `AI_PANEL_DB` points both the seed step and the server
 * at `.e2e/app.db`, so the demo DB (`server/data/app.db`) never gains a row.
 */
const API_PORT = 8787;
const E2E_DB_PATH = path.resolve(process.cwd(), '.e2e/app.db');
const WEB_PORT = 5173;
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // A discussion run is ~27 model calls even with the fake; leave headroom.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  // Project-level `use` wins over the top-level one, so the viewport has to be
  // repeated here or `devices['Desktop Chrome']` would force 1280x720.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command:
        'pnpm -C server db:seed && pnpm -C server exec tsx src/index.ts',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        FAKE_LLM: '1',
        FAKE_LLM_DELAY_MS: '20',
        PORT: String(API_PORT),
        AI_PANEL_DB: E2E_DB_PATH,
      },
    },
    {
      // Vite's default host is `localhost`, which resolves to ::1 on this
      // machine (Windows + IPv6 first), so the readiness probe on 127.0.0.1
      // would never succeed. Pin the IPv4 host explicitly.
      command: `pnpm -C web exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
