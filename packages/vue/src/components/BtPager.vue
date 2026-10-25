<script setup lang="ts">
/**
 * 翻页控件（BtPager）
 *
 * 上一页 / 页码 / 下一页；状态经 useReaderBinding 响应式桥更新。
 * `step` 指定单次翻页步长（默认 1）：对页阅读传 2，一次跨一整对。
 */
import type { Reader } from '@bibliotype/reader';
import { useReaderBinding } from '../use-reader.js';

const props = withDefaults(defineProps<{ reader: Reader; step?: number }>(), { step: 1 });

const { currentPage, totalPages, pageNumberText, goToPage } = useReaderBinding(props.reader);

/** 步进 clamp：不足一步时落到首 / 末页，避免越界 */
function next(): boolean {
  return goToPage(Math.min(currentPage.value + props.step, totalPages.value - 1));
}

function prev(): boolean {
  return goToPage(Math.max(currentPage.value - props.step, 0));
}
</script>

<template>
  <div class="bt-pager" role="group" aria-label="翻页">
    <button
      type="button"
      class="bt-pager__button"
      aria-label="上一页"
      :disabled="currentPage < step"
      @click="prev()"
    >
      上一页
    </button>
    <span class="bt-pager__status" aria-live="polite">{{ pageNumberText }} / 共 {{ totalPages }} 页</span>
    <button
      type="button"
      class="bt-pager__button"
      aria-label="下一页"
      :disabled="currentPage + step >= totalPages"
      @click="next()"
    >
      下一页
    </button>
  </div>
</template>

<style scoped>
.bt-pager {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bt-pager__button {
  padding: 4px 14px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}

.bt-pager__button:disabled {
  opacity: 0.4;
  cursor: default;
}

.bt-pager__status {
  min-width: 96px;
  font-size: 13px;
  text-align: center;
  opacity: 0.85;
}
</style>
