import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Shared E2E helpers (SESSION_MAP §S10).
 *
 * No assertions live here — only the two things both specs need: screenshots on
 * disk and the ability to read the persisted event log back (the UI never shows
 * `run.finished.reason`, and `GET /discussions/:id` does not expose turns).
 */

export const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');
export const API_ORIGIN = 'http://127.0.0.1:8787';

export function ensureScreenshotDir(): void {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

export async function shot(page: Page, name: string): Promise<void> {
  ensureScreenshotDir();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

export interface PersistedFrame {
  id: number | null;
  type: string;
  data: string;
}

function parseFrame(block: string): PersistedFrame | null {
  let id: number | null = null;
  let type: string | null = null;
  const data: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('id: ')) {
      const parsed = Number.parseInt(line.slice(4).trim(), 10);
      id = Number.isNaN(parsed) ? null : parsed;
      continue;
    }
    if (line.startsWith('event: ')) {
      type = line.slice(7).trim();
      continue;
    }
    if (line.startsWith('data: ')) {
      data.push(line.slice(6));
    }
  }

  if (type === null) {
    return null;
  }
  return { id, type, data: data.join('\n') };
}

/**
 * Replays `events` from seq 0 and returns every frame up to `caught_up`.
 * Aborts as soon as the replay is done so the connection never stays open.
 */
export async function readEventLog(discussionId: number): Promise<PersistedFrame[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const frames: PersistedFrame[] = [];

  try {
    const response = await fetch(`${API_ORIGIN}/api/discussions/${discussionId}/events`, {
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': '0' },
      signal: controller.signal,
    });
    if (!response.ok || response.body === null) {
      throw new Error(`events stream failed: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const frame = parseFrame(block);
        if (frame === null) {
          continue;
        }
        if (frame.type === 'caught_up') {
          finished = true;
          break;
        }
        frames.push(frame);
      }
    }

    await reader.cancel().catch(() => undefined);
  } catch (error) {
    // The abort below is the normal exit path once `caught_up` arrived.
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      throw error;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  return frames;
}

interface SpeakingWindow {
  __sawSpeaking?: boolean;
}

export const SAW_SPEAKING_KEY = '__sawSpeaking';

/**
 * Records whether the `发言中` badge was ever mounted.
 *
 * The fake answers in ~20ms, so a plain `waitFor` can miss the badge between
 * two polls; a MutationObserver installed before navigation cannot.
 */
export async function installSpeakingWatcher(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __sawSpeaking?: boolean };
    const record = (): void => {
      if (document.body !== null && (document.body.textContent ?? '').includes('发言中')) {
        target.__sawSpeaking = true;
      }
    };
    const start = (): void => {
      record();
      const observer = new MutationObserver(record);
      if (document.body !== null) {
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  });
}

export async function sawSpeaking(page: Page): Promise<boolean> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key] === true,
    SAW_SPEAKING_KEY,
  );
}

export function discussionIdFromUrl(url: string): number {
  const match = /\/discussions\/(\d+)\//.exec(url);
  const id = match?.[1];
  if (id === undefined) {
    throw new Error(`no discussion id in URL: ${url}`);
  }
  return Number.parseInt(id, 10);
}
