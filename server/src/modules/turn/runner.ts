/**
 * Discussion main loop (S6.5).
 *
 * Contract hot spots enforced here:
 * - No `publish()` anywhere: a turn is one "writing unit" built with
 *   `appendEventInTx` inside a transaction and broadcast only after COMMIT
 *   (data-model §4 rule 4). `publish()` would throw PUBLISH_INSIDE_TRANSACTION.
 * - Stall chaining: `requestLedger` is fed **this round's** `prev_stall_count`,
 *   and the outcome's `stall_count` is both echoed into `decide` and stored as
 *   the next round's `prev_stall_count`. Using an old value loses one round and
 *   only the dedicated stall test catches it.
 * - `decide` receives the full transcript (host opening + interjections
 *   included); `decide` itself only looks at the last *expert* turn when
 *   avoiding a repeat speaker.
 * - Every 2 expert turns -> extraction (`summary` module); every 4 -> one host
 *   question (`turn` module) that does **not** increment `expert_turn_count`.
 * - Cancel: the signal is checked before every write and every turn-writing
 *   transaction re-checks `status='running'`, so no turn can appear after
 *   `cancelled` (AC-1.24).
 */
import {
  runFinishReasonValues,
  type ErrorCode,
  type SpeechType,
} from '@ai-panel/shared';
import type { Db } from '../../db';
import { LlmError, type ChatJsonClient, type ChatJsonMessage } from '../../llm/client';
import { decide } from '../host/decide';
import { truncateShortSpeech } from '../host/interject';
import { generateInterjection } from '../host/interject';
import {
  requestLedger,
  type LedgerOutcome,
  type LedgerRecentTurn,
  type LedgerRosterMember,
} from '../host/ledger';
import { EventBus } from '../sse/bus';
import {
  appendEventInTx,
  serializeEventPayload,
  type PersistedEvent,
} from '../sse/publish';
import { extractPoints, persistExtraction } from '../summary/extract';
import { finalizePoints } from '../summary/merge';
import {
  EMPTY_TRANSCRIPT_SUMMARY,
  generateSummary,
  type SummaryResult,
} from '../summary/summary';
import { loadDiscussionStatus, transitionInTx } from '../discussion/status';

export interface RunnerDeps {
  db: Db;
  llm: ChatJsonClient;
  bus?: EventBus;
  now?: () => Date;
  signal?: AbortSignal;
  /** Test hook; production uses the spec cap of 20 expert turns (AC-1.13). */
  max_expert_turns?: number;
  /** Test hook; production uses the spec's 30s summary budget (spec §4.3). */
  summary_timeout_ms?: number;
}

export type RunFinishReason = (typeof runFinishReasonValues)[number];

export type RunOutcomeStatus = 'finished' | 'failed' | 'cancelled' | 'skipped';

export interface RunOutcome {
  status: RunOutcomeStatus;
  reason?: RunFinishReason;
  expert_turn_count: number;
}

interface RunnerGuest {
  id: number;
  name: string;
  profession: string;
  stance: string;
  role: 'host' | 'expert';
}

interface RunnerState {
  id: number;
  topic: string;
  host: RunnerGuest;
  experts: RunnerGuest[];
}

interface DiscussionRow {
  id: number;
  topic: string;
  status: string;
}

/** Internal control-flow signal: stop quietly, someone else already set the status. */
class RunHalted extends Error {
  constructor() {
    super('run halted');
    this.name = 'RunHalted';
  }
}

class EmptySpeechError extends Error {
  constructor() {
    super('empty speech');
    this.name = 'EmptySpeechError';
  }
}

function statusNow(db: Db, discussionId: number): string | null {
  return loadDiscussionStatus(db, discussionId);
}

function assertRunning(db: Db, discussionId: number): void {
  if (statusNow(db, discussionId) !== 'running') {
    throw new RunHalted();
  }
}

