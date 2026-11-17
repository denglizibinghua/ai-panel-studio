<script setup lang="ts">
/**
 * 空态 / 未开始 / 失败占位（docs/DESIGN.md §9）。
 * 失败时不要用 toast，就地换成这个 + 一个 secondary 按钮。
 */
defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <div class="app-empty">
    <slot name="icon" />
    <p class="app-empty__title">{{ title }}</p>
    <p v-if="hint" class="app-empty__hint">{{ hint }}</p>
    <slot />
  </div>
</template>
