<script setup lang="ts">
/**
 * 阅读进度条（Demo 组件）
 *
 * 经 useReaderBinding 订阅 Reader 事件，展示页码与阅读进度；
 * 主题切换重建 Reader 时由父级 :key 重建本组件以重新绑定。
 */
import { computed } from 'vue';
import type { Reader } from '@bibliotype/reader';
import { useReaderBinding } from '@bibliotype/vue';

const props = defineProps<{ reader: Reader }>();

const { progress, totalPages, pageNumberText } = useReaderBinding(props.reader);

/** 进度百分比（0~100 取整） */
const percent = computed(() => Math.round(progress.value * 100));
</script>

<template>
  <div class="progress">
    <div class="progress__track">
      <div class="progress__fill" :style="{ width: `${percent}%` }" />
    </div>
    <span class="progress__text">
      {{ pageNumberText }} / 共 {{ totalPages }} 页 · {{ percent }}%
    </span>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.progress__track {
  flex: 1;
  height: 6px;
  overflow: hidden;
  background: #e2ddd2;
  border-radius: 3px;
}

.progress__fill {
  height: 100%;
  background: #8c5a2b;
  border-radius: 3px;
  transition: width 0.2s ease;
}

.progress__text {
  flex: none;
  font-size: 12px;
  color: #6b6b6b;
  white-space: nowrap;
}
</style>
