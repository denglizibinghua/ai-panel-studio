<script setup lang="ts">
/**
 * 三栏里每一栏都用它（docs/DESIGN.md §7.1 / §8）。
 * body 默认独立滚动；骨架、错误态直接塞进默认插槽即可。
 */
withDefaults(defineProps<{ title?: string; scrollable?: boolean }>(), {
  title: '',
  scrollable: true,
});
</script>

<template>
  <section class="app-panel">
    <header v-if="title || $slots.actions" class="app-panel__header">
      <h2 class="app-panel__title">{{ title }}</h2>
      <div v-if="$slots.actions">
        <slot name="actions" />
      </div>
    </header>
    <div :class="['app-panel__body', { 'app-panel__body--scroll': scrollable }]">
      <slot />
    </div>
  </section>
</template>
