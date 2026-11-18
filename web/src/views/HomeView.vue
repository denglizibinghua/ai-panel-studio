<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DiscussionStatus } from '@ai-panel/shared';
import AppButton from '../components/common/AppButton.vue';
import AppCard from '../components/common/AppCard.vue';
import AppEmpty from '../components/common/AppEmpty.vue';
import DiscussionCard from '../components/home/DiscussionCard.vue';
import NewDiscussionForm from '../components/home/NewDiscussionForm.vue';
import PageShell from '../components/layout/PageShell.vue';
import { useHomeStore } from '../stores/home';

/**
 * 首页（docs/DESIGN.md §7/§10，SESSION_MAP §S8）。
 *
 * 视觉分工（v2）：
 * - 页头 56px + 页面主标题 xl：全站第一个层级锚点；
 * - 进行中 = 抬升行（bg-raised + hairline），已结束 = 平铺行（只有分隔线）；
 * - 每行直接消费列表载荷的 `expert_color_ids`（空数组时 DiscussionCard 不画点）。
 *
 * S8：列表、创建、错误全部走 `home` store，不再 import mock。
 */
type ListState = 'default' | 'empty' | 'loading' | 'error';

/** AC-3.2：draft 属于「进行中」（待生成），不再归档到已结束。 */
const ACTIVE_STATUSES: ReadonlySet<DiscussionStatus> = new Set([
  'draft',
  'generating',
  'ready',
  'running',
]);

const ENDED_STATUSES: ReadonlySet<DiscussionStatus> = new Set([
  'finished',
  'failed',
  'cancelled',
]);

const route = useRoute();
const router = useRouter();
const home = useHomeStore();

/**
 * 仅供 QA 截图：?state=empty|loading|error 覆盖**真实** store 状态，
 * 只读 query，不暴露入口（S11 统一删除并重拍截图）。
 */
const stateOverride = computed<ListState | null>(() => {
  const raw = route.query.state;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'empty' || value === 'loading' || value === 'error') {
    return value;
  }
  return null;
});

const listState = computed<ListState>(() => {
  if (stateOverride.value !== null) {
    return stateOverride.value;
  }
  if (home.loading && home.list.length === 0) {
    return 'loading';
  }
  // 列表已经加载过时，create / 其它动作的失败只用行内提示，不能把列表整页换成错误态。
  if (home.error !== null && home.list.length === 0) {
    return 'error';
  }
  return 'default';
});

const activeDiscussions = computed(() =>
  listState.value === 'empty'
    ? []
    : home.list.filter((discussion) => ACTIVE_STATUSES.has(discussion.status)),
);

const endedDiscussions = computed(() =>
  listState.value === 'empty'
    ? []
    : home.list.filter((discussion) => ENDED_STATUSES.has(discussion.status)),
);

const activeCount = computed(() => activeDiscussions.value.length);
const endedCount = computed(() => endedDiscussions.value.length);

const formOpen = ref(false);

function openForm(): void {
  formOpen.value = true;
}

function closeForm(): void {
  formOpen.value = false;
}

/** create → generate 成功后进确认页；失败留在首页，错误块由 store.error 驱动。 */
async function handleSubmit(payload: { topic: string; expertCount: number }): Promise<void> {
  const id = await home.create(payload);
  if (id === null) {
    return;
  }
  await router.push({ name: 'guest-confirm', params: { id } });
}

function retry(): void {
  void (async (): Promise<void> => {
    if (route.query.state !== undefined) {
      await router.replace({ name: 'home', query: {} });
    }
    await home.load();
  })();
}

onMounted(() => {
  void home.load();
});
</script>

