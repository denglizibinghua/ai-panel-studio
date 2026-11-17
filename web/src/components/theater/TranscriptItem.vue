<script setup lang="ts">
import { computed } from 'vue';
import AppBadge from '../common/AppBadge.vue';
import { expertColorStyle } from '../../styles/expert-colors';
import type { Guest, SpeechType, Turn } from '@ai-panel/shared';

/**
 * 一条发言（DESIGN §6.1 的 F6：姓名 + 职业 + 色块）。
 * 2px 左竖条 = 该嘉宾的专家色，是这一条发言的身份标识，全站同源于 expertColorStyle()。
 */
const props = defineProps<{ turn: Turn; guest: Guest | undefined }>();

const SPEECH_LABEL: Record<SpeechType, string> = {
  opening: '开场',
  challenge: '挑战',
  supplement: '补充',
  rebuttal: '反驳',
  question: '追问',
  summary: '总结',
};

const colorStyle = computed(() => expertColorStyle(props.guest?.color_id ?? ''));
const speechLabel = computed(() => SPEECH_LABEL[props.turn.speech_type]);
const speakerName = computed(() => props.guest?.name ?? `嘉宾 #${props.turn.guest_id}`);
const isSummary = computed(() => props.turn.speech_type === 'summary');
/** mock 的时间戳是 UTC ISO；展示到分钟，固定取 HH:mm，不引入时区换算。 */
const timeText = computed(() => props.turn.created_at.slice(11, 16));
</script>

<template>
  <article
    class="transcript-item"
    :class="{ 'transcript-item--summary': isSummary }"
    :style="colorStyle"
  >
    <div class="transcript-item__meta">
      <span class="transcript-item__name">{{ speakerName }}</span>
      <span v-if="guest" class="transcript-item__profession">{{ guest.profession }}</span>
      <AppBadge :tone="isSummary ? 'info' : 'neutral'">{{ speechLabel }}</AppBadge>
      <time class="transcript-item__time" :datetime="turn.created_at">{{ timeText }}</time>
    </div>

    <p class="transcript-item__content">{{ turn.content }}</p>
  </article>
</template>

<style scoped>
.transcript-item {
  min-width: 0;
  padding-left: var(--sp-3);
  border-left: 2px solid var(--expert-fg);
  container-type: inline-size;
}

/* 总结：抬高一层底 + 圆角，是全场唯一「更重」的发言 */
.transcript-item--summary {
  padding: var(--sp-3);
  background: var(--bg-raised);
  border-radius: var(--r-md);
}

.transcript-item__meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  margin-bottom: var(--sp-2);
}

.transcript-item__name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: var(--fw-medium);
  color: var(--fg-primary);
  white-space: nowrap;
}

.transcript-item__profession {
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transcript-item__time {
  flex: none;
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--fg-muted);
  white-space: nowrap;
}

.transcript-item__content {
  margin: 0;
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--fg-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-align: justify;
}

/* 舞台被压窄时元信息行换行（只改本组件后代） */
@container (max-width: 28rem) {
  .transcript-item__meta {
    flex-wrap: wrap;
    row-gap: var(--sp-1);
  }
}
</style>
