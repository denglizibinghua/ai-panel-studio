/**
 * In-memory SSE fan-out, isolated per discussion (contracts/events.md §2).
 *
 * Invariants this file is responsible for:
 * - `publish` persists first (single transaction, counter-issued `seq`) and only
 *   then pushes — "committed but not yet pushed" is allowed, "pushed but not
 *   committed" never happens (data-model.md §4.4).
 * - Subscribers are keyed by `discussion_id`; a subscriber of discussion A can
 *   never observe an event of discussion B.
 * - Replay is exclusive: `Last-Event-ID: k` yields only `seq > k`.
 * - Heartbeats are `: ping` with no `id`, run on an unref'd 15s timer, and are
 *   torn down together with the subscriber on close/error.
 * - `publishEphemeral` is the only path for `turn.delta`; it never writes a row,
 *   never emits `id:`, and rejects every other type.
 */
import { turnDeltaPayloadSchema } from '@ai-panel/shared';
import type { Db } from '../../db';
import {
  formatCaughtUpFrame,
  formatEphemeralFrame,
  formatEventFrame,
  HEARTBEAT_FRAME,
} from './frames';
import {
  appendEventInTx,
  parsePersistableType,
  PublishError,
  serializeEventPayload,
  type PersistedEvent,
} from './publish';

/** The slice of `http.ServerResponse` the bus depends on. */
export interface SseSink {
  write(chunk: string): boolean;
  on(event: 'close' | 'error', listener: () => void): unknown;
  /** Ends the response; required so shutdown cannot hang on a live stream. */
  end?: () => void;
}

export interface EventBusOptions {
  /** Heartbeat cadence; 15s per contract, shortened by tests. */
  heartbeatMs?: number;
  /** Injected for deterministic timestamps in tests. */
  now?: () => Date;
}

interface Subscriber {
  discussionId: number;
  sink: SseSink;
  heartbeat: ReturnType<typeof setInterval> | null;
  closed: boolean;
}

export interface Subscription {
  discussionId: number;
  unsubscribe: () => void;
}

export class EventBus {
  private readonly resolveDb: () => Db;
  private readonly heartbeatMs: number;
  private readonly now: () => Date;
  private readonly subscribers = new Map<number, Set<Subscriber>>();

  constructor(source: Db | (() => Db), options: EventBusOptions = {}) {
    this.resolveDb = typeof source === 'function' ? source : () => source;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Persists one event and pushes it to the discussion's subscribers.
   * Rejects `turn.delta` — that type is volatile and belongs to
   * `publishEphemeral` (events.md §8.2).
   */
  publish(discussionId: number, type: string, payload: unknown): PersistedEvent {
    const eventType = parsePersistableType(type);
    const payloadText = serializeEventPayload(eventType, payload);
    const createdAt = this.now().toISOString();

    const db = this.resolveDb();
    // A nested transaction only creates a SAVEPOINT, so broadcasting here would
    // push frames before the *caller's* COMMIT. That is the one state the
    // contract forbids ("pushed but not committed"): on rollback the seq gets
    // reused and reconnecting clients skip the real event forever. Callers that
    // own a wider transaction must use `appendEventInTx` + `broadcast` after it
    // commits, exactly like `guest/confirm`.
    if (db.inTransaction) {
      throw new PublishError(
        'PUBLISH_INSIDE_TRANSACTION',
        'publish() cannot run inside a transaction: use appendEventInTx + broadcast after commit',
      );
    }

    const append = db.transaction(() =>
      appendEventInTx(db, discussionId, eventType, payloadText, createdAt),
    );
    const event = append.immediate();

    this.broadcast(discussionId, [event]);
    return event;
  }

  /**
   * Pushes already-committed events (for callers such as `guest/confirm` that
   * own a wider transaction). Never writes to the DB.
   */
  broadcast(discussionId: number, events: PersistedEvent[]): void {
    const set = this.subscribers.get(discussionId);
    if (set === undefined || events.length === 0) {
      return;
    }
    const frames = events.map(formatEventFrame);
    for (const subscriber of [...set]) {
      for (const frame of frames) {
        this.writeChunk(subscriber, frame);
      }
    }
  }

  /**
   * Volatile push path. Whitelist is exactly `turn.delta`; anything else throws
   * so nobody can smuggle a persisted event past the `events` table.
   */
  publishEphemeral(discussionId: number, type: string, payload: unknown): void {
    if (type !== 'turn.delta') {
      throw new PublishError(
        'EPHEMERAL_TYPE_NOT_ALLOWED',
        `publishEphemeral only accepts turn.delta, got ${type}`,
      );
    }
    const parsed = turnDeltaPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new PublishError('INVALID_PAYLOAD', 'invalid payload for turn.delta');
    }
    const frame = formatEphemeralFrame('turn.delta', JSON.stringify(parsed.data));
    this.writeToDiscussion(discussionId, frame);
  }

