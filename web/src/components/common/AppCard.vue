<script setup lang="ts">
/** 卡片容器（docs/DESIGN.md §7.1）。raised = 放在面板之上的一层。 */
withDefaults(defineProps<{ raised?: boolean; padded?: boolean }>(), {
  raised: false,
  padded: true,
});
</script>

<template>
  <div
    :class="['app-card', { 'app-card--raised': raised, 'app-card--padded': padded }]"
  >
    <slot />
  </div>
</template>
