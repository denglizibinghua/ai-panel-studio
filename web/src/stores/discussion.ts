import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AgentState, ConsensusPoint, DiscussionStatus, DivergencePoint, Turn } from '@ai-panel/shared';
import { apiErrorMessage, cancelDiscussion, getDiscussion } from '../api/client';
import { subscribeDiscussionEvents, type SseFrame } from '../api/events';
import type { AgentStatusView, DiscussionDetail, DiscussionErrorCode } from '../api/types';

/**
 * 演播厅状态（SESSION_MAP §S8，AGENTS §6.4 / spec H1）。
 *
 * **五条数据流在客户端也必须物理分开**：`status` / `agentStatusMap` / `turns` /
 * `consensus` / `divergence` 是五个独立的 ref，不是一个大对象里的五个键。
 * 事件到达时各写各的，任何一个面板都不能靠「筛同一份数组」拿到别人的数据。
 *
 * 状态唯一的来源是 `events` 表（H6）：`GET /api/discussions/{id}` 只给阵容与
 * `last_event_seq`，transcript / 共识 / 分歧 / 专家状态只能从
 * `GET /events`（`Last-Event-ID: 0`）全量重放重建，之后靠增量帧推进。
 */

const TURN_KEY_SEPARATOR = ':';

type TurnKey = `${number}:${number}`;

const STATUS_VALUES: readonly DiscussionStatus[] = [
  'draft',
  'generating',
  'ready',
  'running',
  'finished',
  'failed',
  'cancelled',
];

const ERROR_CODES: readonly DiscussionErrorCode[] = [
  'LLM_NOT_CONFIGURED',
  'LLM_UPSTREAM_ERROR',
  'ALL_SPEAKERS_FAILED',
];

const AGENT_STATES: readonly AgentState[] = ['idle', 'preparing', 'speaking'];

const SPEECH_TYPES = ['opening', 'challenge', 'supplement', 'rebuttal', 'question', 'summary'] as const;
type SpeechType = (typeof SPEECH_TYPES)[number];

const STATUS_LABEL: Record<DiscussionStatus, string> = {
  draft: '待生成',
  generating: '生成中',
  ready: '待开始',
  running: '进行中',
  finished: '已结束',
  failed: '失败',
  cancelled: '已取消',
};

const CANCELLABLE_STATUSES: readonly DiscussionStatus[] = [
  'draft',
  'generating',
  'ready',
  'running',
];

