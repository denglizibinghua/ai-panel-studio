<script setup lang="ts">
/**
 * 页面壳（docs/DESIGN.md §8）：整页 100dvh、永不滚动，内部面板各自滚。
 * 只用布局，不含任何视觉控件；Home / GuestConfirm 都套这一层。
 */
withDefaults(defineProps<{ wide?: boolean }>(), { wide: false });
</script>

<template>
  <div class="page-shell">
    <div :class="['page-shell__inner', { 'page-shell__inner--wide': wide }]">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.page-shell {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}

.page-shell > :deep(*) {
  min-height: 0;
}

.page-shell__inner {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.page-shell__inner--wide {
  max-width: var(--stage-max);
  margin: 0 auto;
}
</style>