  /**
   * Opens a stream: replays `seq > lastEventId`, sends `caught_up`, then
   * registers for live pushes and starts the heartbeat.
   *
   * Invariant: this function is fully synchronous. Replay is read, then the
   * subscriber is registered, then the frames are written — with no `await`
   * anywhere in between, so no live event can slip between the replay snapshot
   * and registration, and no live frame can interleave into the replay.
   */
  subscribe(
    discussionId: number,
    lastEventId: number | string | null | undefined,
    sink: SseSink,
  ): Subscription {
    const db = this.resolveDb();
    const discussion = db
      .prepare('SELECT last_event_seq FROM discussions WHERE id = ?')
      .get(discussionId) as { last_event_seq: number } | undefined;
    if (discussion === undefined) {
      throw new PublishError('DISCUSSION_NOT_FOUND', '讨论不存在');
    }

    const sinceSeq = normalizeLastEventId(lastEventId);
    const replay = db
      .prepare(
        `SELECT seq, type, payload
           FROM events
          WHERE discussion_id = ? AND seq > ?
          ORDER BY seq ASC`,
      )
      .all(discussionId, sinceSeq) as { seq: number; type: string; payload: string }[];

    const subscriber: Subscriber = { discussionId, sink, heartbeat: null, closed: false };
    const onClose = (): void => this.cleanup(subscriber);
    sink.on('close', onClose);
    sink.on('error', onClose);

    let set = this.subscribers.get(discussionId);
    if (set === undefined) {
      set = new Set<Subscriber>();
      this.subscribers.set(discussionId, set);
    }
    set.add(subscriber);

    for (const event of replay) {
      this.writeChunk(subscriber, formatEventFrame(event));
    }
    this.writeChunk(subscriber, formatCaughtUpFrame(discussion.last_event_seq));

    if (!subscriber.closed) {
      subscriber.heartbeat = setInterval(() => {
        this.writeChunk(subscriber, HEARTBEAT_FRAME);
      }, this.heartbeatMs);
      subscriber.heartbeat.unref?.();
    }

    return { discussionId, unsubscribe: () => this.cleanup(subscriber) };
  }

  /** Used by the route to answer 404 as JSON before any SSE headers go out. */
  hasDiscussion(discussionId: number): boolean {
    return (
      this.resolveDb().prepare('SELECT 1 AS ok FROM discussions WHERE id = ?').get(discussionId) !==
      undefined
    );
  }

  /** Number of live subscribers for one discussion (tests / diagnostics). */
  subscriberCount(discussionId: number): number {
    return this.subscribers.get(discussionId)?.size ?? 0;
  }

  /** Total live subscribers across every discussion. */
  totalSubscriberCount(): number {
    let total = 0;
    for (const set of this.subscribers.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Tears every stream down; called from Fastify's `preClose` hook so the
   * responses are ended *before* `server.close()` starts waiting for them.
   */
  closeAll(): void {
    for (const set of [...this.subscribers.values()]) {
      for (const subscriber of [...set]) {
        try {
          subscriber.sink.end?.();
        } catch {
          // Already destroyed; cleanup below still removes it from the map.
        }
        this.cleanup(subscriber);
      }
    }
  }

  private writeToDiscussion(discussionId: number, frame: string): void {
    const set = this.subscribers.get(discussionId);
    if (set === undefined) {
      return;
    }
    for (const subscriber of [...set]) {
      this.writeChunk(subscriber, frame);
    }
  }

  private writeChunk(subscriber: Subscriber, chunk: string): void {
    if (subscriber.closed) {
      return;
    }
    try {
      subscriber.sink.write(chunk);
    } catch {
      this.cleanup(subscriber);
    }
  }

  private cleanup(subscriber: Subscriber): void {
    if (subscriber.closed) {
      return;
    }
    subscriber.closed = true;
    if (subscriber.heartbeat !== null) {
      clearInterval(subscriber.heartbeat);
      subscriber.heartbeat = null;
    }
    const set = this.subscribers.get(subscriber.discussionId);
    if (set !== undefined) {
      set.delete(subscriber);
      if (set.size === 0) {
        this.subscribers.delete(subscriber.discussionId);
      }
    }
  }
}

/** Missing / malformed / negative values behave like `0` (events.md §2). */
export function normalizeLastEventId(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}
