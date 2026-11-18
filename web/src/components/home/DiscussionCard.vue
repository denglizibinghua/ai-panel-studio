<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { DiscussionStatus } from '@ai-panel/shared';
import AppBadge from '../common/AppBadge.vue';
import AppButton from '../common/AppButton.vue';
import AppCard from '../common/AppCard.vue';
import { expertColorStyle } from '../../styles/expert-colors';
import type { DiscussionSummary } from '../../api/types';

/**
 * 首页讨论行（docs/DESIGN.md §6 列表行 / §10 Don't #1）。
 *
 * 两种形态，靠**表面与分隔**区分，不靠颜色：
 * - active：抬升行（bg-raised + hairline），进行中 / 待开始 / 生成中；
 * - ended：平铺行（透明 + 上发丝线），已结束 / 失败 / 取消。
 *
 * 行内信息顺序固定：标识（专家色点）→ 主文本 → 元信息 → 动作。
 */
const props = withDefaults(
  defineProps<{
    discussion: DiscussionSummary;
    variant?: 'active' | 'ended';
    guestColorIds?: readonly string[];
  }>(),
  {
    variant: 'active',
    guestColorIds: () => [],
  },
);

type BadgeTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

interface StatusView {
  label: string;
  tone: BadgeTone;
  dot: boolean;
  breathing: boolean;
  lineThrough: boolean;
}

const STATUS_VIEW: Record<DiscussionStatus, StatusView> = {
  draft: { label: '待生成', tone: 'neutral', dot: false, breathing: false, lineThrough: false },
  generating: { label: '生成中', tone: 'warn', dot: false, breathing: true, lineThrough: false },
  ready: { label: '待开始', tone: 'info', dot: false, breathing: false, lineThrough: false },
  running: { label: '进行中', tone: 'success', dot: true, breathing: true, lineThrough: false },
  finished: { label: '已结束', tone: 'neutral', dot: false, breathing: false, lineThrough: false },
  failed: { label: '失败', tone: 'danger', dot: true, breathing: false, lineThrough: false },
  cancelled: { label: '已取消', tone: 'neutral', dot: false, breathing: false, lineThrough: true },
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatRelative(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const diff = Date.now() - timestamp;
  if (diff < MINUTE) {
    return '刚刚';
  }
  if (diff < HOUR) {
    return `${Math.floor(diff / MINUTE)} 分钟前`;
  }
  if (diff < DAY) {
    return `${Math.floor(diff / HOUR)} 小时前`;
  }
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

const statusView = computed(() => STATUS_VIEW[props.discussion.status]);

const watchable = computed(
  () =>
    props.discussion.status === 'draft' ||
    props.discussion.status === 'running' ||
    props.discussion.status === 'ready' ||
    props.discussion.status === 'generating',
);

const actionLabel = computed(() => (watchable.value ? '加入观察' : '查看记录'));

const targetRoute = computed(() => ({
  name: 'theater',
  params: { id: props.discussion.id },
}));

const updatedLabel = computed(() => `更新于 ${formatRelative(props.discussion.updated_at)}`);
</script>

<template>
  <AppCard
    :raised="variant === 'active'"
    :flat="variant === 'ended'"
    padded
    class="dcard"
    :class="`dcard--${variant}`"
  >
    <div class="dcard__head">
      <h3 class="dcard__topic">{{ discussion.topic }}</h3>

      <div class="dcard__meta">
        <span v-if="guestColorIds.length" class="dcard__dots" aria-hidden="true">
          <span
            v-for="colorId in guestColorIds"
            :key="colorId"
            class="dcard__dot"
            :style="expertColorStyle(colorId)"
          />
        </span>
        <span class="dcard__count">{{ discussion.guest_count }} 位嘉宾</span>
        <AppBadge
          :class="{ 'dcard__status--cancelled': statusView.lineThrough }"
          :tone="statusView.tone"
          :dot="statusView.dot"
          :breathing="statusView.breathing"
        >
          {{ statusView.label }}
        </AppBadge>
      </div>
    </div>

    <p v-if="discussion.summary_text" class="dcard__summary">
      {{ discussion.summary_text }}
    </p>

    <div class="dcard__foot">
      <span class="dcard__time">{{ updatedLabel }}</span>

      <RouterLink v-slot="{ navigate }" :to="targetRoute" custom>
        <AppButton
          size="sm"
          :variant="variant === 'active' ? 'secondary' : 'ghost'"
          @click="navigate"
        >
          {{ actionLabel }}
        </AppButton>
      </RouterLink>
    </div>
  </AppCard>
</template>

<style scoped>
.dcard {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
  transition:
    background var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.dcard--active:hover {
  background: var(--bg-hover);
  border-color: var(--line-strong);
}

.dcard--ended {
  padding: var(--sp-3) 0;
  border-top: 1px solid var(--line-subtle);
}

.dcard__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
  min-width: 0;
}

.dcard__topic {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
}

.dcard--ended .dcard__topic {
  font-weight: var(--fw-regular);
  color: var(--fg-secondary);
}

.dcard__status--cancelled {
  text-decoration: line-through;
}

.dcard__summary {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
}

.dcard--ended .dcard__summary {
  color: var(--fg-muted);
}

.dcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-width: 0;
  margin-top: var(--sp-1);
}

.dcard__meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.dcard__dots {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  flex: none;
}

.dcard__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--expert-fg, var(--fg-muted));
}

.dcard__count,
.dcard__time {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* 容器查询只改后代：行被压窄时把动作折到下一行 */
@container (max-width: 30rem) {
  .dcard__foot {
    flex-wrap: wrap;
    row-gap: var(--sp-2);
  }
}

/* 窄行（手机）把状态组折到标题下面，避免标题与徽标互相挤压 */
@container (max-width: 26rem) {
  .dcard__head {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-2);
  }

  .dcard__meta {
    width: 100%;
  }
}
</style>
