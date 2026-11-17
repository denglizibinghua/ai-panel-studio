<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import AppEmpty from '../components/common/AppEmpty.vue';
import AppPanel from '../components/common/AppPanel.vue';
import ConsensusBoard from '../components/theater/ConsensusBoard.vue';
import HostBar from '../components/theater/HostBar.vue';
import RosterPanel from '../components/theater/RosterPanel.vue';
import TranscriptFeed from '../components/theater/TranscriptFeed.vue';
import {
  mockAgentStatus,
  mockConsensus,
  mockDiscussions,
  mockDivergence,
  mockRoster,
  mockTurns,
} from '../mock/mock';
import type { DiscussionStatus } from '@ai-panel/shared';

/**
 * 演播厅（docs/SESSION_MAP.md §S7 · docs/DESIGN.md §8）。
 *
 * 布局纪律（上一版就是死在这里）：
 * 1. 两层壳：.studio-shell（容器所在）> .studio（栅格所在）。
 * 2. container-type 只在 .studio-shell 上；.studio 自己的栅格变化一律 @media。
 * 3. 页面永不滚动：.studio-shell 固定 100dvh + overflow hidden，滚动只发生在面板 body。
 * 4. ≥1800px 用 --stage-max 居中：舞台是阅读区，行宽超过 ~90 字中文会失去可读性，
 *    而 v1 没有第 4 栏的内容，加栏只会摊薄密度。
 */
const props = defineProps<{ id: string }>();

const route = useRoute();
const router = useRouter();

/** NaN / 未知 id 都回落到第一条（mock 至少有一条数据）。 */
const discussion = computed(() => {
  const numericId = Number(props.id);
  if (!Number.isFinite(numericId)) return mockDiscussions[0] ?? null;
  return mockDiscussions.find((item) => item.id === numericId) ?? mockDiscussions[0] ?? null;
});

/** QA 用：?state=empty 空态、?state=failed 失败态（只影响数据展示，不改壳）。 */
type QaState = 'empty' | 'failed' | null;

const qaState = computed<QaState>(() => {
  const raw = route.query.state;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'empty' || value === 'failed' ? value : null;
});

const STATUS_LABEL: Record<DiscussionStatus, string> = {
  draft: '待生成',
  generating: '生成中',
  ready: '待开始',
  running: '进行中',
  finished: '已结束',
  failed: '失败',
  cancelled: '已取消',
};

/** 取消是本地演示行为：mock 阶段不请求后端，「取消讨论」只把本场状态改掉。 */
const localStatus = ref<DiscussionStatus | null>(null);
const status = computed<DiscussionStatus>(
  () => localStatus.value ?? discussion.value?.status ?? 'draft',
);
const statusLabel = computed(() => STATUS_LABEL[status.value]);
const canCancel = computed(
  () =>
    status.value === 'draft' ||
    status.value === 'generating' ||
    status.value === 'ready' ||
    status.value === 'running',
);

const displayedTurns = computed(() => (qaState.value === 'empty' ? [] : mockTurns));
const consensusPoints = computed(() => (qaState.value === 'empty' ? [] : mockConsensus));
const divergencePoints = computed(() => (qaState.value === 'empty' ? [] : mockDivergence));

/* ── 响应式状态 ──────────────────────────────────────────
 * 断点判断 100% 在 CSS：@media 改 .studio 自己的栅格，@container 改面板内部。
 * JS 绝不读视口 —— Playwright 的视口模拟下 MediaQueryList 的 change 事件不保证派发，
 * 任何「JS 媒体查询分支」在 E2E 里都会冻结成挂载时的值，栅格已变单栏而渲染分支没变。
 * 这里只留两个纯 UI ref：当前标签、右栏抽屉开没开。 */
type TabKey = 'roster' | 'stage' | 'insights';
interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: readonly TabDef[] = [
  { key: 'roster', label: '阵容' },
  { key: 'stage', label: '现场' },
  { key: 'insights', label: '共识' },
];

const activeTab = ref<TabKey>('stage');
const drawerOpen = ref(false);

function selectTab(tab: TabKey): void {
  activeTab.value = tab;
}

function closeDrawer(): void {
  drawerOpen.value = false;
}

function toggleDrawer(): void {
  drawerOpen.value = !drawerOpen.value;
}

function cancelDiscussion(): void {
  localStatus.value = 'cancelled';
}

function exitStudio(): void {
  void router.push({ name: 'home' });
}

/** 失败态「重试」：清掉 QA 参数，回到正常数据（mock 阶段没有真实请求）。 */
function retry(): void {
  void router.replace({ query: { ...route.query, state: undefined } });
}
</script>

