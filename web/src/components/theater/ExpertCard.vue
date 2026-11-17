<script setup lang="ts">
import { computed } from 'vue';
import AppCard from '../common/AppCard.vue';
import ExpertStatusBadge from './ExpertStatusBadge.vue';
import { expertColorStyle } from '../../styles/expert-colors';
import type { AgentState, Guest } from '@ai-panel/shared';

/**
 * 阵容里的专家卡（docs/DESIGN.md §8.1）。
 *
 * 三态：
 * - idle：6px 点 `--fg-muted`，卡底 `--bg-raised`（AppCard 默认底）
 * - preparing：6px 专家 `-fg` + 2px `-ring` 外圈 + 呼吸
 * - speaking：8px 实心 `-fg` + 2px `-ring`，左侧 2px `-fg` 竖条
 *
 * 关于「preparing 卡底用专家 bg 的 60%」：token 只有 `-bg`（12% 透明）一档，
 * 没有 color-mix / 第二档透明度可用，再叠一层半透明会引入裸色值。
 * 所以 preparing 与 speaking 共用 `--expert-bg`，靠**圆点尺寸 + 左侧竖条 + 徽标呼吸**区分。
 * 左侧竖条用 `border-left` 表达，不用 box-shadow（DESIGN §5 全站零投影）。
 */
const props = withDefaults(
  defineProps<{ guest: Guest; state: AgentState; focus?: string | null }>(),
  { focus: null },
);

/** focus 上限 80 字（DESIGN §6.1），超出先截断，再由 2 行 clamp 兜底。 */
const focusText = computed(() => {
  const value = props.focus?.trim() ?? '';
  if (!value) return '';
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
});

const showFocus = computed(
  () => props.state === 'preparing' && focusText.value.length > 0,
);
</script>

<template>
  <AppCard
    class="expert-card"
    raised
    padded
    :style="expertColorStyle(guest.color_id)"
    :data-state="state"
  >
    <span
      class="app-status-dot expert-card__dot"
      :class="{
        'app-status-dot--preparing': state === 'preparing',
        'app-status-dot--speaking': state === 'speaking',
      }"
      aria-hidden="true"
    />

    <div class="expert-card__body">
      <div class="expert-card__name-row">
        <span class="expert-card__name">{{ guest.name }}</span>
        <span class="expert-card__badge">
          <ExpertStatusBadge :state="state" :color-id="guest.color_id" />
        </span>
      </div>
      <p class="expert-card__profession">{{ guest.profession }}</p>
      <p v-if="showFocus" class="expert-card__focus">{{ focusText }}</p>
    </div>
  </AppCard>
</template>

<style scoped>
.expert-card {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  min-width: 0;
  container-type: inline-size;
  transition: background var(--dur-base) var(--ease);
}

.expert-card[data-state='preparing'],
.expert-card[data-state='speaking'] {
  background: var(--expert-bg);
}

/* speaking 的左侧 2px 专家色竖条：用描边表达，不用投影（DESIGN §5） */
.expert-card[data-state='speaking'] {
  border-left: 2px solid var(--expert-fg);
}

.expert-card__dot {
  margin-top: var(--sp-1);
}

.expert-card__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.expert-card__name-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.expert-card__name {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
  overflow-wrap: anywhere;
}

.expert-card__badge {
  flex: none;
  margin-left: auto;
}

.expert-card__profession {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
  overflow-wrap: anywhere;
}

.expert-card__focus {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-secondary);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* 卡片自己被压窄时（面板被拖到很窄），状态徽标落到姓名下面。
 * 阈值 13rem 而不是 15rem：容器查询量的是 .expert-card 的**内容盒**，
 * AppCard padded 已经吃掉 2×--sp-4，15rem 会在默认 18rem roster 下就触发。 */
@container (max-width: 13rem) {
  .expert-card__name-row {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-1);
  }

  .expert-card__badge {
    margin-left: 0;
  }
}
</style>