<template>
  <PageShell>
    <header class="home__header">
      <div class="home__brand">
        <span class="home__wordmark">AI PANEL STUDIO</span>
        <span class="home__rule" aria-hidden="true" />
        <span class="home__crumb">讨论</span>
      </div>
      <AppButton variant="primary" @click="openForm">发起新讨论</AppButton>
    </header>

    <div class="home__scroll">
      <div class="home__content">
        <div class="home__lead">
          <h1 class="home__title">讨论</h1>
          <p class="home__meta">
            <span>{{ activeCount }} 进行中</span>
            <span class="home__meta-sep" aria-hidden="true">/</span>
            <span>{{ endedCount }} 已结束</span>
          </p>
        </div>

        <NewDiscussionForm
          v-if="formOpen"
          class="home__form"
          :generating="home.busy"
          @submit="handleSubmit"
          @cancel="closeForm"
        />

        <p
          v-if="home.error !== null && listState === 'default'"
          class="home__inline-error"
          role="alert"
        >
          {{ home.error }}
        </p>

        <div v-if="listState === 'loading'" class="home__rows" aria-busy="true">
          <AppCard v-for="slot in 3" :key="slot" class="home__skeleton" />
        </div>

        <AppEmpty
          v-else-if="listState === 'error'"
          title="加载失败"
          :hint="home.error ?? '讨论列表暂时无法加载，请稍后重试。'"
        >
          <AppButton variant="secondary" @click="retry">重试</AppButton>
        </AppEmpty>

        <template v-else>
          <section class="home__section">
            <div class="home__section-head">
              <h2 class="home__section-title">进行中</h2>
              <span class="home__section-count">{{ activeCount }}</span>
            </div>

            <div v-if="listState === 'default'" class="home__rows">
              <template v-if="home.busy">
                <AppCard
                  v-for="slot in 3"
                  :key="`pending-${slot}`"
                  class="home__skeleton"
                />
              </template>
              <DiscussionCard
                v-for="discussion in activeDiscussions"
                :key="discussion.id"
                :discussion="discussion"
                variant="active"
                :guest-color-ids="discussion.expert_color_ids"
              />
            </div>

            <AppEmpty
              v-if="listState === 'empty' || (activeDiscussions.length === 0 && !home.busy)"
              class="home__empty"
              title="暂无进行中的讨论"
              hint="点击右上角「发起新讨论」，从一个议题开始。"
            />
          </section>

          <section class="home__section">
            <div class="home__section-head">
              <h2 class="home__section-title">已结束</h2>
              <span class="home__section-count">{{ endedCount }}</span>
            </div>

            <div v-if="listState === 'default'" class="home__ended">
              <DiscussionCard
                v-for="discussion in endedDiscussions"
                :key="discussion.id"
                :discussion="discussion"
                variant="ended"
                :guest-color-ids="discussion.expert_color_ids"
              />
            </div>

            <AppEmpty
              v-if="listState === 'empty' || endedDiscussions.length === 0"
              class="home__empty"
              title="还没有结束的讨论"
              hint="讨论结束或取消后会归档到这里。"
            />
          </section>
        </template>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.home__header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  /* 56px 内容 + 1px 底边（与演播厅同高，见 DESIGN §7） */
  min-height: calc(var(--header-h) + 1px);
  border-bottom: 1px solid var(--line-subtle);
}

.home__brand {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
}

.home__wordmark {
  font-size: var(--fs-micro);
  line-height: var(--lh-micro);
  font-weight: var(--fw-strong);
  letter-spacing: 0.12em;
  color: var(--fg-secondary);
  white-space: nowrap;
}

.home__rule {
  width: 1px;
  height: 12px;
  background: var(--line-strong);
}

.home__crumb {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-muted);
  white-space: nowrap;
}

/* 页面唯一滚动区：页面永不滚，只有这里滚 */
.home__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding-bottom: var(--sp-7);
  color-scheme: dark;
}

.home__content {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  min-width: 0;
}

.home__lead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-6) 0 0;
}

.home__title {
  margin: 0;
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  letter-spacing: var(--track-xl);
  font-weight: var(--fw-strong);
  color: var(--fg-primary);
}

.home__meta {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.home__meta-sep {
  color: var(--fg-faint);
}

.home__form {
  width: 100%;
  max-width: var(--form-max);
}

.home__inline-error {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  overflow-wrap: anywhere;
}

.home__section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
}

.home__section-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line-subtle);
}

.home__section-title {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  letter-spacing: var(--track-lg);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
}

.home__section-count {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.home__rows {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.home__ended {
  display: flex;
  flex-direction: column;
}

.home__skeleton {
  height: 84px;
  animation: home-breath var(--dur-breath) var(--ease) infinite;
}

/* 循环动画本身；prefers-reduced-motion 由 tokens.css 的全局规则统一停掉 */
@keyframes home-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@media (max-width: 900px) {
  .home__lead {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-2);
    padding-top: var(--sp-5);
  }
}
</style>
