<script setup lang="ts">
import { computed, ref } from 'vue';
import AppCard from '../common/AppCard.vue';
import AppButton from '../common/AppButton.vue';
import AppInput from '../common/AppInput.vue';
import AppStepper from '../common/AppStepper.vue';

/**
 * 首页内联新建表单（docs/SESSION_MAP.md §S7）。
 * 纯壳：不请求后端，submit 只把 { topic, expertCount } 抛给父级。
 */
const props = withDefaults(
  defineProps<{
    initialTopic?: string;
    generating?: boolean;
  }>(),
  {
    initialTopic: '',
    generating: false,
  },
);

const emit = defineEmits<{
  submit: [payload: { topic: string; expertCount: number }];
  cancel: [];
}>();

const MAX_TOPIC_LENGTH = 200;

const topic = ref(props.initialTopic.slice(0, MAX_TOPIC_LENGTH));
const expertCount = ref(4);

const canSubmit = computed(() => topic.value.trim().length > 0);

function updateTopic(value: string): void {
  topic.value = value.slice(0, MAX_TOPIC_LENGTH);
}

function submit(): void {
  if (!canSubmit.value) {
    return;
  }
  emit('submit', { topic: topic.value.trim(), expertCount: expertCount.value });
}

function cancel(): void {
  emit('cancel');
}
</script>

<template>
  <AppCard padded class="new-discussion">
    <form v-if="!generating" class="new-discussion__form" @submit.prevent="submit">
      <h2 class="new-discussion__title">发起新讨论</h2>

      <div class="new-discussion__field">
        <AppInput
          :model-value="topic"
          label="议题"
          placeholder="输入一个值得争论的议题，最多 200 字"
          :maxlength="MAX_TOPIC_LENGTH"
          multiline
          @update:model-value="updateTopic"
        />
        <span class="new-discussion__counter">{{ topic.length }} / {{ MAX_TOPIC_LENGTH }}</span>
      </div>

      <div class="new-discussion__controls">
        <AppStepper v-model="expertCount" label="专家人数" :min="1" :max="8" />
        <div class="new-discussion__actions">
          <AppButton variant="ghost" @click="cancel">取消</AppButton>
          <AppButton variant="primary" type="submit" :disabled="!canSubmit">生成嘉宾</AppButton>
        </div>
      </div>
    </form>

    <div v-else class="new-discussion__generating">
      <p class="new-discussion__status">正在生成嘉宾阵容，席位分配完成后即可确认。</p>
      <AppCard
        v-for="seat in 3"
        :key="seat"
        raised
        padded
        class="new-discussion__skeleton"
      />
      <div class="new-discussion__actions">
        <AppButton variant="ghost" @click="cancel">取消</AppButton>
      </div>
    </div>
  </AppCard>
</template>

<style scoped>
.new-discussion {
  min-width: 0;
}

.new-discussion__form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  min-width: 0;
}

.new-discussion__title {
  margin: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
}

.new-discussion__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.new-discussion__counter {
  align-self: flex-end;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
}

.new-discussion__controls {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-4);
  flex-wrap: wrap;
}

.new-discussion__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-left: auto;
}

.new-discussion__generating {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
}

.new-discussion__status {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--fg-secondary);
}

.new-discussion__skeleton {
  height: 64px;
  animation: new-discussion-breath var(--dur-breath) var(--ease) infinite;
}

/* 循环动画本身；prefers-reduced-motion 由 tokens.css 的全局规则统一停掉 */
@keyframes new-discussion-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
</style>
