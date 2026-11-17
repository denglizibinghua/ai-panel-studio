<script setup lang="ts">
import { computed } from 'vue';
import type { Guest } from '@ai-panel/shared';
import AppBadge from '../common/AppBadge.vue';
import AppCard from '../common/AppCard.vue';
import { expertColorStyle } from '../../styles/expert-colors';

/**
 * 确认阵容页的嘉宾卡（docs/DESIGN.md §7.2）。
 *
 * 专家色只走 expertColorStyle()，不做第二份色表；
 * 选中只换底色 + 描边（不加阴影，DESIGN.md §4）。
 */
const props = withDefaults(defineProps<{ guest: Guest; selected?: boolean }>(), {
  selected: false,
});

const emit = defineEmits<{ select: [guestId: number] }>();

const roleLabel = computed(() => (props.guest.role === 'host' ? '主持' : '专家'));

function onSelect(): void {
  emit('select', props.guest.id);
}
</script>

<template>
  <AppCard
    class="guest-card"
    :class="{ 'guest-card--selected': selected }"
    raised
    padded
    role="button"
    tabindex="0"
    :aria-pressed="selected"
    :style="expertColorStyle(guest.color_id)"
    @click="onSelect"
    @keydown.enter="onSelect"
    @keydown.space.prevent="onSelect"
  >
    <div class="guest-card__top">
      <span class="guest-card__swatch" aria-hidden="true" />
      <span class="guest-card__name">{{ guest.name }}</span>
      <AppBadge class="guest-card__role" tone="expert" :expert-color="guest.color_id">
        {{ roleLabel }}
      </AppBadge>
    </div>

    <p class="guest-card__profession">{{ guest.profession }}</p>
    <p class="guest-card__stance">{{ guest.stance }}</p>
  </AppCard>
</template>

<style scoped>
.guest-card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
  min-height: 9rem;
  container-type: inline-size;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.guest-card--selected {
  background: var(--expert-bg);
  border-color: var(--expert-ring);
}

.guest-card:focus-visible {
  outline: 2px solid var(--expert-ring);
  outline-offset: 2px;
}

.guest-card__top {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.guest-card__swatch {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: var(--r-full);
  background: var(--expert-fg);
}

.guest-card__name {
  min-width: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
  overflow-wrap: anywhere;
}

.guest-card__role {
  margin-left: auto;
}

.guest-card__profession {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
  overflow-wrap: anywhere;
}

.guest-card__stance {
  display: -webkit-box;
  margin: 0;
  margin-top: var(--sp-2);
  overflow: hidden;
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--fg-primary);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

/* 窄卡（≤15rem）把角色徽标折到姓名下面；容器查询只改后代，不动卡片自身布局 */
@container (max-width: 15rem) {
  .guest-card__top {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr);
    grid-template-areas:
      'swatch name'
      '. role';
    align-items: center;
  }

  .guest-card__swatch {
    grid-area: swatch;
  }

  .guest-card__name {
    grid-area: name;
  }

  .guest-card__role {
    grid-area: role;
    margin-left: 0;
    justify-self: start;
  }
}
</style>
