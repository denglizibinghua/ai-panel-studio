<script setup lang="ts">
import { computed, useId } from 'vue';

/**
 * 单行 / 多行文本输入（S7 新增基础件，docs/DESIGN.md §7.1 的补充）。
 *
 * 本 Session atoms.css 冻结，所以基础件的样式留在 SFC 里；
 * 颜色、间距、字号、圆角全部来自 tokens.css。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
    placeholder?: string;
    maxlength?: number;
    multiline?: boolean;
    id?: string;
  }>(),
  {
    label: '',
    placeholder: '',
    maxlength: undefined,
    multiline: false,
    id: '',
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const generatedId = useId();
const fieldId = computed(() => props.id || generatedId);

function onInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return;
  }
  emit('update:modelValue', target.value);
}
</script>

<template>
  <div class="app-input">
    <label v-if="label" class="app-input__label" :for="fieldId">{{ label }}</label>
    <textarea
      v-if="multiline"
      :id="fieldId"
      class="app-input__field app-input__field--multiline"
      :value="modelValue"
      :placeholder="placeholder"
      :maxlength="maxlength"
      @input="onInput"
    ></textarea>
    <input
      v-else
      :id="fieldId"
      class="app-input__field"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      :maxlength="maxlength"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.app-input {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.app-input__label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: var(--fw-medium);
  color: var(--fg-secondary);
}

.app-input__field {
  width: 100%;
  height: 36px;
  padding: 0 var(--sp-3);
  background: var(--bg-inset);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  color: var(--fg-primary);
  font-family: var(--font-ui);
  font-size: var(--fs-base);
  line-height: 1;
  transition: border-color var(--dur-fast) var(--ease);
}

.app-input__field::placeholder {
  color: var(--fg-muted);
}

.app-input__field:focus-visible {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.app-input__field--multiline {
  height: auto;
  min-height: 72px;
  padding: var(--sp-2) var(--sp-3);
  resize: none;
  line-height: var(--lh-base);
}
</style>
