<script setup lang="ts">
/**
 * 卡片容器（docs/DESIGN.md §6）。
 * - `raised`：放在面板之上的一层（默认底就是 bg-raised，此开关保留语义）；
 * - `flat`：平铺行——无底、无圆角、无描边，只由列表自己画分隔线；
 * - `padded`：16px 内边距（关掉由业务组件自己控制）。
 */
withDefaults(defineProps<{ raised?: boolean; padded?: boolean; flat?: boolean }>(), {
  raised: false,
  padded: true,
  flat: false,
});
</script>

<template>
  <div
    :class="[
      'app-card',
      { 'app-card--raised': raised, 'app-card--padded': padded, 'app-card--flat': flat },
    ]"
  >
    <slot />
  </div>
</template>
