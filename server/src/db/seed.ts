import {
  eventPayloadSchemaByType,
  type EventType,
} from '@ai-panel/shared';
import { closeDb, getDb, type Db } from './index';
import { migrate } from './migrate';
import { SAMPLE_DISCUSSIONS, type SeedDiscussion, type SeedPoint, type SeedTurn } from './seed-data';

const EVENT_INSERT =
  'INSERT INTO events (discussion_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)';

interface SeedResult {
  discussions: number;
  guests: number;
  turns: number;
  consensus: number;
  divergence: number;
  events: number;
}

function supportIds(point: SeedPoint, expertIds: number[]): number[] {
  return point.support.map((index) => {
    const id = expertIds[index];
    if (id === undefined) {
      throw new Error(`seed: unknown expert index ${index} in point "${point.text}"`);
    }
    return id;
  });
}

function insertDiscussion(db: Db, discussion: SeedDiscussion): SeedResult {
  if (discussion.guests.length !== 5 || discussion.guests[0]?.role !== 'host') {
    throw new Error(`seed: discussion "${discussion.topic}" must have 1 host + 4 experts`);
  }
  // 只有 finished 才有 transcript；draft / ready 必须为空（见 data-model.md §6）。
  if (discussion.status === 'finished') {
    if (discussion.turns.length < 8 || discussion.turns.length > 12) {
      throw new Error(`seed: finished discussion "${discussion.topic}" must have 8-12 turns`);
    }
  } else if (discussion.turns.length !== 0) {
    throw new Error(`seed: non-finished discussion "${discussion.topic}" must have 0 turns`);
  }
  if (discussion.status !== 'finished' && (discussion.consensus.length > 0 || discussion.divergence.length > 0)) {
    throw new Error(`seed: non-finished discussion "${discussion.topic}" must have 0 consensus/divergence`);
  }

  const baseMs = Date.parse(discussion.base_time);
  const insertDiscussionRow = db.prepare(
    `INSERT INTO discussions
       (topic, expert_count, status, session_id, sample, summary_text, error_code,
        error_message, last_event_seq, created_at, updated_at, started_at, finished_at)
     VALUES (?, 4, ?, NULL, 1, ?, NULL, NULL, 0, ?, ?, ?, ?)`,
  );
  const discussionId = Number(
    insertDiscussionRow.run(
      discussion.topic,
      discussion.status,
      discussion.summary_text,
      discussion.base_time,
      discussion.base_time,
      discussion.started_at,
      discussion.finished_at,
    ).lastInsertRowid,
  );

  const locked = discussion.status === 'draft' ? 0 : 1;
  const insertGuest = db.prepare(
    `INSERT INTO guests
       (discussion_id, name, profession, stance, color_id, role, speaking_order, locked, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const guestIds = discussion.guests.map((guest) =>
    Number(
      insertGuest.run(
        discussionId,
        guest.name,
        guest.profession,
        guest.stance,
        guest.color_id,
        guest.role,
        guest.speaking_order,
        locked,
        discussion.base_time,
      ).lastInsertRowid,
    ),
  );

  const hostId = guestIds[0];
  const expertIds = guestIds.slice(1);
  if (hostId === undefined || expertIds.length !== 4) {
    throw new Error(`seed: discussion "${discussion.topic}" guest ids are incomplete`);
  }

  // draft 尚未确认阵容：不得有 agent_status 行（AC-1.7 只在 confirm 时建）。
  if (discussion.status !== 'draft') {
    const insertAgentStatus = db.prepare(
      `INSERT INTO agent_status (discussion_id, guest_id, state, focus, updated_seq, updated_at)
       VALUES (?, ?, 'idle', ?, 0, ?)`,
    );
    discussion.guests.forEach((guest, index) => {
      const guestId = guestIds[index];
      if (guestId === undefined) {
        throw new Error('seed: missing guest id');
      }
      insertAgentStatus.run(
        discussionId,
        guestId,
        guest.role === 'host' ? null : `关注${guest.stance}`,
        discussion.base_time,
      );
    });
  }

  let seq = 0;
  let tick = 0;
  let lastEventAt = discussion.base_time;
  const emit = (type: EventType, payload: unknown): number => {
    seq += 1;
    eventPayloadSchemaByType[type].parse(payload);
    lastEventAt = new Date(baseMs + tick * 1000).toISOString();
    tick += 1;
    db.prepare(EVENT_INSERT).run(discussionId, seq, type, JSON.stringify(payload), lastEventAt);
    return seq;
  };

  emit('state.draft', {
    status: 'draft',
    previous_status: null,
    updated_at: discussion.base_time,
  });

  const readyAt = discussion.started_at ?? new Date(baseMs + 120_000).toISOString();
  if (discussion.status !== 'draft') {
    emit('state.ready', { status: 'ready', previous_status: 'draft', updated_at: readyAt });

    const updateAgentSeq = db.prepare(
      'UPDATE agent_status SET updated_seq = ?, updated_at = ? WHERE discussion_id = ? AND guest_id = ?',
    );
    discussion.guests.forEach((guest, index) => {
      const guestId = guestIds[index];
      if (guestId === undefined) {
        throw new Error('seed: missing guest id');
      }
      const at = new Date(baseMs + tick * 1000).toISOString();
      const agentSeq = emit('agent.status', {
        guest_id: guestId,
        state: 'idle',
        focus: guest.role === 'host' ? null : `关注${guest.stance}`,
      });
      updateAgentSeq.run(agentSeq, at, discussionId, guestId);
    });
  }

  // 样例不再提供 running 场：没有调度器驱动会永久卡在 running，且永久占用
  // AC-2.10 的并发名额（status='running' ≤ 3）。实时演示靠用户真开一场。
  if (discussion.status === 'finished') {
    if (discussion.started_at === null) {
      throw new Error(`seed: discussion "${discussion.topic}" is finished without started_at`);
    }
    emit('state.running', {
      status: 'running',
      previous_status: 'ready',
      updated_at: discussion.started_at,
    });
    emit('run.started', { started_at: discussion.started_at, expert_count: 4 });
  }

  const guestIdFor = (turn: SeedTurn): number => {
    if (turn.speaker === 'host') {
      return hostId;
    }
    const id = expertIds[turn.speaker];
    if (id === undefined) {
      throw new Error(`seed: unknown speaker ${turn.speaker}`);
    }
    return id;
  };

  let turnNo = 0;
  let expertTurnCount = 0;
  const emitTurn = (turn: SeedTurn, content: string): void => {
    turnNo += 1;
    const guestId = guestIdFor(turn);
    const at = new Date(baseMs + tick * 1000).toISOString();
    emit('turn.started', { guest_id: guestId, turn_no: turnNo, speech_type: turn.speech_type });
    db.prepare(
      `INSERT INTO turns (discussion_id, guest_id, turn_no, speech_type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(discussionId, guestId, turnNo, turn.speech_type, content, at);
    emit('turn.done', {
      guest_id: guestId,
      turn_no: turnNo,
      speech_type: turn.speech_type,
      content,
      created_at: at,
    });
    if (turn.speaker !== 'host') {
      expertTurnCount += 1;
    }
  };

  const insertPoint = (table: 'consensus_points' | 'divergence_points', point: SeedPoint): number =>
    Number(
      db
        .prepare(
          `INSERT INTO ${table}
             (discussion_id, text, status, support_guest_ids, round_no, updated_seq, created_at, updated_at)
           VALUES (?, ?, 'provisional', ?, ?, 1, ?, ?)`,
        )
        .run(
          discussionId,
          point.text,
          JSON.stringify(supportIds(point, expertIds)),
          point.round_no,
          discussion.base_time,
          discussion.base_time,
        ).lastInsertRowid,
    );

  const consensusIds = discussion.consensus.map((point) => insertPoint('consensus_points', point));
  const divergenceIds = discussion.divergence.map((point) => insertPoint('divergence_points', point));

  const addedSeq = new Map<number, number>();
  const emitPointAdded = (
    type: 'consensus.added' | 'divergence.added',
    table: 'consensus_points' | 'divergence_points',
    point: SeedPoint,
    pointId: number,
  ): void => {
    const pointSeq = emit(type, {
      point_id: pointId,
      text: point.text,
      status: 'provisional',
      support_guest_ids: supportIds(point, expertIds),
      round_no: point.round_no,
    });
    addedSeq.set(pointId, pointSeq);
    db.prepare(`UPDATE ${table} SET updated_seq = ?, updated_at = ? WHERE id = ?`).run(
      pointSeq,
      new Date(baseMs + tick * 1000).toISOString(),
      pointId,
    );
  };

  const summaryTurn = discussion.turns.find((turn) => turn.speech_type === 'summary');
  const regularTurns = discussion.turns.filter((turn) => turn.speech_type !== 'summary');
  for (const turn of regularTurns) {
    emitTurn(turn, turn.content);
  }

  discussion.consensus.forEach((point, index) => {
    const pointId = consensusIds[index];
    if (pointId === undefined) {
      throw new Error('seed: missing consensus id');
    }
    emitPointAdded('consensus.added', 'consensus_points', point, pointId);
  });
  discussion.divergence.forEach((point, index) => {
    const pointId = divergenceIds[index];
    if (pointId === undefined) {
      throw new Error('seed: missing divergence id');
    }
    emitPointAdded('divergence.added', 'divergence_points', point, pointId);
  });

  if (discussion.status === 'finished') {
    if (summaryTurn === undefined || discussion.summary_text === null) {
      throw new Error(`seed: finished discussion "${discussion.topic}" needs a summary`);
    }
    const summaryLength = discussion.summary_text.length;
    if (summaryLength < 150 || summaryLength > 250) {
      throw new Error(`seed: summary for "${discussion.topic}" is ${summaryLength} chars (want 150-250)`);
    }
    emitTurn(summaryTurn, discussion.summary_text);

    const emitPointUpdated = (
      type: 'consensus.updated' | 'divergence.updated',
      table: 'consensus_points' | 'divergence_points',
      point: SeedPoint,
      pointId: number,
    ): void => {
      const pointSeq = emit(type, {
        point_id: pointId,
        text: point.text,
        status: 'final',
        support_guest_ids: supportIds(point, expertIds),
        round_no: point.round_no,
      });
      db.prepare(`UPDATE ${table} SET status = 'final', updated_seq = ?, updated_at = ? WHERE id = ?`).run(
        pointSeq,
        new Date(baseMs + tick * 1000).toISOString(),
        pointId,
      );
    };

    discussion.consensus.forEach((point, index) => {
      const pointId = consensusIds[index];
      if (pointId === undefined) {
        throw new Error('seed: missing consensus id');
      }
      emitPointUpdated('consensus.updated', 'consensus_points', point, pointId);
    });
    discussion.divergence.forEach((point, index) => {
      const pointId = divergenceIds[index];
      if (pointId === undefined) {
        throw new Error('seed: missing divergence id');
      }
      emitPointUpdated('divergence.updated', 'divergence_points', point, pointId);
    });

    const finishedAt = discussion.finished_at;
    if (finishedAt === null) {
      throw new Error(`seed: finished discussion "${discussion.topic}" needs finished_at`);
    }
    emit('state.finished', { status: 'finished', previous_status: 'running', updated_at: finishedAt });
    emit('run.finished', {
      finished_at: finishedAt,
      reason: 'request_satisfied',
      expert_turn_count: expertTurnCount,
      summary_failed: false,
    });
  } else if (summaryTurn !== undefined) {
    throw new Error(`seed: non-finished discussion "${discussion.topic}" must not have a summary turn`);
  }

  db.prepare('UPDATE discussions SET last_event_seq = ?, updated_at = ? WHERE id = ?').run(
    seq,
    lastEventAt,
    discussionId,
  );

  return {
    discussions: 1,
    guests: guestIds.length,
    turns: discussion.turns.length,
    consensus: consensusIds.length,
    divergence: divergenceIds.length,
    events: seq,
  };
}

/** Idempotent by sample=1: deletes all sample discussions (cascading) then rebuilds. */
export function seed(db: Db): SeedResult {
  const run = db.transaction(() => {
    db.prepare('DELETE FROM discussions WHERE sample = 1').run();
    const totals: SeedResult = {
      discussions: 0,
      guests: 0,
      turns: 0,
      consensus: 0,
      divergence: 0,
      events: 0,
    };
    for (const discussion of SAMPLE_DISCUSSIONS) {
      const result = insertDiscussion(db, discussion);
      totals.discussions += result.discussions;
      totals.guests += result.guests;
      totals.turns += result.turns;
      totals.consensus += result.consensus;
      totals.divergence += result.divergence;
      totals.events += result.events;
    }
    return totals;
  });
  return run();
}

if (require.main === module) {
  const db = getDb();
  migrate(db);
  const result = seed(db);
  console.log(
    `seed: ${result.discussions} discussions, ${result.guests} guests, ${result.turns} turns, ` +
      `${result.consensus} consensus, ${result.divergence} divergence, ${result.events} events`,
  );
  closeDb();
}