/** Commits `work`, broadcasts only after COMMIT, returns its value. */
function commitAndBroadcast<T>(
  db: Db,
  bus: EventBus | undefined,
  discussionId: number,
  work: () => { events: PersistedEvent[]; value: T },
): T {
  const transaction = db.transaction(work);
  const { events, value } = transaction.immediate();
  bus?.broadcast(discussionId, events);
  return value;
}

function loadRunnerState(db: Db, discussionId: number): RunnerState | null {
  const row = db
    .prepare('SELECT id, topic, status FROM discussions WHERE id = ?')
    .get(discussionId) as DiscussionRow | undefined;
  if (row === undefined || row.status !== 'running') {
    return null;
  }

  const guests = db
    .prepare(
      `SELECT id, name, profession, stance, role
         FROM guests
        WHERE discussion_id = ? AND locked = 1
        ORDER BY speaking_order ASC, id ASC`,
    )
    .all(discussionId) as RunnerGuest[];

  const host = guests.find((guest) => guest.role === 'host');
  const experts = guests.filter((guest) => guest.role === 'expert');
  if (host === undefined || experts.length === 0) {
    return null;
  }

  return { id: row.id, topic: row.topic, host, experts };
}

function countExpertTurns(db: Db, discussionId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM turns t
         JOIN guests g ON g.id = t.guest_id
        WHERE t.discussion_id = ? AND g.role = 'expert'`,
    )
    .get(discussionId) as { count: number };
  return row.count;
}

function countTurns(db: Db, discussionId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM turns WHERE discussion_id = ?')
    .get(discussionId) as { count: number };
  return row.count;
}

function loadTranscript(db: Db, discussionId: number): LedgerRecentTurn[] {
  const rows = db
    .prepare(
      `SELECT t.guest_id, g.name AS speaker_name, t.speech_type, t.content
         FROM turns t
         JOIN guests g ON g.id = t.guest_id
        WHERE t.discussion_id = ?
        ORDER BY t.turn_no ASC`,
    )
    .all(discussionId) as LedgerRecentTurn[];
  return rows;
}

function nextTurnNo(db: Db, discussionId: number): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(turn_no), 0) + 1 AS next FROM turns WHERE discussion_id = ?')
    .get(discussionId) as { next: number };
  return row.next;
}

function focusFor(instruction: string | null): string | null {
  if (instruction === null) {
    return null;
  }
  const trimmed = instruction.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 80);
}

/**
 * Upserts one guest's status row and appends the matching `agent.status` event;
 * `updated_seq` is always the event's own seq (never 0, INV-6).
 */
function applyAgentStatusInTx(
  db: Db,
  discussionId: number,
  guestId: number,
  state: 'idle' | 'preparing' | 'speaking',
  focus: string | null,
  at: string,
): PersistedEvent {
  const payload = serializeEventPayload('agent.status', {
    guest_id: guestId,
    state,
    focus,
  });
  const event = appendEventInTx(db, discussionId, 'agent.status', payload, at);

  db.prepare(
    `INSERT INTO agent_status (discussion_id, guest_id, state, focus, updated_seq, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(discussion_id, guest_id) DO UPDATE SET
       state       = excluded.state,
       focus       = excluded.focus,
       updated_seq = excluded.updated_seq,
       updated_at  = excluded.updated_at`,
  ).run(discussionId, guestId, state, focus, event.seq, at);

  return event;
}

/** `turn.started` + `agent_status='preparing'`, committed before the model call. */
function beginTurn(
  db: Db,
  bus: EventBus | undefined,
  discussionId: number,
  guestId: number,
  speechType: SpeechType,
  focus: string | null,
  at: string,
): number {
  return commitAndBroadcast(db, bus, discussionId, () => {
    assertRunning(db, discussionId);
    const turnNo = nextTurnNo(db, discussionId);

    const payload = serializeEventPayload('turn.started', {
      guest_id: guestId,
      turn_no: turnNo,
      speech_type: speechType,
    });
    const started = appendEventInTx(db, discussionId, 'turn.started', payload, at);
    const preparing = applyAgentStatusInTx(
      db,
      discussionId,
      guestId,
      'preparing',
      focus,
      at,
    );

    return { events: [started, preparing], value: turnNo };
  });
}

/**
 * `speaking` is its own committed frame *before* the model call, not part of
 * `finishTurn`'s batch. That makes AC-1.20 observable for the whole call
 * duration (S8 review, decision C) without adding streaming.
 */
function markSpeaking(
  db: Db,
  bus: EventBus | undefined,
  discussionId: number,
  guestId: number,
  focus: string | null,
  at: string,
): void {
  commitAndBroadcast(db, bus, discussionId, () => ({
    events: [applyAgentStatusInTx(db, discussionId, guestId, 'speaking', focus, at)],
    value: undefined,
  }));
}

/** `turns` + `turn.done` + idle in one transaction (a single turn unit). */
function finishTurn(
  db: Db,
  bus: EventBus | undefined,
  discussionId: number,
  guestId: number,
  turnNo: number,
  speechType: SpeechType,
  content: string,
  focus: string | null,
  at: string,
): void {
  commitAndBroadcast(db, bus, discussionId, () => {
    assertRunning(db, discussionId);

    db.prepare(
      `INSERT INTO turns (discussion_id, guest_id, turn_no, speech_type, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(discussionId, guestId, turnNo, speechType, content, at);

    const payload = serializeEventPayload('turn.done', {
      guest_id: guestId,
      turn_no: turnNo,
      speech_type: speechType,
      content,
      created_at: at,
    });
    const done = appendEventInTx(db, discussionId, 'turn.done', payload, at);
    const idle = applyAgentStatusInTx(db, discussionId, guestId, 'idle', null, at);

    return { events: [done, idle], value: undefined };
  });
}