<template>
  <div class="studio-shell">
    <div class="studio">
      <div class="studio__header">
        <HostBar
          :topic="discussion?.topic ?? ''"
          :expert-count="discussion?.expert_count ?? 0"
          :status="status"
          :drawer-open="drawerOpen"
          :can-toggle-drawer="true"
          @toggle-drawer="toggleDrawer"
          @exit="exitStudio"
        />

        <div class="studio__tabs" role="tablist" aria-label="演播厅区域">
          <AppButton
            v-for="tab in TABS"
            :key="tab.key"
            size="sm"
            :variant="activeTab === tab.key ? 'primary' : 'ghost'"
            role="tab"
            :aria-selected="activeTab === tab.key"
            @click="selectTab(tab.key)"
          >
            {{ tab.label }}
          </AppButton>
        </div>
      </div>

      <RosterPanel
        class="studio__roster"
        :class="{ 'studio__roster--active': activeTab === 'roster' }"
        :guests="mockRoster"
        :status-map="mockAgentStatus"
      />

      <TranscriptFeed
        v-if="qaState !== 'failed'"
        class="studio__stage"
        :class="{ 'studio__stage--active': activeTab === 'stage' }"
        :turns="displayedTurns"
        :guests="mockRoster"
      />
      <AppPanel
        v-else
        class="studio__stage"
        :class="{ 'studio__stage--active': activeTab === 'stage' }"
        title="现场"
        scrollable
      >
        <AppEmpty
          class="studio__failed"
          title="本场讨论失败"
          hint="可以重新加入本场讨论"
        >
          <AppButton variant="secondary" size="sm" @click="retry">重试</AppButton>
        </AppEmpty>
      </AppPanel>

      <div
        class="studio__insights"
        :class="{
          'studio__insights--open': drawerOpen,
          'studio__insights--active': activeTab === 'insights',
        }"
      >
        <ConsensusBoard
          :consensus="consensusPoints"
          :divergence="divergencePoints"
          :guests="mockRoster"
        />
      </div>

      <div
        v-if="drawerOpen"
        class="drawer-scrim"
        aria-hidden="true"
        @click="closeDrawer"
      />

      <div class="studio__transport">
        <p class="transport__meta">第 {{ displayedTurns.length }} / 20 条 · {{ statusLabel }}</p>
        <AppButton
          variant="danger"
          size="sm"
          :disabled="!canCancel"
          @click="cancelDiscussion"
        >
          取消讨论
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 壳：容器开在这里，栅格在 .studio 上 ────────────────── */
.studio-shell {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  container-type: inline-size;
  background: var(--bg-base);
}

.studio {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-columns: minmax(0, var(--roster-w)) minmax(0, 1fr) minmax(0, var(--insights-w));
  grid-template-areas:
    'header header header'
    'roster stage insights'
    'transport transport transport';
  gap: var(--sp-4);
  padding: var(--sp-4);
}

.studio > * {
  min-width: 0;
  min-height: 0;
}

.studio__header {
  grid-area: header;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.studio__roster {
  grid-area: roster;
}

.studio__stage {
  grid-area: stage;
}

/* 右栏外壳：宽屏是普通栅格列；901–1200 变 fixed 抽屉（外壳只做定位，面板自带表面） */
.studio__insights {
  grid-area: insights;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.studio__insights > * {
  flex: 1 1 auto;
  min-height: 0;
}

.studio__transport {
  grid-area: transport;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-width: 0;
  padding: 0 var(--sp-1);
}

.transport__meta {
  margin: 0;
  overflow: hidden;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio__failed {
  height: 100%;
}

.studio__tabs {
  display: none;
}

/* 抽屉遮罩：默认不存在（display 只由 901–1200 的媒体查询打开） */
.drawer-scrim {
  display: none;
}

/* ── 901–1200：右栏折叠为 fixed 抽屉（.studio 自己 → @media）── */
@media (min-width: 901px) and (max-width: 1200px) {
  .studio {
    grid-template-columns: minmax(0, var(--roster-w)) minmax(0, 1fr);
    grid-template-areas:
      'header header'
      'roster stage'
      'transport transport';
  }

  .studio__insights {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    display: none;
    width: min(22rem, 88vw);
  }

  .studio__insights--open {
    display: flex;
  }

  .drawer-scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--bg-base);
    opacity: 0.72;
    z-index: 1;
  }
}

/* ── ≤900：单栏 + 顶部标签（.studio 自己 → @media）──────── */
@media (max-width: 900px) {
  .studio {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'header'
      'stage'
      'transport';
  }

  /* 三块内容共用 stage 格，只显示 activeTab 对应的那一块（纯 CSS，不读视口） */
  .studio__roster,
  .studio__stage,
  .studio__insights {
    grid-area: stage;
    display: none;
  }

  .studio__roster--active,
  .studio__stage--active,
  .studio__insights--active {
    display: flex;
  }

  /* 单栏里共识不再是抽屉：回到普通面板流 */
  .studio__insights {
    position: static;
    width: auto;
    border-left: 0;
    background: transparent;
  }

  .drawer-scrim {
    display: none;
  }

  .studio__tabs {
    display: flex;
    gap: var(--sp-2);
  }
}

/* ── ≥1800：舞台封顶并居中，不让正文行长继续拉长 ───────── */
@media (min-width: 1800px) {
  .studio {
    max-width: var(--stage-max);
    margin-inline: auto;
  }
}
</style>
