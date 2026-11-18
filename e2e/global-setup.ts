import { chromium } from '@playwright/test';

/**
 * E2E global setup — hardening for the one-off first-run failure recorded in
 * README §后续改进 (`NETWORK_ERROR` on the home page, then a 20s timeout).
 *
 * It runs once, after Playwright's `webServer` entries report ready and before
 * the first worker starts. Two gates:
 *
 * 1. Readiness of the exact hop the UI uses. `webServer.url` only proves each
 *    process answers on its own port: `http://127.0.0.1:5173/` is served by Vite
 *    itself, so it stays 200 even when the Vite -> API proxy is broken. Measured
 *    on this machine with the API stopped: `GET /` => 200, `GET /api/discussions`
 *    => 500 with an empty body. Nothing before this file ever requests that path
 *    (the in-spec `/health` preflight runs inside a test, i.e. after the failure
 *    would already have happened), so a broken proxy hop used to surface as an
 *    app error state plus a 20s `expect` timeout instead of a setup error.
 *
 * 2. One real browser load that waits for the home list to render, so any
 *    first-load-only window (cold module graph, dependency pre-bundling, a
 *    reload racing the initial fetch) is absorbed here. The recorded failure was
 *    a rejected `fetch` (status 0), which a 500 from the proxy would not produce,
 *    so the proxy gate alone is not assumed to be sufficient.
 *
 * Deliberately no test retries: the warm-up may reload the page a bounded number
 * of times, but if the app is genuinely broken all loads fail and the run stops
 * in setup with the reason. `retries` stays 0 in playwright.config.ts.
 */
const API_ORIGIN = 'http://127.0.0.1:8787';
const WEB_ORIGIN = 'http://127.0.0.1:5173';

/** Both `webServer` entries already waited up to 120s; this is just slack. */
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;

/** Cold-start warm-up: at most three loads inside 45s, never an unbounded loop. */
const WARMUP_LOADS = 3;
const WARMUP_WINDOW_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpOk(url: string, label: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = 'no attempt yet';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        return;
      }
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    await sleep(READY_POLL_MS);
  }

  throw new Error(`[e2e global-setup] ${label} never became ready at ${url} (last: ${last})`);
}

export default async function globalSetup(): Promise<void> {
  await waitForHttpOk(`${API_ORIGIN}/health`, 'API /health (direct, port 8787)');
  await waitForHttpOk(`${WEB_ORIGIN}/api/discussions`, 'Vite proxy -> API /api/discussions');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const deadline = Date.now() + WARMUP_WINDOW_MS;
    let last = 'no attempt yet';

    for (let attempt = 1; attempt <= WARMUP_LOADS && Date.now() < deadline; attempt += 1) {
      try {
        await page.goto(WEB_ORIGIN, { waitUntil: 'load', timeout: 20_000 });
        // Seeded data guarantees cards; one card proves the app mounted *and*
        // its list payload came back through the proxy.
        await page.locator('.dcard').first().waitFor({ state: 'visible', timeout: 15_000 });
        return;
      } catch (error) {
        last = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
        await sleep(500);
      }
    }

    throw new Error(
      `[e2e global-setup] home list never rendered after ${WARMUP_LOADS} loads (last: ${last})`,
    );
  } finally {
    await browser.close();
  }
}