/** Clears a failed turn's `preparing` flag; no discussion-status gate (cancel-safe). */
function resetAgentIdle(
  db: Db,
  bus: EventBus | undefined,
  discussionId: number,
  guestId: number,
  at: string,
): void {
  try {
    commitAndBroadcast(db, bus, discussionId, () => ({
      events: [applyAgentStatusInTx(db, discussionId, guestId, 'idle', null, at)],
      value: undefined,
    }));
  } catch (error) {
    console.warn('[runner] reset agent idle failed:', error instanceof Error ? error.message : error);
  }
}

const SPEECH_TYPE_HINT: Record<SpeechType, string> = {
  opening: '开场：点明议题的核心争议，1–2 句，不要预设立场。',
  challenge: '质疑：直接指出上一位发言里的薄弱前提。',
  supplement: '补充：在他人观点上补一个新的角度或证据。',
  rebuttal: '反驳：明确不同意某位嘉宾，并给出理由。',
  question: '提问：向某位嘉宾追问一个具体问题。',
  summary: '总结：用自然语言收束全场，点出一处主要分歧。',
};

function buildSpeechMessages(
  state: RunnerState,
  guest: RunnerGuest,
  speechType: SpeechType,
  instruction: string | null,
  transcript: LedgerRecentTurn[],
): ChatJsonMessage[] {
  const recent = transcript
    .slice(-6)
    .map((turn) => `- ${turn.speaker_name}（${turn.speech_type}）：${turn.content}`)
    .join('\n');
  const roster = state.experts
    .map((expert) => `${expert.name}（${expert.profession}，立场：${expert.stance}）`)
    .join('、');
  const limit = speechType === 'opening' ? 400 : 120;

  return [
    {
      role: 'system',
      content: [
        `你是圆桌讨论的${guest.role === 'host' ? '主持人' : '嘉宾'}「${guest.name}」（${guest.profession}）。`,
        `你的立场：${guest.stance}。`,
        '只输出 JSON：{"content":"..."}，不要在 JSON 之外输出任何文字。',
        `本轮类型：${speechType}。${SPEECH_TYPE_HINT[speechType]}`,
        `中文，1–2 句，不超过 ${limit} 字。不要复述规则，不要写旁白。`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `议题：${state.topic}`,
        `其他嘉宾：${roster}`,
        '最近发言：',
        recent.length > 0 ? recent : '（暂无）',
        instruction === null ? '' : `本轮指令：${instruction}`,
        '请只输出 {"content":"..."}。',
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    },
  ];
}

function parseContent(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'content' in parsed &&
      typeof (parsed as { content: unknown }).content === 'string'
    ) {
      const text = (parsed as { content: string }).content.trim();
      return text.length > 0 ? text : null;
    }
  } catch {
    // Plain text fallback below.
  }
  if (body.startsWith('{') || body.startsWith('[')) {
    return null;
  }
  return body.length > 0 ? body : null;
}

