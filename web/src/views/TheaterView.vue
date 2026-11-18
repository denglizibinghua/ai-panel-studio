<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppButton from '../components/common/AppButton.vue';
import AppEmpty from '../components/common/AppEmpty.vue';
import AppPanel from '../components/common/AppPanel.vue';
import ConsensusBoard from '../components/theater/ConsensusBoard.vue';
import HostBar from '../components/theater/HostBar.vue';
import RosterPanel from '../components/theater/RosterPanel.vue';
import SummaryPanel from '../components/theater/SummaryPanel.vue';
import TranscriptFeed from '../components/theater/TranscriptFeed.vue';
import { useDiscussionStore } from '../stores/discussion';

/**
 * 演播厅（docs/DESIGN.md §7 / §10，SESSION_MAP §S8）。
 *
 * 布局纪律（上一版就是死在这里）：
 * 1. 三层：.studio-shell（容器）> .studio-frame（页框）> .studio（栅格）。
 * 2. container-type 只在 .studio-shell 上；.studio 自己的栅格变化一律 @media。
 * 3. 页框与首页/确认页同源：max-width 90rem + padding-inline 24/16 —— 三页左边缘同一条线。
 * 4. 页面永不滚动：shell 固定 100dvh + overflow hidden，滚动只发生在面板 body。
 * 5. 左右栏不留死区：左栏底部有收口信息条，右栏是「简报」（进展 / 专家 / 共识 / 分歧）。
 *
 * S8：视觉冻结，只换数据来源 —— 所有面板读 `discussion` store，不再 import mock。
 */
const props = defineProps<{ id: string }>();

const route = useRoute();
const router = useRouter();
const store = useDiscussionStore();

const numericId = computed(() => Number(props.id));

const discussion = computed(() => store.detail);
const status = computed(() => store.status);
const statusLabel = computed(() => store.statusLabel);
const canCancel = computed(() => store.canCancel);

/**
 * QA 用：?state=empty 空态、?state=failed 失败态。
 * S8 起覆盖的是**真实 store 状态**，不再是无请求的假开关。
 */
type QaState = 'empty' | 'failed' | null;

const qaState = computed<QaState>(() => {
  const raw = route.query.state;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'empty' || value === 'failed' ? value : null;
});

/** AC-1.13：专家发言上限 20 条；主持人开场 / 追问 / 总结不计入这个数。 */
const EXPERT_TURN_CAP = 20;

/** 打不开（404 / 详情请求失败）：整页级错误，与「本场跑失败」区分。 */
const loadFailure = computed(
  () => store.loadError !== null && store.detail === null,
);

/**
 * 只有「打不开」和 QA 的 `?state=failed` 才整块换掉现场。
 * 一场跑失败（`status='failed'`）要保留 transcript，并交给底部 SummaryPanel
 * 显示失败态与重试按钮（S9；ALL_SPEAKERS_FAILED 才能重试）。
 */
const stageFailure = computed(() => qaState.value === 'failed' || loadFailure.value);

const failureTitle = computed(() =>
  loadFailure.value ? '无法打开这场讨论' : '本场讨论失败',
);
const failureHint = computed(() =>
  loadFailure.value ? (store.loadError ?? '讨论不存在') : '可以重新加入本场讨论',
);

const displayedTurns = computed(() =>
  qaState.value === 'empty'
    ? []
    : store.turns.filter((turn) => turn.speech_type !== 'summary'),
);
const consensusPoints = computed(() => (qaState.value === 'empty' ? [] : store.consensus));
const divergencePoints = computed(() => (qaState.value === 'empty' ? [] : store.divergence));

/** 收尾总结只在终态面板里出现一次；transcript 已过滤 summary 行。 */
const showSummary = computed(
  () =>
    qaState.value !== 'empty' &&
    (store.status === 'finished' || store.status === 'failed'),
);

/**
 * store 的 `expertTurnCount` 只数专家 `turn.done`（不含主持开场 / 追问 / 总结），
 * 与 `run.finished.expert_turn_count` 同口径 —— 分母 20 才对得上（AC-1.13）。
 * `?state=empty` 时进度归零，配合 QA 截图。
 */
const expertTurnCount = computed(() =>
  qaState.value === 'empty' ? 0 : store.expertTurnCount,
);

/* ── 响应式状态 ──────────────────────────────────────────
 * 断点判断 100% 在 CSS：@media 改 .studio 自己的栅格，@container 改面板内部。
 * JS 绝不读视口 —— Playwright 的视口模拟下 MediaQueryList 的 change 事件不保证派发。
 * 这里只留两个纯 UI ref：当前标签、右栏抽屉开没开。 */
type TabKey = 'roster' | 'stage' | 'insights';
interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: readonly TabDef[] = [
  { key: 'roster', label: '阵容' },
  { key: 'stage', label: '现场' },
  { key: 'insights', label: '简报' },
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
  void store.cancel();
}

function exitStudio(): void {
  void router.push({ name: 'home' });
}

/** 失败态「重试」：重新 open（重放事件、重建五个面板），不靠剥 query 参数。 */
function retry(): void {
  if (Number.isFinite(numericId.value)) {
    void store.open(numericId.value);
  }
}

/** SummaryPanel 的失败重试：走后端 retry-summary（仅 ALL_SPEAKERS_FAILED）。 */
function retrySummary(): void {
  void store.retrySummary();
}

