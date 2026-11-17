<script setup lang="ts">
import { computed } from 'vue';
import AppButton from './AppButton.vue';

/**
 * 数值步进器（S7 新增基础件）。
 * 只会发出 [min, max] 区间内的值，越界时按钮禁用且逻辑二次兜底。
 */
const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    label?: string;
  }>(),
  {
    min: 1,
    max: 8,
    label: '',
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

const canDecrease = computed(() => props.modelValue > props.min);
const canIncrease = computed(() => props.modelValue < props.max);

function decrease(): void {
  if (canDecrease.value) {
    emit('update:modelValue', props.modelValue - 1);
  }
}

function increase(): void {
  if (canIncrease.value) {
    emit('update:modelValue', props.modelValue + 1);
  }
}
</script>

<template>
  <div class="app-stepper">
    <span v-if="label" class="app-stepper__label">{{ label }}</span>
    <div class="app-stepper__controls">
      <AppButton
        size="sm"
        variant="secondary"
        aria-label="减少"
        :disabled="!canDecrease"
        @click="decrease"
      >
        −
      </AppButton>
      <span class="app-stepper__value" aria-live="polite">{{ modelValue }}</span>
      <AppButton
        size="sm"
        variant="secondary"
        aria-label="增加"
        :disabled="!canIncrease"
        @click="increase"
      >
        +
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.app-stepper {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.app-stepper__label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: var(--fw-medium);
  color: var(--fg-secondary);
}

.app-stepper__controls {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.app-stepper__value {
  min-width: 3ch;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
}
</style>