async function generateSpeech(
  llm: ChatJsonClient,
  discussionId: number,
  state: RunnerState,
  guest: RunnerGuest,
  speechType: SpeechType,
  instruction: string | null,
  transcript: LedgerRecentTurn[],
): Promise<string> {
  const limit = speechType === 'opening' ? 400 : 120;
  const raw = await llm.complete({
    messages: buildSpeechMessages(state, guest, speechType, instruction, transcript),
    discussionId,
    module: 'turn',
    validate: (candidate) => parseContent(candidate) !== null,
  });
  const content = parseContent(raw);
  if (content === null) {
    throw new EmptySpeechError();
  }
  return truncateShortSpeech(content, limit);
}

function safeJsonText(raw: string): string | null {
  if (raw.length > 4096) {
    return null;
  }
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

function recordLedger(
  db: Db,
  discussionId: number,
  outcome: LedgerOutcome,
  decision: ReturnType<typeof decide>,
  at: string,
): void {
  const turnsRow = db
    .prepare('SELECT COALESCE(MAX(turn_no), 0) AS last FROM turns WHERE discussion_id = ?')
    .get(discussionId) as { last: number };
  // A failed speech leaves no `turns` row, so "last turn + 1" can repeat and hit
  // uq_ledger_turn on the next decision (two consecutive failures killed a run).
  // Stay strictly above both counters: monotone, unique, never ahead by more
  // than the failures that actually happened.
  const ledgerRow = db
    .prepare('SELECT COALESCE(MAX(turn_no), 0) AS last FROM ledger WHERE discussion_id = ?')
    .get(discussionId) as { last: number };
  const turnNo = Math.max(turnsRow.last, ledgerRow.last + 1);

  db.prepare(
    `INSERT INTO ledger
       (discussion_id, turn_no, is_request_satisfied, is_in_loop, is_progress_being_made,
        next_guest_id, speech_type, instruction, parse_status, stall_count, decision, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    discussionId,
    turnNo,
    outcome.is_request_satisfied ? 1 : 0,
    outcome.is_in_loop ? 1 : 0,
    outcome.is_progress_being_made ? 1 : 0,
    decision.action === 'speak' ? decision.guest_id : outcome.next_guest_id,
    decision.action === 'speak' ? decision.speech_type : outcome.speech_type,
    decision.action === 'speak' ? decision.instruction : outcome.instruction,
    outcome.parse_status,
    outcome.stall_count,
    decision.action,
    safeJsonText(outcome.raw),
    at,
  );
}

function finishAsFailed(
  db: Db,
  bus: EventBus | undefined,
  discussionId: number,
  code: ErrorCode,
  at: string,
): void {
  if (statusNow(db, discussionId) !== 'running') {
    return;
  }
  try {
    commitAndBroadcast(db, bus, discussionId, () => {
      const transition = transitionInTx(db, discussionId, 'failed', {
        at,
        finished_at: at,
        error_code: code,
      });
      const payload = serializeEventPayload('run.failed', {
        failed_at: at,
        error_code: code,
      });
      const failed = appendEventInTx(db, discussionId, 'run.failed', payload, at);
      return { events: [transition.event, failed], value: undefined };
    });
  } catch (error) {
    console.warn('[runner] mark failed skipped:', error instanceof Error ? error.message : error);
  }
}

/**
 * Writes the summary turn, `summary_text`, `state.finished` and `run.finished`
 * in one transaction: INV-9 requires the two summary copies to be byte-equal.
 */
function finishAsFinished(
  db: Db,
  bus: EventBus | undefined,
  discussionId: number,
  hostId: number,
  turnNo: number,
  summaryText: string,
  reason: RunFinishReason,
  expertTurnCount: number,
  summaryFailed: boolean,
  at: string,
): void {
  commitAndBroadcast(db, bus, discussionId, () => {
    assertRunning(db, discussionId);

    db.prepare(
      `INSERT INTO turns (discussion_id, guest_id, turn_no, speech_type, content, created_at)
       VALUES (?, ?, ?, 'summary', ?, ?)`,
    ).run(discussionId, hostId, turnNo, summaryText, at);

    const donePayload = serializeEventPayload('turn.done', {
      guest_id: hostId,
      turn_no: turnNo,
      speech_type: 'summary',
      content: summaryText,
      created_at: at,
    });
    const done = appendEventInTx(db, discussionId, 'turn.done', donePayload, at);
    const idle = applyAgentStatusInTx(db, discussionId, hostId, 'idle', null, at);

    db.prepare('UPDATE discussions SET summary_text = ?, updated_at = ? WHERE id = ?').run(
      summaryText,
      at,
      discussionId,
    );

    const transition = transitionInTx(db, discussionId, 'finished', {
      at,
      finished_at: at,
    });
    const finishedPayload = serializeEventPayload('run.finished', {
      finished_at: at,
      reason,
      expert_turn_count: expertTurnCount,
      summary_failed: summaryFailed,
    });
    const finished = appendEventInTx(db, discussionId, 'run.finished', finishedPayload, at);

    return { events: [done, idle, transition.event, finished], value: undefined };
  });
}

export async function runDiscussion(
  discussionId: number,
  deps: RunnerDeps,
): Promise<RunOutcome> {
  const { db, llm, bus } = deps;
  const now = deps.now ?? (() => new Date());
  // Read through a function: narrowing `signal.aborted` once would make later
  // checks look impossible to TypeScript (and hide a real re-check).
  const isAborted = (): boolean => deps.signal?.aborted === true;
  const maxExpertTurns = deps.max_expert_turns ?? 20;

  const state = loadRunnerState(db, discussionId);
  if (state === null) {
    // A running row without a locked host/roster would otherwise occupy one of
    // the three TOO_MANY_RUNNING slots forever.
    if (statusNow(db, discussionId) === 'running') {
      finishAsFailed(db, bus, discussionId, 'ALL_SPEAKERS_FAILED', now().toISOString());
      return { status: 'failed', expert_turn_count: 0 };
    }
    return { status: 'skipped', expert_turn_count: 0 };
  }

  const failedExperts = new Set<number>();
  let prevStall = 0;
  let finishReason: RunFinishReason = 'max_turns';

  const halted = (): RunOutcome => ({
    status: statusNow(db, discussionId) === 'cancelled' ? 'cancelled' : 'skipped',
    expert_turn_count: countExpertTurns(db, discussionId),
  });

  try {
    // 1. Host opening. A failed opening is not fatal: the loop still runs.
    if (!isAborted()) {
      try {
        const at = now().toISOString();
        const turnNo = beginTurn(db, bus, discussionId, state.host.id, 'opening', null, at);
        markSpeaking(db, bus, discussionId, state.host.id, null, now().toISOString());
        const content = await generateSpeech(
          llm,
          discussionId,
          state,
          state.host,
          'opening',
          '用一两句话开场，点明本场议题的争议焦点。',
          loadTranscript(db, discussionId),
        );
        if (isAborted()) {
          resetAgentIdle(db, bus, discussionId, state.host.id, now().toISOString());
          return halted();
        }
        finishTurn(
          db,
          bus,
          discussionId,
          state.host.id,
          turnNo,
          'opening',
          content,
          null,
          now().toISOString(),
        );
      } catch (error) {
        if (error instanceof RunHalted) {
          return halted();
        }
        if (error instanceof LlmError && error.code === 'LLM_NOT_CONFIGURED') {
          throw error;
        }
        console.warn(
          '[runner] opening failed:',
          error instanceof Error ? error.message : 'unknown error',
        );
        resetAgentIdle(db, bus, discussionId, state.host.id, now().toISOString());
      }
    }

    // 2. Main loop.
    while (!isAborted()) {
      const transcript = loadTranscript(db, discussionId);
      const roster: LedgerRosterMember[] = state.experts.map((expert) => ({
        id: expert.id,
        name: expert.name,
        profession: expert.profession,
        stance: expert.stance,
      }));
      const expertTurnCount = countExpertTurns(db, discussionId);

      const outcome = await requestLedger(llm, {
        discussion_id: discussionId,
        topic: state.topic,
        roster,
        recent_turns: transcript,
        expert_turn_count: expertTurnCount,
        prev_stall_count: prevStall,
      });

      // `decide` echoes this turn's stall count; feeding the previous value here
      // would delay force_stop by exactly one round (and only this test catches it).
      const decision = decide({
        ledger: outcome,
        roster,
        transcript,
        expert_turn_count: expertTurnCount,
        prev_stall_count: outcome.stall_count,
        max_expert_turns: maxExpertTurns,
      });

      recordLedger(db, discussionId, outcome, decision, now().toISOString());
      prevStall = outcome.stall_count;

      if (decision.action === 'force_stop') {
        finishReason = 'stalled';
        break;
      }
      if (decision.action === 'summarize') {
        finishReason = outcome.is_request_satisfied ? 'request_satisfied' : 'max_turns';
        break;
      }

      const guest = state.experts.find((expert) => expert.id === decision.guest_id);
      if (guest === undefined) {
        throw new Error('DECIDE_GUEST_MISSING');
      }

      try {
        const at = now().toISOString();
        const turnNo = beginTurn(
          db,
          bus,
          discussionId,
          guest.id,
          decision.speech_type,
          focusFor(decision.instruction),
          at,
        );
        markSpeaking(
          db,
          bus,
          discussionId,
          guest.id,
          focusFor(decision.instruction),
          now().toISOString(),
        );
        const content = await generateSpeech(
          llm,
          discussionId,
          state,
          guest,
          decision.speech_type,
          decision.instruction,
          transcript,
        );
        if (isAborted()) {
          resetAgentIdle(db, bus, discussionId, guest.id, now().toISOString());
          return halted();
        }
        finishTurn(
          db,
          bus,
          discussionId,
          guest.id,
          turnNo,
          decision.speech_type,
          content,
          focusFor(decision.instruction),
          now().toISOString(),
        );
      } catch (error) {
        if (error instanceof RunHalted) {
          return halted();
        }
        if (error instanceof LlmError && error.code === 'LLM_NOT_CONFIGURED') {
          throw error;
        }
        failedExperts.add(guest.id);
        console.warn(
          '[runner] speech failed:',
          error instanceof Error ? error.message : 'unknown error',
        );
        resetAgentIdle(db, bus, discussionId, guest.id, now().toISOString());

        if (
          countExpertTurns(db, discussionId) === 0 &&
          failedExperts.size === state.experts.length
        ) {
          finishAsFailed(
            db,
            bus,
            discussionId,
            'ALL_SPEAKERS_FAILED',
            now().toISOString(),
          );
          return { status: 'failed', expert_turn_count: 0 };
        }
        continue;
      }

      const afterSpeeches = countExpertTurns(db, discussionId);

      // 3a. Extraction window: every 2 expert turns, never blocked by failure.
      if (afterSpeeches % 2 === 0) {
        try {
          const points = await extractPoints(llm, {
            discussion_id: discussionId,
            topic: state.topic,
            transcript: loadTranscript(db, discussionId),
            roster,
          });
          if (isAborted()) {
            return halted();
          }
          persistExtraction(db, {
            discussionId,
            roundNo: Math.floor(afterSpeeches / 2),
            points,
            at: now().toISOString(),
            roster,
            bus,
          });
        } catch (error) {
          console.warn(
            '[runner] extraction skipped:',
            error instanceof Error ? error.message : 'unknown error',
          );
        }
      }

      // 3b. Host interjection every 4 expert turns. Not an expert turn, so it
      // neither bumps expert_turn_count nor opens an extraction window.
      if (afterSpeeches % 4 === 0 && !isAborted()) {
        try {
          const question = await generateInterjection(llm, {
            discussion_id: discussionId,
            topic: state.topic,
            host: { id: state.host.id, name: state.host.name },
            roster,
            recent_turns: loadTranscript(db, discussionId),
          });
          if (question.length > 0 && !isAborted()) {
            const at = now().toISOString();
            const turnNo = beginTurn(
              db,
              bus,
              discussionId,
              state.host.id,
              'question',
              '追问最分歧的一点',
              at,
            );
            finishTurn(
              db,
              bus,
              discussionId,
              state.host.id,
              turnNo,
              'question',
              question,
              '追问最分歧的一点',
              now().toISOString(),
            );
          }
        } catch (error) {
          if (error instanceof RunHalted) {
            return halted();
          }
          if (error instanceof LlmError && error.code === 'LLM_NOT_CONFIGURED') {
            throw error;
          }
          console.warn(
            '[runner] interjection skipped:',
            error instanceof Error ? error.message : 'unknown error',
          );
        }
      }
    }

    if (isAborted()) {
      return halted();
    }

    // 4. Wrap-up.
    const expertTurnCount = countExpertTurns(db, discussionId);
    if (
      expertTurnCount === 0 &&
      state.experts.length > 0 &&
      failedExperts.size === state.experts.length
    ) {
      finishAsFailed(db, bus, discussionId, 'ALL_SPEAKERS_FAILED', now().toISOString());
      return { status: 'failed', expert_turn_count: 0 };
    }

    const transcript = loadTranscript(db, discussionId);
    const emptyTranscript = transcript.length === 0;
    if (emptyTranscript) {
      finishReason = 'empty_transcript';
    }

    // 3c. Finalize points before the closing turn: keepers become `final`,
    // duplicates are `dropped` (one-way). Failure here must not block the run.
    try {
      finalizePoints(db, { discussionId, at: now().toISOString(), bus });
    } catch (error) {
      console.warn(
        '[runner] finalize points skipped:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }

    // The summary turn opens before the model call so `speaking` is visible for
    // the call duration; an empty transcript skips the call and uses AC-1.15's
    // fixed text.
    const summaryAt = now().toISOString();
    const summaryTurnNo = beginTurn(
      db,
      bus,
      discussionId,
      state.host.id,
      'summary',
      '收束全场',
      summaryAt,
    );
    markSpeaking(db, bus, discussionId, state.host.id, '收束全场', now().toISOString());

    let summary: SummaryResult;
    if (emptyTranscript) {
      summary = { text: EMPTY_TRANSCRIPT_SUMMARY, failed: false };
    } else {
      summary = await generateSummary(
        llm,
        {
          discussion_id: discussionId,
          topic: state.topic,
          transcript,
        },
        { timeout_ms: deps.summary_timeout_ms },
      );
    }

    if (isAborted()) {
      resetAgentIdle(db, bus, discussionId, state.host.id, now().toISOString());
      return halted();
    }

    finishAsFinished(
      db,
      bus,
      discussionId,
      state.host.id,
      summaryTurnNo,
      summary.text,
      finishReason,
      expertTurnCount,
      summary.failed,
      now().toISOString(),
    );

    return { status: 'finished', reason: finishReason, expert_turn_count: expertTurnCount };
  } catch (error) {
    if (error instanceof RunHalted) {
      return halted();
    }
    const code: ErrorCode =
      error instanceof LlmError ? error.code : 'LLM_UPSTREAM_ERROR';
    if (code === 'LLM_NOT_CONFIGURED' || code === 'LLM_UPSTREAM_ERROR') {
      finishAsFailed(db, bus, discussionId, code, now().toISOString());
      return { status: 'failed', expert_turn_count: countExpertTurns(db, discussionId) };
    }
    finishAsFailed(db, bus, discussionId, 'ALL_SPEAKERS_FAILED', now().toISOString());
    return { status: 'failed', expert_turn_count: countExpertTurns(db, discussionId) };
  }
}