onMounted(() => {
  if (Number.isFinite(numericId.value)) {
    void store.open(numericId.value);
  }
});

/**
 * 直播跟随：新发言落进 store 后，如果观看者本来就在底部附近，就继续贴底。
 * 组件（TranscriptFeed）保持冻结，只在视图层操作它已有的滚动容器
 * `.app-panel__body`；用户主动往上翻阅读时（离开底部 >120px）不抢滚动条。
 */
const feedRef = ref<InstanceType<typeof TranscriptFeed> | null>(null);

async function followTranscript(): Promise<void> {
  const root = feedRef.value?.$el;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  const body = root.querySelector('.app-panel__body');
  if (!(body instanceof HTMLElement)) {
    return;
  }
  // watch 默认 flush:'pre'，此刻 DOM 还是追加前的旧高度 —— 用它判断
  // 「更新前是否贴在底部」，才是可靠的用户意图；拿更新后的高度判断会把
  // 大卡片（总结）误判成「用户往上翻了」。
  const distanceBefore = body.scrollHeight - body.scrollTop - body.clientHeight;
  await nextTick();
  if (distanceBefore < 160) {
    body.scrollTop = body.scrollHeight;
  }
}

watch(() => store.turns.length, () => void followTranscript());

onBeforeUnmount(() => {
  store.close();
});
</script>

<template>
  <div class="studio-shell">
    <div class="studio-frame">
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
          :guests="store.guests"
          :status-map="store.agentStatusMap"
        />

        <AppPanel
          v-if="stageFailure"
          class="studio__stage"
          :class="{ 'studio__stage--active': activeTab === 'stage' }"
          title="现场"
          scrollable
        >
          <AppEmpty
            class="studio__failed"
            :title="failureTitle"
            :hint="failureHint"
          >
            <AppButton variant="secondary" size="sm" @click="retry">重试</AppButton>
          </AppEmpty>
        </AppPanel>
        <div
          v-else
          class="studio__stage"
          :class="{ 'studio__stage--active': activeTab === 'stage' }"
        >
          <TranscriptFeed
            ref="feedRef"
            class="studio__feed"
            :turns="displayedTurns"
            :guests="store.guests"
          />
          <SummaryPanel
            v-if="showSummary"
            class="studio__summary"
            :state="store.summaryState"
            :text="store.summaryText"
            :can-retry="store.canRetrySummary"
            :retrying="store.retryingSummary"
            :error="store.retrySummaryError"
            @retry="retrySummary"
          />
        </div>

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
            :guests="store.guests"
            :status-map="store.agentStatusMap"
            :turns="displayedTurns"
            :expert-turns="expertTurnCount"
            :total-turns="EXPERT_TURN_CAP"
            :status-label="statusLabel"
          />
        </div>

        <div
          v-if="drawerOpen"
          class="drawer-scrim"
          aria-hidden="true"
          @click="closeDrawer"
        />

        <div class="studio__transport">
          <p class="transport__meta">
            {{ expertTurnCount }} / {{ EXPERT_TURN_CAP }} 条专家发言 · {{ statusLabel }}
          </p>
          <p v-if="store.cancelError !== null" class="transport__error" role="alert">
            {{ store.cancelError }}
          </p>
          <AppButton
            v-if="store.canWrite"
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
  </div>
</template>

<style scoped>
/* ── 壳：容器查询开在这里；页框在下一层 ─────────────────── */
.studio-shell {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  container-type: inline-size;
  background: var(--bg-canvas);
}

.studio-frame {
  height: 100%;
  width: 100%;
  max-width: var(--page-max);
  margin-inline: auto;
  padding-inline: var(--page-gutter);
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
  padding-block: var(--sp-4) var(--sp-3);
}

.studio > * {
  min-width: 0;
  min-height: 0;
}

.studio__header {
  grid-area: header;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-width: 0;
  min-height: var(--header-h);
  border-bottom: 1px solid var(--line-subtle);
}

.studio__header > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}

.studio__roster {
  grid-area: roster;
}

.studio__stage {
  grid-area: stage;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-height: 0;
}

/* 中栏内部：transcript 占满剩余高度，结束总结固定在底部（不挤压现场）。 */
.studio__feed {
  flex: 1 1 auto;
  min-height: 0;
}

.studio__summary {
  flex: none;
  max-height: 46%;
}

/* 右栏外壳：宽屏是普通栅格列；901–1200 变 fixed 抽屉 */
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
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transport__error {
  min-width: 0;
  margin: 0 0 0 auto;
  overflow: hidden;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--danger);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio__failed {
  height: 100%;
}

.studio__tabs {
  display: none;
  flex: none;
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
    padding: var(--sp-3);
    background: var(--bg-canvas);
    border-left: 1px solid var(--line-subtle);
  }

  .studio__insights--open {
    display: flex;
  }

  .drawer-scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--bg-canvas);
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
    gap: var(--sp-2);
  }

  .studio__header {
    flex-wrap: wrap;
    padding-bottom: var(--sp-2);
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
    padding: 0;
    border-left: 0;
    background: transparent;
  }

  .drawer-scrim {
    display: none;
  }

  .studio__tabs {
    display: flex;
    gap: var(--sp-2);
    width: 100%;
  }
}
</style>
