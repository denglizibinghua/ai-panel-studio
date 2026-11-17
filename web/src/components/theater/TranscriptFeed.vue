<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppEmpty from '../common/AppEmpty.vue';
import AppPanel from '../common/AppPanel.vue';
import TranscriptItem from './TranscriptItem.vue';
import type { Guest, Turn } from '@ai-panel/shared';

/**
 * 中栏「现场」（docs/DESIGN.md §7）。
 * 滚动由 AppPanel body 负责；挂载后一次性滚到底（不挂 interval、不 watch）。
 * 背景用 --bg-inset：DESIGN §2.1 把 transcript 区定义为内嵌凹槽，舞台因此比两侧暗一档。
 */
const props = defineProps<{ turns: Turn[]; guests: Guest[]; emptyHint?: string }>();

const listRef = ref<HTMLElement | null>(null);

const guestById = computed(() => {
  const map = new Map<number, Guest>();
  for (const guest of props.guests) map.set(guest.id, guest);
  return map;
});

function guestOf(guestId: number): Guest | undefined {
  return guestById.value.get(guestId);
}

onMounted(() => {
  const body = listRef.value?.closest('.app-panel__body');
  if (body instanceof HTMLElement) {
    body.scrollTop = body.scrollHeight;
  }
});
</script>

<template>
  <AppPanel class="transcript-feed" title="现场" scrollable>
    <template #actions>
      <span class="transcript-feed__count">{{ turns.length }} 条</span>
    </template>

    <div v-if="turns.length" ref="listRef" class="transcript-feed__list">
      <TranscriptItem
        v-for="turn in turns"
        :key="turn.id"
        :turn="turn"
        :guest="guestOf(turn.guest_id)"
      />
    </div>
    <AppEmpty v-else class="transcript-feed__empty" title="等待主持人开场" :hint="emptyHint" />
  </AppPanel>
</template>

<style scoped>
.transcript-feed {
  background: var(--bg-inset);
}

.transcript-feed__count {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.transcript-feed__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  min-width: 0;
}

.transcript-feed__list > * {
  min-width: 0;
}

.transcript-feed__empty {
  height: 100%;
}
</style>
