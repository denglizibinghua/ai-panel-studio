/**
 * The single runtime write path into `events` (data-model.md §4 rule 1).
 *
 * Everything that persists an event goes through `appendEventInTx`, which takes
 * the next `seq` from the `discussions.last_event_seq` counter inside the
 * caller's transaction. `EventBus.publish` owns the usual transaction; `guest/
 * confirm` opens one transaction for the whole lock-down and reuses the helper.
 *
 * `turn.delta` is deliberately unpersistable: it is volatile by contract
 * (events.md §8.2) and must travel through `publishEphemeral` only. Letting it
 * into `events` would insert meaningless rows and pollute the `seq` stream that
 * S8 uses for deduplication.
 */
import { eventPayloadSchemaByType, eventTypeSchema, type EventType } from '@ai-panel/shared';
import type { Db } from '../../db';

export type PublishErrorCode =
  | 'DISCUSSION_NOT_FOUND'
  | 'INVALID_EVENT_TYPE'
  | 'TURN_DELTA_NOT_PERSISTED'
  | 'INVALID_PAYLOAD'
  | 'EVENT_TOO_LARGE'
  | 'EPHEMERAL_TYPE_NOT_ALLOWED'
  | 'PUBLISH_INSIDE_TRANSACTION';

export class PublishError extends Error {
  readonly code: PublishErrorCode;

  constructor(code: PublishErrorCode, message: string) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
  }
}

export interface PersistedEvent {
  seq: number;
  type: EventType;
  payload: string;
  created_at: string;
}

/** Every event type that may live in `events` — i.e. all but `turn.delta`. */
export function parsePersistableType(type: string): EventType {
  if (type === 'turn.delta') {
    throw new PublishError(
      'TURN_DELTA_NOT_PERSISTED',
      'turn.delta is volatile: use publishEphemeral, never publish',
    );
  }
  const parsed = eventTypeSchema.safeParse(type);
  if (!parsed.success) {
    throw new PublishError('INVALID_EVENT_TYPE', `unknown event type: ${type}`);
  }
  return parsed.data;
}

/**
 * Per-type *value* invariants that the shared zod schemas cannot express
 * (they are shared across sibling types). `publish` is the only writer, so this
 * is the last line of defence against a mislabelled event.
 */
function assertTypeInvariants(type: EventType, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new PublishError('INVALID_PAYLOAD', `payload for ${type} must be an object`);
  }
  const record = payload as Record<string, unknown>;

  if (type.startsWith('state.')) {
    const expected = type.slice('state.'.length);
    if (record.status !== expected) {
      throw new PublishError('INVALID_PAYLOAD', `${type} must carry status=${expected}`);
    }
  }

  if (type === 'consensus.added' || type === 'divergence.added') {
    if (record.status !== 'provisional') {
      throw new PublishError('INVALID_PAYLOAD', `${type} status must be provisional`);
    }
  }

  if (type === 'consensus.updated' || type === 'divergence.updated') {
    if (record.status !== 'final' && record.status !== 'dropped') {
      throw new PublishError('INVALID_PAYLOAD', `${type} status must be final or dropped`);
    }
  }
}

/**
 * Validates a payload against the frozen per-type schema and serialises it.
 * Returning the serialised string (instead of the object) keeps the stored and
 * pushed bytes identical, which is what makes replay byte-for-byte stable.
 */
export function serializeEventPayload(type: EventType, payload: unknown): string {
  if (type === 'turn.delta') {
    throw new PublishError(
      'TURN_DELTA_NOT_PERSISTED',
      'turn.delta is volatile: use publishEphemeral, never publish',
    );
  }
  const schema = eventPayloadSchemaByType[type];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new PublishError('INVALID_PAYLOAD', `invalid payload for ${type}`);
  }
  assertTypeInvariants(type, parsed.data);
  const text = JSON.stringify(parsed.data);
  if (Buffer.byteLength(text, 'utf8') > 4096) {
    throw new PublishError('EVENT_TOO_LARGE', `payload for ${type} exceeds 4096 bytes`);
  }
  return text;
}

/**
 * Appends one event inside the caller's transaction. Order is fixed by
 * data-model.md §4: bump the counter and take the number first, then insert.
 * Throws if the discussion does not exist (no event is written).
 */
export function appendEventInTx(
  db: Db,
  discussionId: number,
  type: EventType,
  payloadText: string,
  createdAt: string,
): PersistedEvent {
  const counter = db
    .prepare(
      `UPDATE discussions
          SET last_event_seq = last_event_seq + 1,
              updated_at     = ?
        WHERE id = ?
    RETURNING last_event_seq`,
    )
    .get(createdAt, discussionId) as { last_event_seq: number } | undefined;

  if (counter === undefined) {
    throw new PublishError('DISCUSSION_NOT_FOUND', '讨论不存在');
  }

  const seq = counter.last_event_seq;
  db.prepare(
    `INSERT INTO events (discussion_id, seq, type, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(discussionId, seq, type, payloadText, createdAt);

  return { seq, type, payload: payloadText, created_at: createdAt };
}