interface PointPayload {
  point_id: number;
  text: string;
  status: ConsensusPoint['status'];
  support_guest_ids: number[];
  round_no: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isStatus(value: unknown): value is DiscussionStatus {
  return typeof value === 'string' && (STATUS_VALUES as readonly string[]).includes(value);
}

function isAgentState(value: unknown): value is AgentState {
  return typeof value === 'string' && (AGENT_STATES as readonly string[]).includes(value);
}

function isSpeechType(value: unknown): value is SpeechType {
  return typeof value === 'string' && (SPEECH_TYPES as readonly string[]).includes(value);
}

function isErrorCode(value: unknown): value is DiscussionErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function isPointStatus(value: unknown): value is ConsensusPoint['status'] {
  return value === 'provisional' || value === 'final' || value === 'dropped';
}

/** Malformed payloads are ignored, never thrown: one bad frame must not kill the stream. */
function parsePayload(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readSupportIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: number[] = [];
  for (const entry of value) {
    const id = asNumber(entry);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

function readPoint(data: string): PointPayload | null {
  const payload = parsePayload(data);
  if (payload === null) {
    return null;
  }
  const pointId = asNumber(payload.point_id);
  const text = asString(payload.text);
  if (pointId === null || text === null || !isPointStatus(payload.status)) {
    return null;
  }
  return {
    point_id: pointId,
    text,
    status: payload.status,
    support_guest_ids: readSupportIds(payload.support_guest_ids),
    round_no: asNumber(payload.round_no),
  };
}

function messageOf(error: unknown): string {
  return apiErrorMessage(error);
}

function turnKey(guestId: number, turnNo: number): TurnKey {
  return `${guestId}${TURN_KEY_SEPARATOR}${turnNo}`;
}

export const useDiscussionStore = defineStore('discussion', () => {
  /* ── 五份独立状态（H1：不得合并成一个对象）────────────────── */
  const status = ref<DiscussionStatus>('draft');
  const agentStatusMap = ref<Record<number, AgentStatusView>>({});
  const turns = ref<Turn[]>([]);
  const consensus = ref<ConsensusPoint[]>([]);
  const divergence = ref<DivergencePoint[]>([]);

  /* ── 传输层与连接状态 ─────────────────────────────────────── */
  const discussionId = ref<number | null>(null);
  const detail = ref<DiscussionDetail | null>(null);
  /** 易失缓冲：`turn.delta` 只进这里，`turn.done` 到达后删除（AC-1.23）。 */
  const streaming = ref<Record<TurnKey, string>>({});
  /** `turn.started` 的瞬时提示，按 (guest_id, turn_no) 幂等覆盖（events.md §8.1）。 */
  const startedTurns = ref<Record<TurnKey, number>>({});
  const lastSeq = ref(0);
  const caughtUp = ref(false);
  const connecting = ref(false);
  const errorCode = ref<DiscussionErrorCode | null>(null);
  const loadError = ref<string | null>(null);
  /** 写操作（取消）失败：就地提示，不能把已加载的演播厅整页换成错误态。 */
  const cancelError = ref<string | null>(null);

  let controller: AbortController | null = null;
  let openToken = 0;

  /**
   * `speaking` 的最小可见时长。
   *
   * 服务端把 `speaking` / `turn.done` / `idle` 写在**同一个事务**里
   * （`runner.ts` 的 `finishTurn`），三帧同一批到达，Vue 只渲染一次 ——
   * 于是契约里的 speaking 在浏览器里一帧都画不出来（AC-1.20 不可观测）。
   * 这里给 speaking→idle 一个最小驻留：状态确实发生过，只是把它拉到
   * 可感知；任何更新的 `agent.status` 帧都会取消这个延迟，不会覆盖新状态。
   */
  const SPEAKING_DWELL_MS = 600;
  const speakingStartedAt = new Map<number, number>();
  const pendingIdleTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const guests = computed(() => detail.value?.guests ?? []);

  /**
   * AC-1.13 分母 20 的分子：**专家** `turn.done` 的条数。
   *
   * 主持人开场 / 每 4 条一次的追问 / 结束总结都不算。口径与
   * `run.finished.expert_turn_count` 一致：只数 `role='expert'` 的发言者。
   * 用 `turns.length` 会把主持人的三条也算进去（真实一场约 27 条 → 27/20）。
   */
  const expertTurnCount = computed(() => {
    const expertIds = new Set(
      guests.value.filter((guest) => guest.role === 'expert').map((guest) => guest.id),
    );
    if (expertIds.size === 0) {
      return 0;
    }
    return turns.value.filter((turn) => expertIds.has(turn.guest_id)).length;
  });

  const statusLabel = computed(() => STATUS_LABEL[status.value]);

  const canCancel = computed(() => CANCELLABLE_STATUSES.includes(status.value));

  function reset(): void {
    status.value = 'draft';
    agentStatusMap.value = {};
    turns.value = [];
    consensus.value = [];
    divergence.value = [];
    detail.value = null;
    streaming.value = {};
    startedTurns.value = {};
    lastSeq.value = 0;
    caughtUp.value = false;
    errorCode.value = null;
    loadError.value = null;
    cancelError.value = null;
    clearAgentTimers();
  }

  function clearAgentTimers(): void {
    for (const timer of pendingIdleTimers.values()) {
      clearTimeout(timer);
    }
    pendingIdleTimers.clear();
    speakingStartedAt.clear();
  }

  function clearPendingIdle(guestId: number): void {
    const timer = pendingIdleTimers.get(guestId);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingIdleTimers.delete(guestId);
    }
  }

  function commitAgentStatus(
    guestId: number,
    state: AgentState,
    focus: string | null,
    frameId: number,
  ): void {
    const existing = agentStatusMap.value[guestId];
    // 迟到的旧帧（含被 dwell 延迟的 idle）不得覆盖更新的状态。
    if (existing !== undefined && existing.updated_seq >= frameId) {
      return;
    }
    // payload 没有 updated_seq —— 帧 id 就是 updated_seq（events.md §7.1 / INV-6）。
    agentStatusMap.value = {
      ...agentStatusMap.value,
      [guestId]: { state, focus, updated_seq: frameId },
    };
  }

  function applyState(data: string): void {
    const payload = parsePayload(data);
    if (payload === null || !isStatus(payload.status)) {
      return;
    }
    // state.* 是唯一的状态真相（H8）；run.* 不携带 status。
    status.value = payload.status;
  }

  function applyRunFailed(data: string): void {
    const payload = parsePayload(data);
    if (payload === null || !isErrorCode(payload.error_code)) {
      return;
    }
    errorCode.value = payload.error_code;
  }

  function applyAgentStatus(data: string, frameId: number | null): void {
    if (frameId === null) {
      return;
    }
    const payload = parsePayload(data);
    if (payload === null) {
      return;
    }
    const guestId = asNumber(payload.guest_id);
    if (guestId === null || !isAgentState(payload.state)) {
      return;
    }
    const focus = payload.focus === null ? null : asString(payload.focus);

    // 任何一帧新的状态都作废上一条 delayed idle，避免旧定时器回写。
    clearPendingIdle(guestId);

    if (payload.state === 'speaking') {
      // 同一时刻只能有一位「发言中」：新发言人出现时，把上一位的 dwell 立刻收口。
      for (const [otherId, view] of Object.entries(agentStatusMap.value)) {
        const id = Number(otherId);
        if (id === guestId || view.state !== 'speaking') {
          continue;
        }
        clearPendingIdle(id);
        speakingStartedAt.delete(id);
        agentStatusMap.value = {
          ...agentStatusMap.value,
          [id]: { state: 'idle', focus: null, updated_seq: view.updated_seq },
        };
      }
      speakingStartedAt.set(guestId, Date.now());
      commitAgentStatus(guestId, 'speaking', focus, frameId);
      return;
    }

    if (payload.state === 'idle') {
      const startedAt = speakingStartedAt.get(guestId);
      const elapsed =
        startedAt === undefined ? Number.POSITIVE_INFINITY : Date.now() - startedAt;
      if (elapsed < SPEAKING_DWELL_MS) {
        const delay = SPEAKING_DWELL_MS - elapsed;
        pendingIdleTimers.set(
          guestId,
          setTimeout(() => {
            pendingIdleTimers.delete(guestId);
            commitAgentStatus(guestId, 'idle', focus, frameId);
          }, delay),
        );
        return;
      }
      speakingStartedAt.delete(guestId);
    }

    commitAgentStatus(guestId, payload.state, focus, frameId);
  }

  function applyTurnStarted(data: string, frameId: number | null): void {
    const payload = parsePayload(data);
    if (payload === null) {
      return;
    }
    const guestId = asNumber(payload.guest_id);
    const turnNo = asNumber(payload.turn_no);
    if (guestId === null || turnNo === null) {
      return;
    }
    // 幂等覆盖：同一 (guest_id, turn_no) 允许出现两条 start、只有一条 done。
    startedTurns.value = {
      ...startedTurns.value,
      [turnKey(guestId, turnNo)]: frameId ?? 0,
    };
  }

  function applyTurnDelta(data: string): void {
    const payload = parsePayload(data);
    if (payload === null) {
      return;
    }
    const guestId = asNumber(payload.guest_id);
    const turnNo = asNumber(payload.turn_no);
    const delta = asString(payload.delta);
    if (guestId === null || turnNo === null || delta === null) {
      return;
    }
    const key = turnKey(guestId, turnNo);
    streaming.value = {
      ...streaming.value,
      [key]: (streaming.value[key] ?? '') + delta,
    };
  }

  function applyTurnDone(data: string): void {
    const payload = parsePayload(data);
    if (payload === null) {
      return;
    }
    const guestId = asNumber(payload.guest_id);
    const turnNo = asNumber(payload.turn_no);
    const content = asString(payload.content);
    const createdAt = asString(payload.created_at);
    if (guestId === null || turnNo === null || content === null || createdAt === null) {
      return;
    }
    if (!isSpeechType(payload.speech_type)) {
      return;
    }
    const owner = detail.value?.id ?? discussionId.value ?? 0;
    const turn: Turn = {
      // 本地稳定 key；服务端 turns.id 只在 REST 详情里，事件 payload 不带。
      id: turnNo,
      discussion_id: owner,
      guest_id: guestId,
      turn_no: turnNo,
      speech_type: payload.speech_type,
      content,
      created_at: createdAt,
    };
    const nextTurns = turns.value.filter((existing) => existing.turn_no !== turnNo);
    nextTurns.push(turn);
    nextTurns.sort((left, right) => left.turn_no - right.turn_no);
    turns.value = nextTurns;

    const key = turnKey(guestId, turnNo);
    if (key in streaming.value) {
      const nextStreaming = { ...streaming.value };
      delete nextStreaming[key];
      streaming.value = nextStreaming;
    }
    if (key in startedTurns.value) {
      const nextStarted = { ...startedTurns.value };
      delete nextStarted[key];
      startedTurns.value = nextStarted;
    }
  }

  /**
   * 增量渲染（AGENTS §6.9）：按 `point_id` upsert，只在帧 id 推进时应用。
   * `consensus` / `divergence` 是两个独立数组，任何情况下都不合并（H1）。
   *
   * `created_at` / `updated_at` 在事件 payload 里没有，UI 也不渲染；
   * 这里填本地接收时间只为满足 `ConsensusPoint` 的行形状，增量键始终是 `updated_seq`。
   */
  function applyPoint(data: string, frameId: number | null, target: 'consensus' | 'divergence'): void {
    if (frameId === null) {
      return;
    }
    const point = readPoint(data);
    if (point === null) {
      return;
    }
    const receivedAt = new Date().toISOString();
    const owner = detail.value?.id ?? discussionId.value ?? 0;

    if (target === 'consensus') {
      const existing = consensus.value.find((item) => item.id === point.point_id);
      if (existing !== undefined && existing.updated_seq >= frameId) {
        return;
      }
      const next: ConsensusPoint = {
        id: point.point_id,
        discussion_id: existing?.discussion_id ?? owner,
        text: point.text,
        status: point.status,
        support_guest_ids: point.support_guest_ids,
        round_no: point.round_no ?? existing?.round_no ?? null,
        updated_seq: frameId,
        created_at: existing?.created_at ?? receivedAt,
        updated_at: receivedAt,
      };
      consensus.value = upsertPoint(consensus.value, next);
      return;
    }

    const existing = divergence.value.find((item) => item.id === point.point_id);
    if (existing !== undefined && existing.updated_seq >= frameId) {
      return;
    }
    const next: DivergencePoint = {
      id: point.point_id,
      discussion_id: existing?.discussion_id ?? owner,
      text: point.text,
      status: point.status,
      support_guest_ids: point.support_guest_ids,
      round_no: point.round_no ?? existing?.round_no ?? null,
      updated_seq: frameId,
      created_at: existing?.created_at ?? receivedAt,
      updated_at: receivedAt,
    };
    divergence.value = upsertPoint(divergence.value, next);
  }

  function upsertPoint<T extends { id: number }>(list: T[], point: T): T[] {
    const next = list.filter((item) => item.id !== point.id);
    next.push(point);
    next.sort((left, right) => left.id - right.id);
    return next;
  }

  function handleFrame(frame: SseFrame): void {
    // 全局去重：持久帧按 seq 单调推进；无 id 的 delta 永不参与（AC-2.9）。
    if (frame.id !== null) {
      if (frame.id <= lastSeq.value) {
        return;
      }
      lastSeq.value = frame.id;
    }

    if (frame.type.startsWith('state.')) {
      applyState(frame.data);
      return;
    }
    if (frame.type === 'agent.status') {
      applyAgentStatus(frame.data, frame.id);
      return;
    }
    if (frame.type === 'turn.started') {
      applyTurnStarted(frame.data, frame.id);
      return;
    }
    if (frame.type === 'turn.delta') {
      applyTurnDelta(frame.data);
      return;
    }
    if (frame.type === 'turn.done') {
      applyTurnDone(frame.data);
      return;
    }
    if (frame.type === 'consensus.added' || frame.type === 'consensus.updated') {
      applyPoint(frame.data, frame.id, 'consensus');
      return;
    }
    if (frame.type === 'divergence.added' || frame.type === 'divergence.updated') {
      applyPoint(frame.data, frame.id, 'divergence');
      return;
    }
    if (frame.type === 'run.failed') {
      applyRunFailed(frame.data);
      return;
    }
    // run.started / run.finished / run.cancelled 只用于运行提示：
    // 状态来自 state.*，取消不是失败（不得写 errorCode，AC-1.24）。
  }

  async function open(id: number): Promise<void> {
    close();
    reset();
    discussionId.value = id;
    connecting.value = true;

    const token = openToken;
    let loaded: DiscussionDetail;
    try {
      loaded = await getDiscussion(id);
    } catch (error) {
      if (token !== openToken) {
        return;
      }
      loadError.value = messageOf(error);
      connecting.value = false;
      return;
    }
    if (token !== openToken) {
      return;
    }

    detail.value = loaded;
    status.value = loaded.status;
    errorCode.value = loaded.error_code;

    const abort = new AbortController();
    controller = abort;

    void subscribeDiscussionEvents({
      discussionId: id,
      // 全量重放是重建 turns / consensus / divergence 的唯一路径。
      lastEventId: 0,
      getLastSeq: () => lastSeq.value,
      signal: abort.signal,
      onFrame: (frame) => {
        if (token !== openToken) {
          return;
        }
        handleFrame(frame);
      },
      onCaughtUp: () => {
        if (token !== openToken) {
          return;
        }
        caughtUp.value = true;
        connecting.value = false;
      },
      onClosed: (reason) => {
        if (token !== openToken) {
          return;
        }
        connecting.value = false;
        if (reason === 'not_found') {
          loadError.value = '讨论不存在';
        } else if (reason === 'gave_up') {
          loadError.value = '实时连接已断开，请重试';
        }
      },
      onError: () => {
        // 瞬时断线由 events.ts 自己退避重连，`connecting` 保持为 true。
      },
    }).catch((error: unknown) => {
      if (token !== openToken) {
        return;
      }
      loadError.value = messageOf(error);
      connecting.value = false;
    });
  }

  function close(): void {
    openToken += 1;
    controller?.abort();
    controller = null;
    connecting.value = false;
    clearAgentTimers();
  }

  async function cancel(): Promise<void> {
    const id = discussionId.value;
    if (id === null) {
      return;
    }
    cancelError.value = null;
    try {
      await cancelDiscussion(id);
    } catch (error) {
      cancelError.value = messageOf(error);
    }
  }

  return {
    discussionId,
    detail,
    status,
    agentStatusMap,
    turns,
    consensus,
    divergence,
    streaming,
    startedTurns,
    lastSeq,
    caughtUp,
    connecting,
    errorCode,
    loadError,
    cancelError,
    guests,
    expertTurnCount,
    statusLabel,
    canCancel,
    open,
    close,
    cancel,
  };
});
