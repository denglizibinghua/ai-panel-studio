<script setup lang="ts">
import AppEmpty from '../common/AppEmpty.vue';
import AppPanel from '../common/AppPanel.vue';
import ExpertCard from './ExpertCard.vue';
import type { MockAgentStatus } from '../../mock/mock';
import type { AgentState, Guest } from '@ai-panel/shared';

/**
 * 左栏「阵容」（docs/DESIGN.md §8）。
 * 滚动交给 AppPanel 的 body（--scroll 已带 overscroll-behavior / scrollbar-gutter），
 * 这里不再套第二个 scroller —— 只负责把 5 张卡竖着排。
 */
const props = defineProps<{
  guests: Guest[];
  statusMap: Record<number, MockAgentStatus>;
}>();

function stateOf(guestId: number): AgentState {
  return props.statusMap[guestId]?.state ?? 'idle';
}

function focusOf(guestId: number): string | null {
  return props.statusMap[guestId]?.focus ?? null;
}
</script>

<template>
  <AppPanel class="roster-panel" title="阵容" scrollable>
    <template #actions>
      <span class="roster-panel__count">{{ guests.length }}</span>
    </template>

    <div v-if="guests.length" class="roster-panel__list">
      <ExpertCard
        v-for="guest in guests"
        :key="guest.id"
        :guest="guest"
        :state="stateOf(guest.id)"
        :focus="focusOf(guest.id)"
      />
    </div>
    <AppEmpty v-else title="阵容为空" />
  </AppPanel>
</template>

<style scoped>
.roster-panel {
  container-type: inline-size;
}

.roster-panel__count {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.roster-panel__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

/* 面板被压窄时收紧卡间距（只改本组件后代） */
@container (max-width: 15rem) {
  .roster-panel__list {
    gap: var(--sp-1);
  }
}
</style>
