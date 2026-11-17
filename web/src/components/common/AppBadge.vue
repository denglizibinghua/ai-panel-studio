<script setup lang="ts">
import { computed } from 'vue';
import { expertColorStyle } from '../../styles/expert-colors';

/**
 * 状态徽标（docs/DESIGN.md §6.2）。
 * tone="expert" 时通过 expertColor 注入 --expert-fg/-bg/-ring，
 * 这是全站唯一的 color_id → CSS 变量入口。
 */
type BadgeTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger' | 'expert';

const props = withDefaults(
  defineProps<{
    tone?: BadgeTone;
    dot?: boolean;
    breathing?: boolean;
    expertColor?: string;
  }>(),
  {
    tone: 'neutral',
    dot: false,
    breathing: false,
    expertColor: '',
  },
);

const colorVars = computed(() =>
  props.tone === 'expert' ? expertColorStyle(props.expertColor) : undefined,
);
</script>

<template>
  <span
    :class="['app-badge', `app-badge--${tone}`, { 'app-badge--breathing': breathing }]"
    :style="colorVars"
  >
    <span v-if="dot" class="app-badge__dot" aria-hidden="true" />
    <slot />
  </span>
</template>
