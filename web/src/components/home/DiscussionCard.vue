<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { DiscussionStatus } from '@ai-panel/shared';
import AppCard from '../common/AppCard.vue';
import AppBadge from '../common/AppBadge.vue';
import AppButton from '../common/AppButton.vue';
import type { MockDiscussion } from '../../mock/mock';

/**
 * 首页讨论卡（docs/SESSION_MAP.md §S7 线框）。
 * 状态徽标严格按 DESIGN.md §6.2：cancelled 用删除线，必须与 failed 区分。
 */
const props = defineProps<{ discussion: MockDiscussion }>();

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
  generating: { label: '生成中', tone: 'info', dot: false, breathing: true, lineThrough: false },
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
  <AppCard raised padded class="discussion-card">
    <div class="discussion-card__body">
      <div class="discussion-card__top">
        <h3 class="discussion-card__topic">{{ discussion.topic }}</h3>
        <div class="discussion-card__badges">
          <AppBadge tone="neutral">{{ discussion.guest_count }} 位嘉宾</AppBadge>
          <AppBadge
            :class="[
              'discussion-card__status',
              { 'discussion-card__status--cancelled': statusView.lineThrough },
            ]"
            :tone="statusView.tone"
            :dot="statusView.dot"
            :breathing="statusView.breathing"
          >
            {{ statusView.label }}
          </AppBadge>
        </div>
      </div>

      <p v-if="discussion.summary_text" class="discussion-card__summary">
        {{ discussion.summary_text }}
      </p>

      <div class="discussion-card__bottom">
        <span class="discussion-card__meta">{{ updatedLabel }}</span>
        <RouterLink v-slot="{ navigate }" :to="targetRoute" custom>
          <AppButton size="sm" variant="secondary" @click="navigate">{{ actionLabel }}</AppButton>
        </RouterLink>
      </div>
    </div>
  </AppCard>
</template>

<style scoped>
.discussion-card {
  container-type: inline-size;
}

.discussion-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
}

.discussion-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
  min-width: 0;
}

.discussion-card__topic {
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

.discussion-card__badges {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.discussion-card__status--cancelled {
  text-decoration: line-through;
}

.discussion-card__summary {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
}

.discussion-card__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.discussion-card__meta {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
}

/* 容器查询只改后代（DESIGN.md §8：容器自身布局不能用 @container） */
@container (max-width: 20rem) {
  .discussion-card__bottom {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-2);
  }
}
</style>
