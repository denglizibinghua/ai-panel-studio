<script setup lang="ts">
import { computed } from 'vue';
import AppBadge from '../common/AppBadge.vue';
import AppPanel from '../common/AppPanel.vue';
import { expertColorStyle } from '../../styles/expert-colors';
import type { AgentStatusView } from '../../api/types';
import type {
  AgentState,
  ConsensusPoint,
  DivergencePoint,
  Guest,
  Turn,
} from '@ai-panel/shared';

/**
 * 右栏「简报」（docs/DESIGN.md §7 / §10 Don't #6）。
 *
 * 四个区块，从上到下：进展 → 专家（色点图例 + 发声数）→ 共识 → 分歧。
 * v1 的右栏只有两组短列表，下半屏是死区；v2 用「进展 + 图例」把它填成控制台读数。
 * 所有数字都由 props 推导，不请求、不造数据。
 *
 * 进展的分母是**专家发言上限 20（AC-1.13）**，所以分子必须传 `expert_turn_count`
 * （主持人开场 / 追问 / 总结不计入），不能用 `turns.length` —— 真实一场约 27 条，
 * 拿总条数去除 20 会算出 27/20。
 */
type PointLike = Pick<ConsensusPoint, 'id' | 'text' | 'status' | 'support_guest_ids'>;

interface PointBlock {
  key: 'consensus' | 'divergence';
  title: string;
  points: readonly PointLike[];
}

const props = withDefaults(
  defineProps<{
    consensus: ConsensusPoint[];
    divergence: DivergencePoint[];
    guests: Guest[];
    statusMap?: Record<number, AgentStatusView>;
    turns?: Turn[];
    /** 必须是 expert_turn_count，不是 turns.length（AC-1.13） */
    expertTurns: number;
    totalTurns?: number;
    statusLabel?: string;
  }>(),
  {
    statusMap: () => ({}),
    turns: () => [],
    totalTurns: 20,
    statusLabel: '',
  },
);

const STATE_LABEL: Record<AgentState, string> = {
  idle: '待机',
  preparing: '准备',
  speaking: '发言',
};

const blocks = computed<readonly PointBlock[]>(() => [
  { key: 'consensus', title: '共识', points: props.consensus },
  { key: 'divergence', title: '分歧', points: props.divergence },
]);

const progressPercent = computed(() => {
  if (props.totalTurns <= 0) return 0;
  return Math.min(100, Math.round((props.expertTurns / props.totalTurns) * 100));
});

const legend = computed(() =>
  props.guests
    .filter((guest) => guest.role === 'expert')
    .map((guest) => ({
      guest,
      state: props.statusMap[guest.id]?.state ?? ('idle' as AgentState),
      turns: props.turns.filter((turn) => turn.guest_id === guest.id).length,
    })),
);

function guestName(guestId: number): string {
  return props.guests.find((guest) => guest.id === guestId)?.name ?? `嘉宾 #${guestId}`;
}

function supportLabel(guestIds: number[] | null): string {
  if (!guestIds || guestIds.length === 0) return '暂无支持';
  return `${guestIds.length} 人同意`;
}

/** 悬停时给出同意的具体嘉宾，让 guests prop 有真实的用武之地 */
function supportTitle(guestIds: number[] | null): string {
  if (!guestIds || guestIds.length === 0) return '';
  return guestIds.map(guestName).join('、');
}
</script>

<template>
  <AppPanel class="brief" title="简报" scrollable>
    <template #actions>
      <span class="brief__status">{{ statusLabel }}</span>
    </template>

    <div class="brief__stack">
      <section class="brief__section">
        <div class="brief__progress-head">
          <span class="brief__label">专家发言</span>
          <span class="brief__progress-value">{{ expertTurns }} / {{ totalTurns }}</span>
        </div>
        <div class="brief__track" role="presentation">
          <span class="brief__fill" :style="{ width: `${progressPercent}%` }" />
        </div>
      </section>

      <section v-if="legend.length" class="brief__section">
        <h3 class="brief__label">专家</h3>
        <ul class="brief__legend">
          <li
            v-for="row in legend"
            :key="row.guest.id"
            class="brief__legend-row"
            :style="expertColorStyle(row.guest.color_id)"
          >
            <span class="brief__dot" aria-hidden="true" />
            <span class="brief__name">{{ row.guest.name }}</span>
            <span class="brief__turns">{{ row.turns }} 条</span>
            <span
              class="brief__state"
              :class="{ 'brief__state--active': row.state !== 'idle' }"
            >
              {{ STATE_LABEL[row.state] }}
            </span>
          </li>
        </ul>
      </section>

      <section v-for="block in blocks" :key="block.key" class="brief__section">
        <h3 class="brief__label brief__label--dot">
          <span class="brief__mark" :class="`brief__mark--${block.key}`" aria-hidden="true" />
          {{ block.title }}
          <span class="brief__count">{{ block.points.length }}</span>
        </h3>

        <ul v-if="block.points.length" class="brief__list">
          <li v-for="point in block.points" :key="point.id" class="brief__item">
            <p class="brief__text">{{ point.text }}</p>
            <div class="brief__foot">
              <span class="brief__support" :title="supportTitle(point.support_guest_ids)">
                {{ supportLabel(point.support_guest_ids) }}
              </span>
              <AppBadge v-if="point.status === 'provisional'" tone="neutral">初步</AppBadge>
            </div>
          </li>
        </ul>
        <p v-else class="brief__none">讨论中，暂无</p>
      </section>
    </div>
  </AppPanel>
</template>

<style scoped>
.brief__status {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
}

.brief__stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  min-width: 0;
}

.brief__section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.brief__label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  font-size: var(--fs-micro);
  line-height: var(--lh-micro);
  font-weight: var(--fw-strong);
  letter-spacing: var(--track-micro);
  text-transform: uppercase;
  color: var(--fg-muted);
}

.brief__count {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  letter-spacing: 0;
  color: var(--fg-faint);
}

.brief__progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}

.brief__progress-value {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-secondary);
  font-variant-numeric: tabular-nums;
}

.brief__track {
  height: 3px;
  border-radius: var(--r-full);
  background: var(--line-subtle);
  overflow: hidden;
}

.brief__fill {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: var(--r-full);
}

.brief__legend {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.brief__legend-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-1) 0;
  border-bottom: 1px solid var(--line-subtle);
}

.brief__legend-row:last-child {
  border-bottom: 0;
}

.brief__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--expert-fg);
}

.brief__name {
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brief__turns {
  flex: none;
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.brief__state {
  flex: none;
  width: 2.2em;
  text-align: right;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-faint);
}

/* 状态词不放专家色：DESIGN §2.5 规定专家色只做身份标识（点/姓名/竖条/描边） */
.brief__state--active {
  color: var(--fg-primary);
}

.brief__mark {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
}

.brief__mark--consensus {
  background: var(--success);
}

.brief__mark--divergence {
  background: var(--danger);
}

.brief__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.brief__item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.brief__text {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-primary);
  overflow-wrap: anywhere;
}

.brief__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.brief__support {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.brief__none {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-muted);
}
</style>
