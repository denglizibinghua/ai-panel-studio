import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db';
import { migrate } from '../src/db/migrate';

const dataDir = path.resolve(__dirname, '../data');
const dbPath = path.join(dataDir, `test-schema-${process.pid}-${Date.now()}.db`);

let db: Db;
let discussionId: number;
let hostId: number;
let expertId: number;

function insertGuest(name: string, color: string, role: string, order: number): number {
  const info = db
    .prepare(
      `INSERT INTO guests (discussion_id, name, profession, stance, color_id, role, speaking_order, locked)
       VALUES (?, ?, '测试职业', '测试立场', ?, ?, ?, 1)`,
    )
    .run(discussionId, name, color, role, order);
  return Number(info.lastInsertRowid);
}

function insertTurn(guestId: number, turnNo: number, speechType: string, content: string): number {
  const info = db
    .prepare(
      `INSERT INTO turns (discussion_id, guest_id, turn_no, speech_type, content)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(discussionId, guestId, turnNo, speechType, content);
  return Number(info.lastInsertRowid);
}

beforeAll(() => {
  db = createDb(dbPath);
  migrate(db);
  const info = db
    .prepare("INSERT INTO discussions (topic) VALUES ('约束测试')")
    .run();
  discussionId = Number(info.lastInsertRowid);
  hostId = insertGuest('主持甲', 'amber', 'host', 0);
  expertId = insertGuest('专家乙', 'rose', 'expert', 1);
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe('turns.content dual-branch CHECK', () => {
  it('accepts a 300-char opening turn', () => {
    expect(() => insertTurn(hostId, 1, 'opening', '字'.repeat(300))).not.toThrow();
  });

  it('rejects a 401-char opening turn', () => {
    expect(() => insertTurn(hostId, 2, 'opening', '字'.repeat(401))).toThrow(/CHECK constraint failed/);
  });

  it('accepts a 250-char summary turn', () => {
    expect(() => insertTurn(hostId, 2, 'summary', '字'.repeat(250))).not.toThrow();
  });

  it('rejects a 121-char challenge turn', () => {
    expect(() => insertTurn(expertId, 3, 'challenge', '字'.repeat(121))).toThrow(/CHECK constraint failed/);
  });
});

describe('guests indexes', () => {
  it('rejects a second host in the same discussion', () => {
    expect(() => insertGuest('主持乙', 'sky', 'host', 2)).toThrow(/UNIQUE constraint failed/);
  });

  it('accepts a second expert in the same discussion', () => {
    expect(() => insertGuest('专家丙', 'sky', 'expert', 2)).not.toThrow();
  });
});

describe('events uniqueness and foreign keys', () => {
  it('rejects a duplicate (discussion_id, seq) pair', () => {
    const insertEvent = db.prepare(
      'INSERT INTO events (discussion_id, seq, type, payload) VALUES (?, ?, ?, ?)',
    );
    insertEvent.run(discussionId, 1, 'state.draft', JSON.stringify({ status: 'draft' }));
    expect(() =>
      insertEvent.run(discussionId, 1, 'state.draft', JSON.stringify({ status: 'draft' })),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a turn pointing at a nonexistent discussion (foreign_keys=ON)', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO turns (discussion_id, guest_id, turn_no, speech_type, content)
           VALUES (999999, ?, 1, 'challenge', '外键测试')`,
        )
        .run(expertId),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
