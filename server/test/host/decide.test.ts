import { describe, expect, it } from 'vitest';
import type { LedgerOutcome, LedgerRecentTurn, LedgerRosterMember } from '../../src/modules/host/ledger';
import { DecideError, decide, type DecideInput } from '../../src/modules/host/decide';

const ROSTER: LedgerRosterMember[] = [
  { id: 11, name: '专家甲', profession: '教育学者', stance: '支持技术辅助教学' },
  { id: 12, name: '专家乙', profession: '一线教师', stance: '担心技术取代教师' },
  { id: 13, name: '专家丙', profession: '政策研究员', stance: '主张分阶段推进' },
];

function nameOf(guestId: number): string {
  return ROSTER.find((member) => member.id === guestId)?.name ?? `嘉宾${guestId}`;
}

function turn(guestId: number, speechType = 'challenge'): LedgerRecentTurn {
  return { guest_id: guestId, speaker_name: nameOf(guestId), speech_type: speechType, content: '一句话发言' };
}

function makeLedger(overrides: Partial<LedgerOutcome> = {}): LedgerOutcome {
  return {
    parse_status: 'structured',
    is_request_satisfied: false,
    is_in_loop: false,
    is_progress_being_made: true,
    next_guest_id: 12,
    next_speaker_name: '专家乙',
    speech_type: 'challenge',
    instruction: '请回应成本问题',
    stall_count: 0,
    raw: '{}',
    issues: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    ledger: makeLedger(),
    roster: ROSTER.map((member) => ({ ...member })),
    transcript: [],
    expert_turn_count: 2,
    prev_stall_count: 0,
    ...overrides,
  };
}

describe('decide', () => {
  it('returns a speak decision with the ledger guest, speech type and instruction', () => {
    const result = decide(makeInput());

    expect(result).toEqual({
      action: 'speak',
      guest_id: 12,
      speech_type: 'challenge',
      instruction: '请回应成本问题',
      stall_count: 0,
    });
  });

  it('falls back to the most stale speaker when the ledger picks someone off-roster', () => {
    const result = decide(
      makeInput({
        ledger: makeLedger({ next_guest_id: 999, next_speaker_name: '名单外的人' }),
        transcript: [turn(12), turn(13)],
      }),
    );

    expect(result).toEqual({
      action: 'speak',
      guest_id: 11,
      speech_type: 'challenge',
      instruction: '请回应成本问题',
      stall_count: 0,
    });
  });

  it('asks for a summary once the ledger says the request is satisfied', () => {
    const result = decide(
      makeInput({ ledger: makeLedger({ is_request_satisfied: true }) }),
    );

    expect(result).toEqual({ action: 'summarize', reason: 'request_satisfied', stall_count: 0 });
  });

  it('force-stops after three consecutive no-progress turns', () => {
    const result = decide(
      makeInput({ ledger: makeLedger({ is_in_loop: true }), prev_stall_count: 3 }),
    );

    expect(result).toEqual({ action: 'force_stop', reason: 'loop', stall_count: 3 });
  });

  it('switches speakers when the chosen guest just spoke, even back-to-back twice', () => {
    const single = decide(makeInput({ transcript: [turn(12)] }));
    expect(single).toEqual({
      action: 'speak',
      guest_id: 11,
      speech_type: 'challenge',
      instruction: '请回应成本问题',
      stall_count: 0,
    });

    const twice = decide(makeInput({ transcript: [turn(12), turn(12)] }));
    expect(twice.action).toBe('speak');
    expect(twice.action === 'speak' ? twice.guest_id : null).toBe(11);
  });

  it('still switches when a host turn sits between two expert turns (AC-1.25 + AC-1.21)', () => {
    // 主持人 id 不在 roster 里；中间插一条追问，不能让"同一专家连说两次"被放过
    const withHostQuestion = [turn(12), turn(10, 'question')];
    const result = decide(makeInput({ transcript: withHostQuestion }));

    expect(result.action).toBe('speak');
    expect(result.action === 'speak' ? result.guest_id : null).toBe(11);
  });

  it('asks for a summary when the expert turn cap is reached', () => {
    const result = decide(makeInput({ expert_turn_count: 20 }));

    expect(result).toEqual({ action: 'summarize', reason: 'max_turns', stall_count: 0 });
  });

  it('throws a typed error instead of returning undefined when the roster is empty', () => {
    expect(() => decide(makeInput({ roster: [] }))).toThrow(DecideError);
    try {
      decide(makeInput({ roster: [] }));
    } catch (error) {
      expect(error instanceof DecideError ? error.code : null).toBe('EMPTY_ROSTER');
    }
  });

  it('does not mutate the transcript or roster it was handed', () => {
    const transcript = [turn(13), turn(12)];
    const roster = ROSTER.map((member) => ({ ...member }));
    const snapshot = structuredClone(transcript);

    decide(makeInput({ transcript, roster }));

    expect(transcript).toHaveLength(snapshot.length);
    expect(transcript).toEqual(snapshot);
    expect(roster).toEqual(ROSTER);
  });

  it('returns identical results for the same input twice, including stall_count', () => {
    const input = makeInput({
      ledger: makeLedger({ stall_count: 2 }),
      prev_stall_count: 2,
      transcript: [turn(11), turn(13)],
      expert_turn_count: 4,
    });

    const first = decide(input);
    const second = decide(input);

    expect(second).toEqual(first);
    expect(first.stall_count).toBe(2);
    expect(second.stall_count).toBe(2);
  });
});
