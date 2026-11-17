import type { SpeechType } from '@ai-panel/shared';
import type { LedgerOutcome, LedgerRecentTurn, LedgerRosterMember } from './ledger';

/**
 * Scheduling decision (S5). Pure: no clock, no randomness, no I/O, no persistence.
 * Round-to-round state must arrive in `DecideInput` and leave in the result.
 */

export interface DecideInput {
  /** This turn's ledger outcome (S4). */
  ledger: LedgerOutcome;
  /** Speakable lineup only (locked=1 experts; the host is filtered by the caller). */
  roster: LedgerRosterMember[];
  /** Turns already produced, oldest first. Never mutated. */
  transcript: LedgerRecentTurn[];
  /** Expert turns already produced (host catches/questions excluded). */
  expert_turn_count: number;
  /** Stall counter produced by S4 for this turn (0..3). Echoed unchanged. */
  prev_stall_count: number;
  /** Hard cap on expert turns; defaults to 20 (spec AC-1.13). */
  max_expert_turns?: number;
}

export type DecideResult =
  | {
      action: 'speak';
      guest_id: number;
      speech_type: SpeechType;
      instruction: string | null;
      stall_count: number;
    }
  | {
      action: 'summarize';
      reason: 'request_satisfied' | 'max_turns';
      stall_count: number;
    }
  | {
      action: 'force_stop';
      reason: 'loop';
      stall_count: number;
    };

export type DecideErrorCode = 'EMPTY_ROSTER';

export class DecideError extends Error {
  readonly code: DecideErrorCode;

  constructor(code: DecideErrorCode, message: string) {
    super(message);
    this.name = 'DecideError';
    this.code = code;
  }
}

const DEFAULT_MAX_EXPERT_TURNS = 20;

const EXPERT_SPEECH_TYPES: ReadonlySet<SpeechType> = new Set<SpeechType>([
  'challenge',
  'supplement',
  'rebuttal',
  'question',
]);

/** Same rule as the ledger fallback: never-spoken first, then the oldest appearance. */
function mostStaleMember(
  roster: LedgerRosterMember[],
  transcript: LedgerRecentTurn[],
  excludeId: number | null,
): LedgerRosterMember {
  const lastSeen = new Map<number, number>();
  transcript.forEach((turn, index) => {
    lastSeen.set(turn.guest_id, index);
  });

  const withoutExcluded =
    excludeId === null ? roster : roster.filter((member) => member.id !== excludeId);
  const pool = withoutExcluded.length > 0 ? withoutExcluded : roster;

  const first = pool[0];
  if (first === undefined) {
    throw new DecideError('EMPTY_ROSTER', '嘉宾名单为空，无法决定下一位发言者');
  }

  let winner = first;
  let winnerSeen = lastSeen.get(first.id) ?? -1;
  for (const member of pool.slice(1)) {
    const seen = lastSeen.get(member.id) ?? -1;
    if (seen < winnerSeen) {
      winner = member;
      winnerSeen = seen;
    }
  }
  return winner;
}

function resolveSpeechType(value: SpeechType | null): SpeechType {
  return value !== null && EXPERT_SPEECH_TYPES.has(value) ? value : 'supplement';
}

/**
 * Decision order (first match wins):
 *   1. empty roster        -> typed error
 *   2. stall_count >= 3    -> force_stop (AC-1.12)
 *   3. request satisfied   -> summarize (AC-1.13)
 *   4. turn cap reached    -> summarize (AC-1.13)
 *   5. otherwise           -> speak, never the guest who just spoke (AC-1.21)
 */
export function decide(input: DecideInput): DecideResult {
  const { ledger, roster, transcript, expert_turn_count, prev_stall_count } = input;

  if (roster.length === 0) {
    throw new DecideError('EMPTY_ROSTER', '嘉宾名单为空，无法决定下一位发言者');
  }

  const stall_count = prev_stall_count;

  if (stall_count >= 3) {
    return { action: 'force_stop', reason: 'loop', stall_count };
  }

  if (ledger.is_request_satisfied) {
    return { action: 'summarize', reason: 'request_satisfied', stall_count };
  }

  const maxExpertTurns = input.max_expert_turns ?? DEFAULT_MAX_EXPERT_TURNS;
  if (expert_turn_count >= maxExpertTurns) {
    return { action: 'summarize', reason: 'max_turns', stall_count };
  }

  const rosterIds = new Set(roster.map((member) => member.id));
  // 只看最后一条**专家**发言：主持人开场/追问也在这条 transcript 里（AC-1.25），
  // 若拿"最后一条发言"直接比对，主持人插一句追问就能让同一位专家连说两次（AC-1.21）。
  let lastSpeakerId: number | null = null;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const last = transcript[index];
    if (last !== undefined && rosterIds.has(last.guest_id)) {
      lastSpeakerId = last.guest_id;
      break;
    }
  }
  const picked =
    ledger.next_guest_id === null
      ? undefined
      : roster.find((member) => member.id === ledger.next_guest_id);

  let candidate = picked ?? mostStaleMember(roster, transcript, null);
  if (lastSpeakerId !== null && candidate.id === lastSpeakerId) {
    candidate = mostStaleMember(roster, transcript, lastSpeakerId);
  }

  return {
    action: 'speak',
    guest_id: candidate.id,
    speech_type: resolveSpeechType(ledger.speech_type),
    instruction: ledger.instruction,
    stall_count,
  };
}
