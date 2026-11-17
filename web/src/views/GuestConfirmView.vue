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
 * 确认本场阵容（docs/SESSION_MAP.md §S7）。
 *
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
  <PageShell wide>
    <header class="confirm__header">
      <AppButton variant="ghost" size="sm" @click="goHome">← 返回</AppButton>
      <div class="confirm__heading">
        <h1 class="confirm__title">确认本场阵容</h1>
        <p class="confirm__subtitle">{{ rosterSummary }}</p>
      </div>
    </header>

    <main class="confirm__body">
      <div
        v-if="pageState === 'loading'"
        class="confirm__grid"
        role="status"
        aria-label="阵容生成中"
      >
        <AppCard v-for="n in 5" :key="n" class="confirm__skeleton" raised padded />
      </div>

      <div v-else-if="pageState === 'error'" class="confirm__error">
        <AppEmpty title="阵容加载失败" hint="请重试生成嘉宾">
          <AppButton variant="secondary" @click="retry">重试</AppButton>
        </AppEmpty>
      </div>

      <div v-else class="confirm__grid">
        <GuestCard
          v-for="guest in roster"
          :key="guest.id"
          :guest="guest"
          :selected="guest.id === selectedId"
          @select="onSelect"
        />
      </div>
    </main>

    <footer class="confirm__footer">
      <AppButton variant="secondary" @click="regenerate">重新生成</AppButton>
      <AppButton variant="primary" @click="confirmRoster">确认进入演播厅</AppButton>
    </footer>
  </PageShell>
</template>

<style scoped>
.confirm__header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: none;
  padding: var(--sp-4) var(--sp-5);
}

.confirm__heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-3);
  min-width: 0;
}

.confirm__title {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: var(--fw-strong);
  color: var(--fg-primary);
}

.confirm__subtitle {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
}

.confirm__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: var(--sp-5);
}

.confirm__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
  align-content: start;
  gap: var(--sp-4);
  /* 5 张卡在宽屏排成 3+2（对齐 SESSION_MAP 线框），不让单张卡片被拉成一条横带 */
  width: 100%;
  max-width: 66rem;
  margin-inline: auto;
}

.confirm__skeleton {
  min-height: 9rem;
  animation: app-breath var(--dur-breath) var(--ease) infinite;
}

.confirm__error {
  display: flex;
  justify-content: center;
  padding-top: var(--sp-7);
}

.confirm__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-3);
  flex: none;
  padding: var(--sp-4) var(--sp-5);
  border-top: 1px solid var(--line-subtle);
}
</style>
