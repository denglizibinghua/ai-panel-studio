/**
 * SSE wire format (contracts/events.md §1.2 / §1.3).
 *
 * Every frame ends with a blank line. Persisted frames always carry `id:` (the
 * discussion-scoped `events.seq`), `event:` (the raw `events.type`) and `data:`
 * (the stored payload JSON, byte-for-byte). Control frames never carry `id:` and
 * never take a `seq`.
 */

export interface PersistedFrame {
  seq: number;
  type: string;
  payload: string;
}

/** `id: 7\nevent: turn.done\ndata: {...}\n\n` */
export function formatEventFrame(event: PersistedFrame): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${event.payload}\n\n`;
}

/**
 * `event: turn.delta\ndata: {...}\n\n` — no `id:` because the event is volatile
 * and is never written to `events` (events.md §8.2).
 */
export function formatEphemeralFrame(type: string, payload: string): string {
  return `event: ${type}\ndata: ${payload}\n\n`;
}

/** `event: caught_up\ndata: {"up_to_seq":42}\n\n` — no `id:`, no `seq` (events.md §1.3). */
export function formatCaughtUpFrame(upToSeq: number): string {
  return `event: caught_up\ndata: ${JSON.stringify({ up_to_seq: upToSeq })}\n\n`;
}

/** Comment frame: no `id:`, no `event:`, no `data:` (events.md §1.3). */
export const HEARTBEAT_FRAME = ': ping\n\n';
