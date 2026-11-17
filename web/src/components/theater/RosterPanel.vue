<script setup lang="ts">
import { computed } from 'vue';
import AppEmpty from '../common/AppEmpty.vue';
import AppPanel from '../common/AppPanel.vue';
import ExpertCard from './ExpertCard.vue';
import type { MockAgentStatus } from '../../mock/mock';
import type { AgentState, Guest } from '@ai-panel/shared';

/**
 * 左栏「阵容」（docs/DESIGN.md §7 / §8）。
 *
 * 面板体自己排：列表独立滚动，底部固定一条收口信息（v2 消掉左栏下半屏死区）。
 */
const props = defineProps<{
  guests: Guest[];
  statusMap: Record<number, MockAgentStatus>;
}>();

const hostCount = computed(() => props.guests.filter((guest) => guest.role === 'host').length);
const expertCount = computed(() => props.guests.filter((guest) => guest.role === 'expert').length);
const speakingCount = computed(
  () => props.guests.filter((guest) => stateOf(guest.id) === 'speaking').length,
);

function stateOf(guestId: number): AgentState {
  return props.statusMap[guestId]?.state ?? 'idle';
}

function focusOf(guestId: number): string | null {
  return props.statusMap[guestId]?.focus ?? null;
}
</script>

<template>
  <AppPanel class="roster-panel" title="阵容" :scrollable="false">
    <template #actions>
      <span class="roster-panel__count">{{ guests.length }}</span>
    </template>

    <div class="roster-panel__body">
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

      <div class="roster-panel__foot">
        <span>{{ hostCount }} 主持 · {{ expertCount }} 专家</span>
        <span v-if="speakingCount" class="roster-panel__live">{{ speakingCount }} 位发言中</span>
        <span v-else class="roster-panel__idle">全场待机</span>
      </div>
    </div>
  </AppPanel>
</template>

<style scoped>
.roster-panel {
  container-type: inline-size;
}

.roster-panel__count {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.roster-panel__body {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-height: 0;
}

.roster-panel__list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  color-scheme: dark;
}

.roster-panel__foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line-subtle);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.roster-panel__live {
  color: var(--fg-secondary);
}

.roster-panel__idle {
  color: var(--fg-faint);
}

/* 面板被压窄时收紧卡间距（只改本组件后代） */
@container (max-width: 15rem) {
  .roster-panel__list {
    gap: var(--sp-1);
  }
}
</style>
