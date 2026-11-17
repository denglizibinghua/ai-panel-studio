<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import AppCard from '../components/common/AppCard.vue';
import AppEmpty from '../components/common/AppEmpty.vue';
import GuestCard from '../components/guest/GuestCard.vue';
import PageShell from '../components/layout/PageShell.vue';
import { mockRoster } from '../mock/mock';

/**
 * 确认本场阵容（docs/DESIGN.md §7 / §10，SESSION_MAP §S7）。
 *
 * 与首页同一页框、同一页头高度、同一标题字号阶（xl / sm）。
 * S7 只做壳：不请求、不进 store，名单直接读 mockRoster。
 * `?state=loading|error` 仅用于截图走查，不在界面上暴露。
 */
const props = defineProps<{ id: string }>();

const router = useRouter();
const route = useRoute();

const roster = computed(() => {
  const discussionId = Number(props.id);
  if (!Number.isFinite(discussionId)) return mockRoster;
  const matched = mockRoster.filter((guest) => guest.discussion_id === discussionId);
  return matched.length > 0 ? matched : mockRoster;
});

const hostCount = computed(() => roster.value.filter((guest) => guest.role === 'host').length);
const expertCount = computed(() => roster.value.filter((guest) => guest.role === 'expert').length);
const rosterSummary = computed(() => `${expertCount.value} 位专家 + ${hostCount.value} 位主持`);

const pageState = computed<'ready' | 'loading' | 'error'>(() => {
  const raw = route.query.state;
  return raw === 'loading' || raw === 'error' ? raw : 'ready';
});

const selectedId = ref<number | null>(null);

function goHome(): void {
  void router.push({ name: 'home' });
}

function regenerate(): void {
  selectedId.value = null;
}

function confirmRoster(): void {
  void router.push({ name: 'theater', params: { id: props.id } });
}

function retry(): void {
  void router.replace({ query: { ...route.query, state: undefined } });
}

function onSelect(guestId: number): void {
  selectedId.value = guestId;
}
</script>

<template>
  <PageShell>
    <header class="confirm__header">
      <div class="confirm__head-left">
        <AppButton variant="ghost" size="sm" @click="goHome">← 返回</AppButton>
        <span class="confirm__rule" aria-hidden="true" />
        <span class="confirm__crumb">阵容确认</span>
      </div>
      <span class="confirm__meta">{{ rosterSummary }}</span>
    </header>

    <main class="confirm__body">
      <div class="confirm__lead">
        <h1 class="confirm__title">确认本场阵容</h1>
      </div>

      <div
        v-if="pageState === 'loading'"
        class="confirm__grid"
        role="status"
        aria-label="阵容生成中"
      >
        <AppCard v-for="n in 5" :key="n" class="confirm__skeleton" />
      </div>

      <div v-else-if="pageState === 'error'" class="confirm__error">
        <AppEmpty title="阵容加载失败" hint="请重试生成嘉宾">
          <AppButton variant="secondary" @click="retry">重试</AppButton>
        </AppEmpty>
      </div>

      <div v-else class="confirm__grid">
        <GuestCard
          v-for="(guest, index) in roster"
          :key="guest.id"
          :guest="guest"
          :index="index + 1"
          :selected="guest.id === selectedId"
          @select="onSelect"
        />
      </div>
    </main>

    <footer class="confirm__footer">
      <div class="confirm__actions">
        <AppButton variant="secondary" @click="regenerate">重新生成</AppButton>
        <AppButton variant="primary" @click="confirmRoster">确认进入演播厅</AppButton>
      </div>
    </footer>
  </PageShell>
</template>

<style scoped>
.confirm__header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-4);
  /* 56px 内容 + 1px 底边（与演播厅同高，见 DESIGN §7） */
  min-height: calc(var(--header-h) + 1px);
  border-bottom: 1px solid var(--line-subtle);
}

.confirm__head-left {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.confirm__rule {
  width: 1px;
  height: 12px;
  background: var(--line-strong);
}

.confirm__crumb {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-muted);
  white-space: nowrap;
}

.confirm__meta {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.confirm__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: var(--sp-6) 0;
  color-scheme: dark;
}

.confirm__lead {
  margin-bottom: var(--sp-5);
}

.confirm__title {
  margin: 0;
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  letter-spacing: var(--track-xl);
  font-weight: var(--fw-strong);
  color: var(--fg-primary);
}

/* 5 张卡 3+2：桌面固定 3 列，宽度收在阅读列内，左边缘与页框一致 */
.confirm__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: var(--sp-4);
  width: 100%;
  max-width: var(--read-max);
}

.confirm__skeleton {
  min-height: 10rem;
  animation: confirm-breath var(--dur-breath) var(--ease) infinite;
}

.confirm__error {
  display: flex;
  justify-content: flex-start;
}

.confirm__footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: var(--header-h);
  border-top: 1px solid var(--line-subtle);
}

.confirm__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

@keyframes confirm-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@media (max-width: 1100px) {
  .confirm__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .confirm__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
