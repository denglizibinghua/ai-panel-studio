import fs from 'node:fs';
import path from 'node:path';
import { createDb, type Db } from '../../src/db';
import { migrate } from '../../src/db/migrate';
import type { SseSink } from '../../src/modules/sse/bus';

export const dataDir = path.resolve(__dirname, '../data');
const tempFiles: string[] = [];
let counter = 0;

export interface ParsedFrame {
  id: number | null;
  event: string | null;
  data: string | null;
  comment: boolean;
}

/** Parses an accumulated SSE body into frames (test-side only). */
export function parseFrames(raw: string): ParsedFrame[] {
  return raw
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const frame: ParsedFrame = { id: null, event: null, data: null, comment: false };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) {
          frame.comment = true;
          continue;
        }
        if (line.startsWith('id: ')) {
          frame.id = Number.parseInt(line.slice(4), 10);
        } else if (line.startsWith('event: ')) {
          frame.event = line.slice(7);
        } else if (line.startsWith('data: ')) {
          frame.data = line.slice(6);
        }
      }
      return frame;
    });
}

/** Captures everything the bus writes; can simulate a client disconnect. */
export class FakeSink implements SseSink {
  readonly chunks: string[] = [];
  private readonly handlers = new Map<'close' | 'error', Array<() => void>>();

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  on(event: 'close' | 'error', listener: () => void): unknown {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: 'close' | 'error'): void {
    for (const listener of this.handlers.get(event) ?? []) {
      listener();
    }
  }

  get text(): string {
    return this.chunks.join('');
  }

  get pingCount(): number {
    return this.chunks.filter((chunk) => chunk === ': ping\n\n').length;
  }
}

export function createTempDb(label: string): Db {
  counter += 1;
  const file = path.join(dataDir, `test-sse-${label}-${process.pid}-${counter}.db`);
  tempFiles.push(file);
  const db = createDb(file);
  migrate(db);
  return db;
}

export function disposeTempDb(db: Db): void {
  db.close();
}

export function removeTempFiles(): void {
  for (const file of tempFiles.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${file}${suffix}`, { force: true });
      } catch {
        // Windows can still hold a handle when an assertion aborted a test early.
      }
    }
  }
}

export function insertDiscussion(
  db: Db,
  options: { topic?: string; expertCount?: number; status?: string } = {},
): number {
  const info = db
    .prepare('INSERT INTO discussions (topic, expert_count, status) VALUES (?, ?, ?)')
    .run(options.topic ?? '人工智能是否应取代教师', options.expertCount ?? 4, options.status ?? 'draft');
  return Number(info.lastInsertRowid);
}

const PALETTE = ['amber', 'rose', 'sky', 'emerald', 'violet', 'orange', 'teal', 'lime', 'indigo'] as const;

/** Inserts 1 host + `expertCount` experts with distinct names/colors. */
export function insertFullLineup(
  db: Db,
  discussionId: number,
  expertCount = 4,
  locked: 0 | 1 = 0,
): number[] {
  const insert = db.prepare(
    `INSERT INTO guests (discussion_id, name, profession, stance, color_id, role, speaking_order, locked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids: number[] = [];
  const host = insert.run(
    discussionId,
    '主持人林一',
    '圆桌主持人',
    '保持中立并推进讨论',
    PALETTE[0],
    'host',
    0,
    locked,
  );
  ids.push(Number(host.lastInsertRowid));
  for (let index = 0; index < expertCount; index += 1) {
    const row = insert.run(
      discussionId,
      `专家${index + 1}号`,
      `领域研究员${index + 1}`,
      `这是第${index + 1}位专家的立场陈述`,
      PALETTE[index + 1] ?? 'fuchsia',
      'expert',
      index + 1,
      locked,
    );
    ids.push(Number(row.lastInsertRowid));
  }
  return ids;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Polls `check` until it returns true or the budget expires. */
export async function waitFor(
  check: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export interface OpenStream {
  controller: AbortController;
  headers: Headers;
  text: () => string;
  done: Promise<void>;
}

/** Opens a real HTTP SSE stream (ES2022 lib has no DOM types). */
export async function openSseStream(
  url: string,
  lastEventId?: number,
): Promise<OpenStream> {
  const controller = new AbortController();
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (lastEventId !== undefined) {
    headers['Last-Event-ID'] = String(lastEventId);
  }
  const response = await fetch(url, { headers, signal: controller.signal });
  if (response.status !== 200) {
    throw new Error(`expected 200 from ${url}, got ${response.status}`);
  }
  if (response.body === null) {
    throw new Error('SSE response has no body');
  }

  let buffer = '';
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const done = (async () => {
    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    } catch {
      // AbortController is how the test disconnects; a rejected read is expected.
    }
  })();

  return { controller, headers: response.headers, text: () => buffer, done };
}
