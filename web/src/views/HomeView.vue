<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { DiscussionStatus } from '@ai-panel/shared';
import PageShell from '../components/layout/PageShell.vue';
import AppButton from '../components/common/AppButton.vue';
import AppCard from '../components/common/AppCard.vue';
import AppEmpty from '../components/common/AppEmpty.vue';
import DiscussionCard from '../components/home/DiscussionCard.vue';
import NewDiscussionForm from '../components/home/NewDiscussionForm.vue';
import { mockDiscussions } from '../mock/mock';

/**
 * 首页（docs/SESSION_MAP.md §S7 线框 + DESIGN.md §8）。
 * 整页不滚：只有 .home-page__scroll 内部滚动。
 * 数据全部来自 mock；S8 再把 store / fetch 接到本文件。
 */
type ListState = 'default' | 'empty' | 'loading' | 'error';

const ACTIVE_STATUSES: ReadonlySet<DiscussionStatus> = new Set([
  'running',
  'ready',
  'generating',
]);

const ENDED_STATUSES: ReadonlySet<DiscussionStatus> = new Set([
  'finished',
  'failed',
  'cancelled',
  'draft',
]);

const route = useRoute();
const router = useRouter();

/**
 * 仅供 QA 截图：?state=empty|loading|error 覆盖列表区，
 * 不在界面上暴露入口（不改路由表，只读 query）。
 */
const listState = computed<ListState>(() => {
  const raw = route.query.state;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'empty' || value === 'loading' || value === 'error') {
    return value;
  }
  return 'default';
});

const activeDiscussions = computed(() =>
  mockDiscussions.filter((discussion) => ACTIVE_STATUSES.has(discussion.status)),
);

const endedDiscussions = computed(() =>
  mockDiscussions.filter((discussion) => ENDED_STATUSES.has(discussion.status)),
);

const activeCount = computed(() => (listState.value === 'empty' ? 0 : activeDiscussions.value.length));
const endedCount = computed(() => (listState.value === 'empty' ? 0 : endedDiscussions.value.length));

const formOpen = ref(false);
const generating = ref(false);

function openForm(): void {
  formOpen.value = true;
}

function closeForm(): void {
  formOpen.value = false;
  generating.value = false;
}

/**
 * S7 只有壳：不发请求、不设定时器。
 * 提交后表单保持展开，generating 固定为 true，进行中组渲染 3 张骨架卡。
 * S8 在这里接 store / fetch：拿到真实嘉宾后关闭 generating 并插入新讨论。
 */
function handleSubmit(): void {
  generating.value = true;
}

/**
 * 错误态下的「重试」：shell 阶段没有后端，清掉 ?state 覆盖回到正常列表。
 * S8 接真实请求后，这里改成重新拉取。
 */
function retry(): void {
  void router.replace({ name: 'home', query: {} });
}
</script>

<template>
  <PageShell wide>
    <header class="home-page__topbar">
      <div class="home-page__brand">
        <span class="home-page__wordmark">AI PANEL STUDIO</span>
        <span class="home-page__section">讨论列表</span>
      </div>
      <AppButton variant="primary" @click="openForm">发起新讨论</AppButton>
    </header>

    <div class="home-page__scroll">
      <div class="home-page__content">
        <NewDiscussionForm
          v-if="formOpen"
          :generating="generating"
          @submit="handleSubmit"
          @cancel="closeForm"
        />

        <div v-if="listState === 'loading'" class="home-page__cards" aria-busy="true">
          <AppCard v-for="slot in 3" :key="slot" raised padded class="home-page__skeleton" />
        </div>

        <AppEmpty
          v-else-if="listState === 'error'"
          title="加载失败"
          hint="讨论列表暂时无法加载，请稍后重试。"
        >
          <AppButton variant="secondary" @click="retry">重试</AppButton>
        </AppEmpty>

        <div v-else class="home-page__groups">
          <section class="home-page__group">
            <h2 class="home-page__group-heading">
              进行中
              <span class="home-page__group-count">{{ activeCount }}</span>
            </h2>
            <div v-if="listState === 'default'" class="home-page__cards">
              <template v-if="generating">
                <AppCard
                  v-for="slot in 3"
                  :key="`pending-${slot}`"
                  raised
                  padded
                  class="home-page__skeleton"
                />
              </template>
              <DiscussionCard
                v-for="discussion in activeDiscussions"
                :key="discussion.id"
                :discussion="discussion"
              />
            </div>
            <AppEmpty
              v-if="listState === 'empty' || (activeDiscussions.length === 0 && !generating)"
              title="暂无进行中的讨论"
              hint="点击右上角「发起新讨论」，从一个议题开始。"
            />
          </section>

          <section class="home-page__group">
            <h2 class="home-page__group-heading">
              已结束
              <span class="home-page__group-count">{{ endedCount }}</span>
            </h2>
            <div v-if="listState === 'default'" class="home-page__cards">
              <DiscussionCard
                v-for="discussion in endedDiscussions"
                :key="discussion.id"
                :discussion="discussion"
              />
            </div>
            <AppEmpty
              v-if="listState === 'empty' || endedDiscussions.length === 0"
              title="还没有结束的讨论"
              hint="讨论结束或取消后会归档到这里。"
            />
          </section>
        </div>
      </div>
    </div>
  </PageShell>
</template>

<style scoped>
.home-page__topbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
  border-bottom: 1px solid var(--line-subtle);
}

.home-page__brand {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  min-width: 0;
}

.home-page__wordmark {
  font-size: var(--fs-sm);
  font-weight: var(--fw-strong);
  letter-spacing: 0.12em;
  color: var(--fg-secondary);
  white-space: nowrap;
}

.home-page__section {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  white-space: nowrap;
}

/* 页面唯一滚动区（DESIGN.md §8：面板内部自己滚） */
.home-page__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: var(--sp-5) var(--sp-5) var(--sp-7);
  /* 让原生滚动条跟随暗色主题（不引入任何色值 token） */
  color-scheme: dark;
}

.home-page__content {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  min-width: 0;
}

.home-page__groups {
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
  min-width: 0;
}

.home-page__group-heading {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: var(--fw-strong);
  color: var(--fg-primary);
}

.home-page__group-count {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: var(--fw-regular);
  color: var(--fg-secondary);
}

.home-page__cards {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.home-page__skeleton {
  height: 64px;
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
</style>
