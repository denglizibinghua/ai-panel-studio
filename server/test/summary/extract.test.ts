import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db';
import type { LedgerRosterMember } from '../../src/modules/host/ledger';
import { extractPoints, persistExtraction } from '../../src/modules/summary/extract';
import {
  createScriptedLlm,
  createTempDb,
  removeTempFiles,
  seedReadyDiscussion,
  speakLedger,
} from '../discussion/harness';

const dbs: Db[] = [];

function tempDb(label: string): Db {
  const db = createTempDb(`summary-extract-${label}`);
  dbs.push(db);
  return db;
}

afterAll(() => {
  for (const db of dbs.splice(0)) {
    db.close();
  }
  removeTempFiles();
});

type PointTable = 'consensus_points' | 'divergence_points';

function readSupport(db: Db, discussionId: number, table: PointTable): number[] {
  const row = db
    .prepare(`SELECT support_guest_ids FROM ${table} WHERE discussion_id = ?`)
    .get(discussionId) as { support_guest_ids: string } | undefined;
  return row === undefined ? [] : (JSON.parse(row.support_guest_ids) as number[]);
}

async function runExtraction(options: {
  db: Db;
  discussionId: number;
  roster: LedgerRosterMember[];
  extract: unknown;
}): Promise<{ consensus: number[]; divergence: number[] }> {
  const llm = createScriptedLlm(options.db, {
    ledger: () => speakLedger(options.roster[0]?.name ?? '专家1号'),
    speech: () => '发言。',
    extract: () => options.extract,
  });

  const points = await extractPoints(llm.client, {
    discussion_id: options.discussionId,
    topic: '人工智能是否应取代初级程序员',
    transcript: [],
    roster: options.roster,
  });

  persistExtraction(options.db, {
    discussionId: options.discussionId,
    roundNo: 1,
    points,
    at: new Date().toISOString(),
    roster: options.roster,
  });

  return {
    consensus: readSupport(options.db, options.discussionId, 'consensus_points'),
    divergence: readSupport(options.db, options.discussionId, 'divergence_points'),
  };
}

describe('extract structured supporters', () => {
  it('maps structured supporter names to exact guest ids', async () => {
    const db = tempDb('exact');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const roster: LedgerRosterMember[] = [
      { id: seed.expertIds[0] as number, name: '陈砚秋', profession: '社会学者', stance: '立场甲' },
      { id: seed.expertIds[1] as number, name: '林知远', profession: '工程师', stance: '立场乙' },
    ];
    const expected = [roster[0]?.id ?? 0, roster[1]?.id ?? 0].sort((left, right) => left - right);

    const support = await runExtraction({
      db,
      discussionId: seed.discussionId,
      roster,
      extract: {
        consensus: [
          {
            text: '陈砚秋与林知远都认可成本会下降，只是节奏不同。',
            supporters: ['陈砚秋', '林知远'],
          },
        ],
        divergence: [],
      },
    });

    expect(support.consensus).toEqual(expected);
  });

  it('does not count a name that appears as an opponent but is absent from supporters', async () => {
    const db = tempDb('opponent');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const roster: LedgerRosterMember[] = [
      { id: seed.expertIds[0] as number, name: '陈砚秋', profession: '社会学者', stance: '立场甲' },
      { id: seed.expertIds[1] as number, name: '林知远', profession: '工程师', stance: '立场乙' },
    ];

    const support = await runExtraction({
      db,
      discussionId: seed.discussionId,
      roster,
      extract: {
        consensus: [],
        divergence: [
          {
            text: '陈砚秋并不同意成本会下降，林知远认为成本会下降。',
            supporters: ['林知远'],
          },
        ],
      },
    });

    // The bug: substring matching counted 陈砚秋 because the sentence names them.
    expect(support.divergence).toEqual([roster[1]?.id]);
  });

  it('drops supporter names that are not on the locked expert roster', async () => {
    const db = tempDb('unknown');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const roster: LedgerRosterMember[] = [
      { id: seed.expertIds[0] as number, name: '陈砚秋', profession: '社会学者', stance: '立场甲' },
      { id: seed.expertIds[1] as number, name: '林知远', profession: '工程师', stance: '立场乙' },
    ];

    const support = await runExtraction({
      db,
      discussionId: seed.discussionId,
      roster,
      extract: {
        consensus: [
          {
            text: '陈砚秋认为成本会下降。',
            supporters: ['陈砚秋', '路人甲'],
          },
        ],
        divergence: [],
      },
    });

    expect(support.consensus).toEqual([roster[0]?.id]);
  });

  it('accepts a legacy string array but records empty support instead of guessing', async () => {
    const db = tempDb('legacy');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const roster: LedgerRosterMember[] = [
      { id: seed.expertIds[0] as number, name: '陈砚秋', profession: '社会学者', stance: '立场甲' },
      { id: seed.expertIds[1] as number, name: '林知远', profession: '工程师', stance: '立场乙' },
    ];

    const support = await runExtraction({
      db,
      discussionId: seed.discussionId,
      roster,
      extract: {
        consensus: ['陈砚秋与林知远都认可成本会下降。'],
        divergence: ['陈砚秋并不同意成本会下降。'],
      },
    });

    // Both texts name experts, yet no substring fallback is allowed.
    expect(support.consensus).toEqual([]);
    expect(support.divergence).toEqual([]);
  });

  it('dedupes repeated supporter names and sorts ids ascending', async () => {
    const db = tempDb('dedupe');
    const seed = seedReadyDiscussion(db, { expertCount: 2 });
    const roster: LedgerRosterMember[] = [
      { id: seed.expertIds[0] as number, name: '陈砚秋', profession: '社会学者', stance: '立场甲' },
      { id: seed.expertIds[1] as number, name: '林知远', profession: '工程师', stance: '立场乙' },
    ];
    const expected = [roster[0]?.id ?? 0, roster[1]?.id ?? 0].sort((left, right) => left - right);

    const support = await runExtraction({
      db,
      discussionId: seed.discussionId,
      roster,
      extract: {
        consensus: [
          {
            text: '陈砚秋与林知远都认可成本会下降。',
            supporters: ['林知远', '陈砚秋', '林知远'],
          },
        ],
        divergence: [],
      },
    });

    expect(support.consensus).toEqual(expected);
  });
});
