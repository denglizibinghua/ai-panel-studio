<script setup lang="ts">
/**
 * 三页共用的页框（docs/DESIGN.md §7）。
 *
 * 唯一职责：把内容钉死在同一个左边缘上。
 * - `--page-max: 90rem`，`padding-inline: --page-gutter`（桌面 24 / 窄屏 16）
 * - 100dvh 永不滚动，滚动只发生在页面自己的 body 区
 *
 * 页头、内容列都在这个盒子里，所以三页的 x=0 是同一条线。
 */
</script>

<template>
  <div class="page-frame">
    <div class="page-frame__inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.page-frame {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
}

.page-frame__inner {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--page-max);
  margin-inline: auto;
  padding-inline: var(--page-gutter);
}

.page-frame__inner > :deep(*) {
  min-height: 0;
}
</style>
