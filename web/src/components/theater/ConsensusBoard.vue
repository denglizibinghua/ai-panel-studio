<script setup lang="ts">
import { computed } from 'vue';
import AppBadge from '../common/AppBadge.vue';
import AppPanel from '../common/AppPanel.vue';
import type { ConsensusPoint, DivergencePoint, Guest } from '@ai-panel/shared';

/**
 * 右栏「共识 / 分歧」（docs/DESIGN.md §8 / §9）。
 * 两区共用同一块面板，只靠小标题前的色点区分：共识 --success、分歧 --danger。
 * 空列表不是 AppEmpty（DESIGN §9）：一行 --fg-muted 的「讨论中，暂无」。
 */
type PointLike = Pick<ConsensusPoint, 'id' | 'text' | 'status' | 'support_guest_ids'>;

interface PointBlock {
  key: 'consensus' | 'divergence';
  title: string;
  points: readonly PointLike[];
}

const props = defineProps<{
  consensus: ConsensusPoint[];
  divergence: DivergencePoint[];
  guests: Guest[];
}>();

const blocks = computed<readonly PointBlock[]>(() => [
  { key: 'consensus', title: '共识', points: props.consensus },
  { key: 'divergence', title: '分歧', points: props.divergence },
]);

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
  <AppPanel class="consensus-board" title="共识 / 分歧" scrollable>
    <div class="consensus-board__blocks">
      <section v-for="block in blocks" :key="block.key" class="consensus-board__block">
        <h3 class="consensus-board__heading">
          <span
            class="consensus-board__dot"
            :class="`consensus-board__dot--${block.key}`"
            aria-hidden="true"
          />
          {{ block.title }}
        </h3>

        <ul v-if="block.points.length" class="consensus-board__list">
          <li v-for="point in block.points" :key="point.id" class="consensus-board__item">
            <p class="consensus-board__text">{{ point.text }}</p>
            <div class="consensus-board__foot">
              <span class="consensus-board__support" :title="supportTitle(point.support_guest_ids)">
                {{ supportLabel(point.support_guest_ids) }}
              </span>
              <AppBadge v-if="point.status === 'provisional'" tone="neutral">初步</AppBadge>
            </div>
          </li>
        </ul>
        <p v-else class="consensus-board__none">讨论中，暂无</p>
      </section>
    </div>
  </AppPanel>
</template>

<style scoped>
.consensus-board__blocks {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  min-width: 0;
}

.consensus-board__block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.consensus-board__heading {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: var(--fw-strong);
  letter-spacing: 0.04em;
  color: var(--fg-secondary);
}

.consensus-board__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
}

.consensus-board__dot--consensus {
  background: var(--success);
}

.consensus-board__dot--divergence {
  background: var(--danger);
}

.consensus-board__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.consensus-board__item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.consensus-board__text {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-primary);
  overflow-wrap: anywhere;
}

.consensus-board__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.consensus-board__support {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.consensus-board__none {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-muted);
}
</style>
