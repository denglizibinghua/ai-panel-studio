<script setup lang="ts">
import AppButton from '../common/AppButton.vue';
import AppEmpty from '../common/AppEmpty.vue';
import AppPanel from '../common/AppPanel.vue';

/**
 * 结束总结面板（S9 / docs/DESIGN.md §9）。
 *
 * 三态都必须走既有基础件：成功用 `AppPanel` + 正文段落，loading / failed 用
 * `AppEmpty`（失败固定文案「总结生成失败，请查看完整记录」）。失败时只有
 * 「全部发言失败」这一种状态可以调 `retry-summary`，按钮显隐由父级
 * `canRetry` 决定；观察者不渲染按钮。
 */
type SummaryState = 'loading' | 'success' | 'failed';

const props = withDefaults(
  defineProps<{
    state: SummaryState;
    text?: string | null;
    canRetry?: boolean;
    retrying?: boolean;
    error?: string | null;
  }>(),
  {
    text: null,
    canRetry: false,
    retrying: false,
    error: null,
  },
);

const emit = defineEmits<{ retry: [] }>();

const STATE_LABEL: Record<SummaryState, string> = {
  loading: '生成中',
  success: '已定稿',
  failed: '失败',
};
</script>

<template>
  <AppPanel class="summary-panel" title="总结" scrollable>
    <template #actions>
      <span class="summary-panel__meta">{{ STATE_LABEL[props.state] }}</span>
    </template>

    <p v-if="props.state === 'success' && props.text" class="summary-panel__text">
      {{ props.text }}
    </p>

    <AppEmpty
      v-else-if="props.state === 'loading'"
      class="summary-panel__empty"
      title="正在生成总结"
      hint="讨论结束后，全场总结会出现在这里。"
    />

    <AppEmpty
      v-else
      class="summary-panel__empty"
      title="总结生成失败，请查看完整记录"
      :hint="props.error ?? (props.canRetry ? '可以重新生成一次总结。' : undefined)"
    >
      <AppButton
        v-if="props.canRetry"
        variant="secondary"
        size="sm"
        :loading="props.retrying"
        @click="emit('retry')"
      >
        重新生成总结
      </AppButton>
    </AppEmpty>
  </AppPanel>
</template>

<style scoped>
.summary-panel {
  flex: none;
}

.summary-panel__meta {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
}

.summary-panel__text {
  margin: 0;
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--fg-primary);
  overflow-wrap: anywhere;
}

.summary-panel__empty {
  padding-block: var(--sp-4);
}
</style>
