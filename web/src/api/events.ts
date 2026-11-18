/**
 * Hand-written SSE client over `fetch` + `ReadableStream` (SESSION_MAP §S8 item 2).
 *
 * `EventSource` is deliberately not used — it cannot send `Last-Event-ID`,
 * reconnects automatically on HTTP 404 (AC-3.6 forbids that), and cannot tell a
 * server-side end apart from a dropped socket. Owning the reader gives us all
 * three behaviours the contract requires.
 *
 * Frames look exactly like `specs/001-panel/contracts/events.md` §1.2:
 *
 *   id: 12
 *   event: turn.done
 *   data: {...}
 *   <blank line>
 *
 * `: ping` heartbeats are comment lines and are ignored. `event: caught_up`
 * (§1.3) has no id and is a control signal, never a business event.
 */

export interface SseFrame {
  /** Numeric `events.seq`; `null` for volatile frames (`turn.delta`). */
  id: number | null;
  type: string;
  data: string;
}

export interface SubscribeOptions {
  discussionId: number;
  /** 0 on the first connect → full replay from seq=1 (events.md §2). */
  lastEventId: number;
  /** Re-read right before every reconnect so retries never skip a frame. */
  getLastSeq: () => number;
  signal: AbortSignal;
  onFrame(frame: SseFrame): void;
  onCaughtUp(): void;
  onClosed(reason: 'eof' | 'not_found' | 'aborted' | 'gave_up'): void;
  onError(message: string): void;
}

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_ATTEMPTS = 3;

type StreamOutcome = 'aborted' | 'not_found' | 'eof';

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(onDone, ms);
    function onDone(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', onDone);
      resolve();
    }
    signal.addEventListener('abort', onDone, { once: true });
  });
}

function handleRawFrame(raw: string, opts: SubscribeOptions): void {
  let idRaw: string | null = null;
  let type = '';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.length === 0) {
      continue;
    }
    // Comment line: `: ping` heartbeat (§1.3). Never dispatched, no seq.
    if (line.startsWith(':')) {
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'id') {
      idRaw = value;
    } else if (field === 'event') {
      type = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }

  // Catch-up control frame: no id, no seq, must not reach the dispatcher.
  if (type === 'caught_up') {
    opts.onCaughtUp();
    return;
  }
  if (type.length === 0) {
    return;
  }

  const id = idRaw !== null && /^\d+$/.test(idRaw) ? Number(idRaw) : null;
  opts.onFrame({ id, type, data: dataLines.join('\n') });
}

/** Splits a buffer on blank lines, dispatching every complete frame. */
function drainFrames(buffer: string, opts: SubscribeOptions): string {
  let rest = buffer;
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const raw = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    if (raw.length > 0) {
      handleRawFrame(raw, opts);
    }
    boundary = rest.indexOf('\n\n');
  }
  return rest;
}

async function readStream(opts: SubscribeOptions, lastEventId: number): Promise<StreamOutcome> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (lastEventId > 0) {
    headers['Last-Event-ID'] = String(lastEventId);
  }

  let response: Response;
  try {
    response = await fetch(`/api/discussions/${opts.discussionId}/events`, {
      headers,
      signal: opts.signal,
    });
  } catch {
    return opts.signal.aborted ? 'aborted' : 'eof';
  }

  // AC-3.6: a missing discussion is terminal — never reconnect on 404.
  if (response.status === 404) {
    return 'not_found';
  }

  if (!response.ok || response.body === null) {
    if (opts.signal.aborted) {
      return 'aborted';
    }
    opts.onError(`实时连接失败（HTTP ${response.status}）`);
    return 'eof';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      // SSE only terminates lines with LF; normalise CRLF defensively.
      if (buffer.includes('\r')) {
        buffer = buffer.replace(/\r/g, '');
      }
      buffer = drainFrames(buffer, opts);
    }
  } catch {
    return opts.signal.aborted ? 'aborted' : 'eof';
  } finally {
    if (opts.signal.aborted) {
      void reader.cancel().catch(() => undefined);
    }
  }

  return opts.signal.aborted ? 'aborted' : 'eof';
}

/**
 * Opens the event stream and keeps it open until the caller aborts, the
 * discussion is missing, or three reconnect attempts fail in a row.
 */
export async function subscribeDiscussionEvents(opts: SubscribeOptions): Promise<void> {
  let attempt = 0;

  for (;;) {
    if (opts.signal.aborted) {
      opts.onClosed('aborted');
      return;
    }

    const lastEventId = attempt === 0 ? opts.lastEventId : opts.getLastSeq();
    const outcome = await readStream(opts, lastEventId);

    if (outcome === 'aborted') {
      opts.onClosed('aborted');
      return;
    }
    if (outcome === 'not_found') {
      opts.onClosed('not_found');
      return;
    }

    // Socket ended without abort → network loss. Back off 1s / 2s / 4s.
    attempt += 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      opts.onClosed('gave_up');
      return;
    }
    opts.onError(`实时连接中断，正在第 ${attempt} 次重连`);
    await wait(INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1), opts.signal);
  }
}
