/**
 * End-of-run finalization of consensus / divergence (AC-1.19, INV-5, H3).
 *
 * S6.5 leaves every extracted point `provisional`. Here they are merged once:
 * rows whose normalized text is identical collapse into the earliest row, the
 * keeper becomes `final`, the rest become `dropped`. Support lists are unioned
 * onto the keeper and never cleared (F5 "谁同意" renders from them).
 *
 * One-way only: the query only reads `provisional` rows, so a second pass is a
 * no-op and `dropped` can never resurrect. Every changed row emits
 * `*.updated` with its own `updated_seq` in the same transaction.
 */
import type { Db } from '../../db';
import { EventBus } from '../sse/bus';
import {
  appendEventInTx,
  serializeEventPayload,
  type PersistedEvent,
} from '../sse/publish';

export interface FinalizeDeps {
  discussionId: number;
  at: string;
  bus?: EventBus;
}

export interface FinalizeResult {
  consensus: { final: number; dropped: number };
  divergence: { final: number; dropped: number };
  events: PersistedEvent[];
}

interface PointRow {
  id: number;
  text: string;
  support_guest_ids: string | null;
  round_no: number | null;
  status: string;
}

interface PointTable {
  table: 'consensus_points' | 'divergence_points';
  event: 'consensus.updated' | 'divergence.updated';
  key: 'consensus' | 'divergence';
}

const TABLES: readonly PointTable[] = [
  { table: 'consensus_points', event: 'consensus.updated', key: 'consensus' },
  { table: 'divergence_points', event: 'divergence.updated', key: 'divergence' },
];

const PUNCTUATION = /[\s\u3000，。！？；：、,.!?;:'"“”‘’（）()【】\[\]〔〕《》〈〉—\-…·]/g;

function normalize(text: string): string {
  return text.replace(PUNCTUATION, '');
}

function parseSupport(raw: string | null): number[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry > 0,
    );
  } catch {
    return [];
  }
}

function unionSupport(rows: readonly PointRow[]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    for (const id of parseSupport(row.support_guest_ids)) {
      ids.add(id);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

export function finalizePoints(db: Db, deps: FinalizeDeps): FinalizeResult {
  const result: FinalizeResult = {
    consensus: { final: 0, dropped: 0 },
    divergence: { final: 0, dropped: 0 },
    events: [],
  };

  const commit = db.transaction((): PersistedEvent[] => {
    const events: PersistedEvent[] = [];

    for (const { table, event: eventType, key } of TABLES) {
      const rows = db
        .prepare(
          `SELECT id, text, support_guest_ids, round_no, status
             FROM ${table}
            WHERE discussion_id = ? AND status = 'provisional'
            ORDER BY id ASC`,
        )
        .all(deps.discussionId) as PointRow[];

      const groups = new Map<string, PointRow[]>();
      for (const row of rows) {
        const normalized = normalize(row.text);
        // An empty/ punctuation-only point has nothing to keep; give it a
        // unique key so it is dropped on its own instead of merging with peers.
        const groupKey = normalized.length > 0 ? normalized : `\u0000${row.id}`;
        const group = groups.get(groupKey);
        if (group === undefined) {
          groups.set(groupKey, [row]);
        } else {
          group.push(row);
        }
      }

      for (const group of groups.values()) {
        const keeper = group[0];
        if (keeper === undefined) {
          continue;
        }
        const mergedSupport = unionSupport(group);

        for (const row of group) {
          const status = row.id === keeper.id ? 'final' : 'dropped';
          const support = status === 'final' ? mergedSupport : parseSupport(row.support_guest_ids);
          const payload = serializeEventPayload(eventType, {
            point_id: row.id,
            text: row.text,
            status,
            support_guest_ids: support,
            round_no: row.round_no ?? 1,
          });
          const event = appendEventInTx(db, deps.discussionId, eventType, payload, deps.at);

          db.prepare(
            `UPDATE ${table}
                SET status = ?,
                    support_guest_ids = ?,
                    updated_seq = ?,
                    updated_at = ?
              WHERE id = ?`,
          ).run(status, JSON.stringify(support), event.seq, deps.at, row.id);

          events.push(event);
          if (status === 'final') {
            result[key].final += 1;
          } else {
            result[key].dropped += 1;
          }
        }
      }
    }

    return events;
  });

  const events = commit.immediate();
  result.events = events;
  deps.bus?.broadcast(deps.discussionId, events);
  return result;
}
