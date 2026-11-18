/**
 * Incremental consensus / divergence extraction (AC-1.18, F5).
 *
 * Every 2 expert turns the runner calls `extractPoints` with the last 4 turns
 * and then `persistExtraction`, which writes new rows as `provisional` and
 * appends `consensus.added` / `divergence.added` in the same transaction
 * (`appendEventInTx`, broadcast after commit — never `publish()` inside one).
 *
 * The event `seq` must be greater than the `turn.done` that triggered the
 * window; that falls out of the ordering: the runner commits the turn first and
 * only then runs extraction.
 *
 * Model failures are non-fatal by contract (spec §4.3: skip this window, do not
 * block scheduling), so this module returns empty arrays instead of throwing on
 * invalid output.
 */
import { z } from 'zod';
import type { Db } from '../../db';
import type { ChatJsonClient, ChatJsonMessage } from '../../llm/client';
import type { LedgerRecentTurn, LedgerRosterMember } from '../host/ledger';
import { EventBus } from '../sse/bus';
import {
  appendEventInTx,
  serializeEventPayload,
  type PersistedEvent,
} from '../sse/publish';

export interface ExtractContext {
  discussion_id: number;
  topic: string;
  transcript: LedgerRecentTurn[];
  roster: LedgerRosterMember[];
}

export interface ExtractedPoint {
  text: string;
  /** Roster names the model says actually hold this view; never guessed here. */
  supporters: string[];
}

export interface ExtractedPoints {
  consensus: ExtractedPoint[];
  divergence: ExtractedPoint[];
}

/**
 * One point is either the structured object or a legacy bare string. The legacy
 * form is still accepted so an older model response is not thrown away, but it
 * carries no supporter signal: `supporters` stays empty rather than falling back
 * to substring matching.
 */
const pointSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    supporters: z.array(z.string()).default([]),
  }),
]);

const extractionSchema = z
  .object({
    consensus: z.array(pointSchema).default([]),
    divergence: z.array(pointSchema).default([]),
  })
  .strict();

const SYSTEM_PROMPT = [
  '你是圆桌讨论的记录员，负责从最近几条发言里提炼共识与分歧。',
  '只输出 JSON：{"consensus":[{"text":"...","supporters":["姓名"]}],"divergence":[{"text":"...","supporters":["姓名"]}]}。',
  '每条 text 必须是中文一句话，不超过 120 字；没有就返回空数组。',
  'supporters 只填真正持该观点的阵容嘉宾姓名，必须与阵容完全一致；不确定就填 []，不要臆造姓名。',
  '共识写成所有或多数人都认可的判断；分歧必须写明对立的两面。',
  '不要复述原句，不要评价，不要输出 JSON 以外的任何文字。',
].join('\n');

export function buildExtractMessages(ctx: ExtractContext): ChatJsonMessage[] {
  const speeches = ctx.transcript
    .slice(-4)
    .map((turn) => `- ${turn.speaker_name}（${turn.speech_type}）：${turn.content}`)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `议题：${ctx.topic}`,
        `阵容：${ctx.roster.map((member) => `${member.name}（${member.profession}）`).join('、')}`,
        '最近 4 条发言：',
        speeches.length > 0 ? speeches : '（暂无）',
      ].join('\n'),
    },
  ];
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function truncatePoint(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 120) {
    return trimmed;
  }
  const head = trimmed.slice(0, 120);
  const cut = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('；'),
  );
  return cut > 0 ? head.slice(0, cut + 1) : head;
}

