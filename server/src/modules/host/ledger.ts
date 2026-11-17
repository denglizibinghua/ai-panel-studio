import { llmLedgerDecisionSchema, type LlmLedgerDecision, type SpeechType } from '@ai-panel/shared';
import type { ChatJsonClient, ChatJsonMessage } from '../../llm/client';
import { buildLedgerMessages, buildLedgerRetryMessages } from './prompt';

/**
 * Host ledger (S4): request one scheduling decision per turn.
 *
 * Hard boundaries (AGENTS.md §8 + SESSION_MAP S4):
 * - `module: 'ledger'` is passed here, by this caller — never defaulted elsewhere.
 * - The LLM client is injected; this file imports no SDK, no transport, no config.
 * - Stall counting is pure: `prev_stall_count` in, `stall_count` out, no module state.
 */

export interface LedgerRosterMember {
  id: number;
  name: string;
  profession: string;
  stance: string;
}

export interface LedgerRecentTurn {
  guest_id: number;
  speaker_name: string;
  speech_type: string;
  content: string;
}

export interface LedgerContext {
  discussion_id: number;
  topic: string;
  /** Locked lineup rows only (locked=1); the host itself is filtered out by the caller. */
  roster: LedgerRosterMember[];
  recent_turns: LedgerRecentTurn[];
  /** Expert turns already produced in this discussion. */
  expert_turn_count: number;
  /** Stall counter handed in by the runner (0..3). */
  prev_stall_count: number;
}

export interface LedgerOutcome {
  parse_status: 'structured' | 'json_mode' | 'fallback';
  is_request_satisfied: boolean;
  is_in_loop: boolean;
  is_progress_being_made: boolean;
  next_guest_id: number | null;
  next_speaker_name: string | null;
  speech_type: SpeechType | null;
  instruction: string | null;
  stall_count: number;
  raw: string;
  issues: string[];
}

export interface LedgerValidation {
  ok: boolean;
  decision: LlmLedgerDecision | null;
  issues: string[];
}

/** Strips ```json fences and parses; returns null instead of throwing. */
export function parseLedger(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Zod shape check plus "next_speaker must exist in this turn's roster". */
export function validateLedger(obj: unknown, roster: LedgerRosterMember[]): LedgerValidation {
  const result = llmLedgerDecisionSchema.safeParse(obj);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`,
    );
    return { ok: false, decision: null, issues };
  }

  const decision = result.data;
  const names = new Set(roster.map((member) => member.name));
  if (!names.has(decision.next_speaker.answer)) {
    return { ok: false, decision: null, issues: ['next_speaker.answer: not_in_roster'] };
  }
  return { ok: true, decision, issues: [] };
}

/**
 * stall_count delta: any loop or lack of progress bumps by 1 (capped at 3),
 * real progress cools down by 1 (floored at 0).
 */
export function computeStallDelta(
  isInLoop: boolean,
  isProgressBeingMade: boolean,
  prev: number,
): number {
  return isInLoop || !isProgressBeingMade
    ? Math.min(prev + 1, 3)
    : Math.max(prev - 1, 0);
}

/** Most stale = no appearance in recent_turns, else oldest appearance. Roster order breaks ties. */
function pickMostStaleMember(ctx: LedgerContext): LedgerRosterMember | null {
  const first = ctx.roster[0];
  if (first === undefined) {
    return null;
  }

  const lastSeen = new Map<number, number>();
  ctx.recent_turns.forEach((turn, index) => {
    lastSeen.set(turn.guest_id, index);
  });

  let winner = first;
  let winnerSeen = lastSeen.get(first.id) ?? -1;
  for (const member of ctx.roster.slice(1)) {
    const seen = lastSeen.get(member.id) ?? -1;
    if (seen < winnerSeen) {
      winner = member;
      winnerSeen = seen;
    }
  }
  return winner;
}

function buildSuccessOutcome(
  parseStatus: 'structured' | 'json_mode',
  raw: string,
  decision: LlmLedgerDecision,
  ctx: LedgerContext,
): LedgerOutcome {
  const speakerName = decision.next_speaker.answer;
  const speaker = ctx.roster.find((member) => member.name === speakerName);

  return {
    parse_status: parseStatus,
    is_request_satisfied: decision.is_request_satisfied.answer,
    is_in_loop: decision.is_in_loop.answer,
    is_progress_being_made: decision.is_progress_being_made.answer,
    next_guest_id: speaker?.id ?? null,
    next_speaker_name: speakerName,
    speech_type: decision.speech_type.answer,
    instruction: decision.instruction.answer,
    stall_count: computeStallDelta(
      decision.is_in_loop.answer,
      decision.is_progress_being_made.answer,
      ctx.prev_stall_count,
    ),
    raw,
    issues: [],
  };
}

function buildFallbackOutcome(raw: string, issues: string[], ctx: LedgerContext): LedgerOutcome {
  const speaker = pickMostStaleMember(ctx);
  return {
    parse_status: 'fallback',
    is_request_satisfied: false,
    is_in_loop: false,
    is_progress_being_made: false,
    next_guest_id: speaker?.id ?? null,
    next_speaker_name: speaker?.name ?? null,
    speech_type: 'supplement',
    instruction: null,
    stall_count: computeStallDelta(false, false, ctx.prev_stall_count),
    raw,
    issues,
  };
}

interface LedgerAttempt {
  raw: string;
  check: LedgerValidation;
}

async function requestAttempt(
  llm: ChatJsonClient,
  ctx: LedgerContext,
  messages: ChatJsonMessage[],
  isRetry: boolean,
): Promise<LedgerAttempt> {
  const raw = await llm.complete({
    messages,
    discussionId: ctx.discussion_id,
    module: 'ledger',
    isRetry,
    validate: (candidate) => {
      const parsed = parseLedger(candidate);
      return parsed !== null && validateLedger(parsed, ctx.roster).ok;
    },
  });

  const parsed = parseLedger(raw);
  if (parsed === null) {
    return { raw, check: { ok: false, decision: null, issues: ['(root): invalid_json'] } };
  }
  return { raw, check: validateLedger(parsed, ctx.roster) };
}

/**
 * Two strict layers, then fallback (fallback is not a third attempt):
 *   attempt 1 ok            -> 'structured'
 *   attempt 1 bad, retry ok -> 'json_mode'
 *   both bad                -> 'fallback' (most stale speaker, speech_type 'supplement')
 *
 * Upstream LLM failures propagate to the caller (runner owns run.failed, S6.5).
 */
export async function requestLedger(
  llm: ChatJsonClient,
  ctx: LedgerContext,
): Promise<LedgerOutcome> {
  const messages = buildLedgerMessages(ctx);

  const first = await requestAttempt(llm, ctx, messages, false);
  if (first.check.ok && first.check.decision !== null) {
    return buildSuccessOutcome('structured', first.raw, first.check.decision, ctx);
  }

  console.warn('[ledger] invalid LLM output (attempt 1):', first.check.issues.join('; '));
  console.warn('[ledger] invalid raw output (attempt 1):', first.raw);

  const second = await requestAttempt(
    llm,
    ctx,
    buildLedgerRetryMessages(messages, first.check.issues),
    true,
  );
  if (second.check.ok && second.check.decision !== null) {
    return buildSuccessOutcome('json_mode', second.raw, second.check.decision, ctx);
  }

  console.warn('[ledger] invalid LLM output (attempt 2):', second.check.issues.join('; '));
  console.warn('[ledger] invalid raw output (attempt 2):', second.raw);

  return buildFallbackOutcome(second.raw, second.check.issues, ctx);
}
