<script setup lang="ts">
import { computed } from 'vue';
import AppBadge from '../common/AppBadge.vue';
import AppButton from '../common/AppButton.vue';
import type { DiscussionStatus } from '@ai-panel/shared';

/**
 * 演播厅顶栏（页面 chrome，不用 AppCard）。
 * 讨论状态徽标按 DESIGN §6.2 的七态表：cancelled 与 failed 文案、颜色、装饰都不同。
 */
type BadgeTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

interface StatusView {
  tone: BadgeTone;
  label: string;
  dot: boolean;
  breathing: boolean;
  strike: boolean;
}

const STATUS_VIEW: Record<DiscussionStatus, StatusView> = {
  draft: { tone: 'neutral', label: '待生成', dot: false, breathing: false, strike: false },
  generating: { tone: 'info', label: '生成中', dot: false, breathing: true, strike: false },
  ready: { tone: 'info', label: '待开始', dot: false, breathing: false, strike: false },
  running: { tone: 'success', label: 'LIVE', dot: true, breathing: true, strike: false },
  finished: { tone: 'neutral', label: '已结束', dot: false, breathing: false, strike: false },
  failed: { tone: 'danger', label: '失败', dot: true, breathing: false, strike: false },
  cancelled: { tone: 'neutral', label: '已取消', dot: false, breathing: false, strike: true },
};

const props = withDefaults(
  defineProps<{
    topic: string;
    expertCount: number;
    status: DiscussionStatus;
    drawerOpen?: boolean;
    canToggleDrawer?: boolean;
  }>(),
  { drawerOpen: false, canToggleDrawer: false },
);

const emit = defineEmits<{ 'toggle-drawer': []; exit: [] }>();

const statusView = computed(() => STATUS_VIEW[props.status]);
</script>

<template>
  <header class="host-bar">
    <AppBadge
      :tone="statusView.tone"
      :dot="statusView.dot"
      :breathing="statusView.breathing"
    >
      <span :class="{ 'host-bar__strike': statusView.strike }">{{ statusView.label }}</span>
    </AppBadge>

    <h1 class="host-bar__topic" :title="topic">{{ topic }}</h1>

    <span class="host-bar__count">{{ expertCount }} 位专家</span>

    <AppButton
      v-if="canToggleDrawer"
      class="host-bar__drawer"
      size="sm"
      variant="secondary"
      :aria-expanded="drawerOpen"
      @click="emit('toggle-drawer')"
    >
      简报
    </AppButton>

    <AppButton variant="ghost" size="sm" @click="emit('exit')">退出</AppButton>
  </header>
</template>

<style scoped>
.host-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: var(--header-h);
  min-width: 0;
  container-type: inline-size;
}

.host-bar__topic {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  letter-spacing: var(--track-lg);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-bar__count {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
  white-space: nowrap;
}

.host-bar__strike {
  text-decoration: line-through;
}

/* 抽屉入口只在 901–1200 出现：宽屏三栏本身有右栏，单栏用顶部标签。
 * 由 CSS 决定显隐，不让 JS 读视口（E2E 的视口模拟不保证 matchMedia 事件）。 */
.host-bar__drawer {
  display: none;
}

/* 窄屏优先保住议题与退出，专家计数让位（只改本组件后代） */
@container (max-width: 26rem) {
  .host-bar__count {
    display: none;
  }
}

@media (min-width: 901px) and (max-width: 1200px) {
  .host-bar__drawer {
    display: inline-flex;
  }
}
</style>
