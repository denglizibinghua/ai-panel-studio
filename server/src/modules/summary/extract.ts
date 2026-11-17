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

export interface ExtractedPoints {
  consensus: string[];
  divergence: string[];
}

const extractionSchema = z
  .object({
    consensus: z.array(z.string()).default([]),
    divergence: z.array(z.string()).default([]),
  })
  .strict();

const SYSTEM_PROMPT = [
  '你是圆桌讨论的记录员，负责从最近几条发言里提炼共识与分歧。',
  '只输出 JSON：{"consensus":["..."],"divergence":["..."]}。',
  '每条必须是中文一句话，不超过 120 字；没有就返回空数组。',
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

  const clean = (items: string[]): string[] =>
    items.map(truncatePoint).filter((item) => item.length > 0);

  return {
    consensus: clean(result.data.consensus),
    divergence: clean(result.data.divergence),
  };
}

export interface PersistExtractionDeps {
  discussionId: number;
  roundNo: number;
  points: ExtractedPoints;
  at: string;
  bus?: EventBus;
}

interface PointRow {
  id: number;
  text: string;
}

const insertSql = (table: string): string =>
  `INSERT INTO ${table}
     (discussion_id, text, status, support_guest_ids, round_no, updated_seq, created_at, updated_at)
   VALUES (?, ?, 'provisional', '[]', ?, 1, ?, ?)
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
    texts: string[],
    events: PersistedEvent[],
  ): void => {
    const insert = kind === 'consensus' ? insertConsensus : insertDivergence;
    const table = kind === 'consensus' ? 'consensus_points' : 'divergence_points';
    const type = kind === 'consensus' ? 'consensus.added' : 'divergence.added';

    for (const text of texts) {
      const info = insert.run(deps.discussionId, text, deps.roundNo, deps.at, deps.at);
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
        support_guest_ids: [],
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
