<script setup lang="ts">
/**
 * 翻页控件（BtPager）
 *
 * 上一页 / 页码 / 下一页；状态经 useReaderBinding 响应式桥更新。
 */
import type { Reader } from '@bibliotype/reader';
import { useReaderBinding } from '../use-reader.js';

const props = defineProps<{ reader: Reader }>();

const { currentPage, totalPages, pageNumberText, prev, next } = useReaderBinding(props.reader);
</script>

<template>
  <div class="bt-pager" role="group" aria-label="翻页">
    <button
      type="button"
      class="bt-pager__button"
      aria-label="上一页"
      :disabled="currentPage <= 0"
      @click="prev()"
    >
      上一页
    </button>
    <span class="bt-pager__status" aria-live="polite">{{ pageNumberText }} / 共 {{ totalPages }} 页</span>
    <button
      type="button"
      class="bt-pager__button"
      aria-label="下一页"
      :disabled="currentPage >= totalPages - 1"
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
