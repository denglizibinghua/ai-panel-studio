<script setup lang="ts">
import { computed } from 'vue';
import AppBadge from '../common/AppBadge.vue';
import type { AgentState } from '@ai-panel/shared';

/**
 * 专家三态徽标（docs/DESIGN.md §6.1）。
 *
 * 颜色只走 `colorId → expertColorStyle()`（AppBadge 的 tone="expert" 内部完成），
 * 呼吸复用 atoms.css 的 `.app-badge--breathing` / `@keyframes app-breath`，不另写动画。
 */
const props = defineProps<{ state: AgentState; colorId: string }>();

const LABEL: Record<AgentState, string> = {
  idle: '待机',
  preparing: '准备中',
  speaking: '发言中',
};

const label = computed(() => LABEL[props.state]);
</script>

<template>
  <AppBadge
    tone="expert"
    :expert-color="colorId"
    dot
    :breathing="state === 'preparing'"
  >
    {{ label }}
  </AppBadge>
</template>