export async function extractPoints(
  llm: ChatJsonClient,
  ctx: ExtractContext,
): Promise<ExtractedPoints> {
  const messages = buildExtractMessages(ctx);
  const raw = await llm.complete({
    messages,
    discussionId: ctx.discussion_id,
    module: 'summary',
    validate: (candidate) => {
      try {
        return extractionSchema.safeParse(JSON.parse(stripFences(candidate))).success;
      } catch {
        return false;
      }
    },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { consensus: [], divergence: [] };
  }
  const result = extractionSchema.safeParse(parsed);
  if (!result.success) {
    return { consensus: [], divergence: [] };
  }

  return {
    consensus: normalizePoints(result.data.consensus),
    divergence: normalizePoints(result.data.divergence),
  };
}

type RawPoint = z.infer<typeof pointSchema>;

/** Truncates text and sanitises `supporters`; a legacy string gets no support. */
function normalizePoints(items: RawPoint[]): ExtractedPoint[] {
  const points: ExtractedPoint[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const text = truncatePoint(item);
      if (text.length > 0) {
        points.push({ text, supporters: [] });
      }
      continue;
    }

    const text = truncatePoint(item.text);
    if (text.length === 0) {
      continue;
    }
    const supporters = [
      ...new Set(item.supporters.map((name) => name.trim()).filter((name) => name.length > 0)),
    ];
    points.push({ text, supporters });
  }
  return points;
}

export interface PersistExtractionDeps {
  discussionId: number;
  roundNo: number;
  points: ExtractedPoints;
  at: string;
  /** Locked lineup; names mentioned in a point map back to `guests.id`. */
  roster?: LedgerRosterMember[];
  bus?: EventBus;
}

interface PointRow {
  id: number;
  text: string;
}

/**
 * F5 "谁同意" support: the model names supporters explicitly, and only exact
 * roster names are accepted. Unknown names are dropped (never guessed),
 * duplicates are deduped, and the result is sorted ascending.
 */
export function resolveSupportGuestIds(
  names: readonly string[],
  roster: readonly LedgerRosterMember[] | undefined,
): number[] {
  if (roster === undefined || names.length === 0) {
    return [];
  }
  const idByName = new Map<string, number>();
  for (const member of roster) {
    idByName.set(member.name, member.id);
  }
  const ids = new Set<number>();
  for (const name of names) {
    const id = idByName.get(name.trim());
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

const insertSql = (table: string): string =>
  `INSERT INTO ${table}
     (discussion_id, text, status, support_guest_ids, round_no, updated_seq, created_at, updated_at)
   VALUES (?, ?, 'provisional', ?, ?, 1, ?, ?)
   ON CONFLICT(discussion_id, text) DO NOTHING`;

/**
 * Writes both point tables and their events in one transaction. Rows whose text
 * already exists (uq_*_text) are skipped, so repeated windows never duplicate
 * entries or re-emit events.
 */
export function persistExtraction(db: Db, deps: PersistExtractionDeps): PersistedEvent[] {
  const insertConsensus = db.prepare(insertSql('consensus_points'));
  const insertDivergence = db.prepare(insertSql('divergence_points'));

  const write = (
    kind: 'consensus' | 'divergence',
    points: ExtractedPoint[],
    events: PersistedEvent[],
  ): void => {
    const insert = kind === 'consensus' ? insertConsensus : insertDivergence;
    const table = kind === 'consensus' ? 'consensus_points' : 'divergence_points';
    const type = kind === 'consensus' ? 'consensus.added' : 'divergence.added';

    for (const point of points) {
      const support = resolveSupportGuestIds(point.supporters, deps.roster);
      const info = insert.run(
        deps.discussionId,
        point.text,
        JSON.stringify(support),
        deps.roundNo,
        deps.at,
        deps.at,
      );
      if (info.changes === 0) {
        continue;
      }
      const row = db.prepare(`SELECT id, text FROM ${table} WHERE id = ?`).get(
        Number(info.lastInsertRowid),
      ) as PointRow | undefined;
      if (row === undefined) {
        continue;
      }

      const payload = serializeEventPayload(type, {
        point_id: row.id,
        text: row.text,
        status: 'provisional',
        support_guest_ids: support,
        round_no: deps.roundNo,
      });
      const event = appendEventInTx(db, deps.discussionId, type, payload, deps.at);
      db.prepare(`UPDATE ${table} SET updated_seq = ?, updated_at = ? WHERE id = ?`).run(
        event.seq,
        deps.at,
        row.id,
      );
      events.push(event);
    }
  };

  const commit = db.transaction((): PersistedEvent[] => {
    const events: PersistedEvent[] = [];
    write('consensus', deps.points.consensus, events);
    write('divergence', deps.points.divergence, events);
    return events;
  });

  const events = commit.immediate();
  deps.bus?.broadcast(deps.discussionId, events);
  return events;
}
