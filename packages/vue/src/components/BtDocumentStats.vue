<script setup lang="ts">
/**
 * 文档统计状态栏（纯展示）
 *
 * 数据来自 `useDocumentStats` 的 `stats`（`countDocumentStats` 的纯函数结果）。
 * 章节分布用纯 CSS 条形表示，不引入图表库；点击章节条目 emit `select-structure`，
 * 由宿主用 TOC 同款 `goToNode` 定位。
 */
import { computed } from 'vue';
import type { DocumentStats } from '@bibliotype/core';

const props = defineProps<{
  /** 统计结果（countDocumentStats 输出） */
  stats: DocumentStats;
  /** 紧凑模式（仅显示字数 / 块数 / 时长） */
  compact?: boolean;
  /** 章节分布是否可点击 */
  selectable?: boolean;
}>();

const emit = defineEmits<{
  (event: 'select-structure', nodeId: string): void;
}>();

/** 章节字数占比的最大值（用于条形宽度归一） */
const maxCharacters = computed(() =>
  Math.max(1, ...props.stats.structures.map((item) => item.characters)),
);

function barWidth(characters: number): string {
  return `${Math.round((characters / maxCharacters.value) * 100)}%`;
}

function onSelect(nodeId: string | undefined): void {
  if (props.selectable === true && nodeId !== undefined) {
    emit('select-structure', nodeId);
  }
}
</script>

<template>
  <section class="bt-doc-stats" :class="{ 'bt-doc-stats--compact': compact }">
    <ul class="bt-doc-stats__metrics">
      <li class="bt-doc-stats__metric">
        <span class="bt-doc-stats__value">{{ stats.characters }}</span>
        <span class="bt-doc-stats__label">字</span>
      </li>
      <li class="bt-doc-stats__metric">
        <span class="bt-doc-stats__value">{{ stats.blocks }}</span>
        <span class="bt-doc-stats__label">块</span>
      </li>
      <li class="bt-doc-stats__metric">
        <span class="bt-doc-stats__value">{{ stats.readingMinutes }}</span>
        <span class="bt-doc-stats__label">分钟</span>
      </li>
      <li v-if="!compact" class="bt-doc-stats__metric">
        <span class="bt-doc-stats__value">{{ stats.notes.footnote + stats.notes.endnote + stats.notes.marginNote }}</span>
        <span class="bt-doc-stats__label">注</span>
      </li>
    </ul>

    <ul v-if="!compact && stats.structures.length > 0" class="bt-doc-stats__structures">
      <li v-for="item in stats.structures" :key="`${item.type}-${item.nodeId ?? item.title}`" class="bt-doc-stats__structure">
        <button
          type="button"
          class="bt-doc-stats__structure-title"
          :disabled="selectable !== true"
          @click="onSelect(item.nodeId)"
        >
          {{ item.title }}
        </button>
        <span class="bt-doc-stats__bar" :style="{ width: barWidth(item.characters) }"></span>
        <span class="bt-doc-stats__structure-count">{{ item.characters }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.bt-doc-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}
.bt-doc-stats__metrics {
  display: flex;
  gap: 16px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.bt-doc-stats__metric {
  display: flex;
  align-items: baseline;
  gap: 2px;
}
.bt-doc-stats__value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.bt-doc-stats__label {
  opacity: 0.6;
}
.bt-doc-stats__structures {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bt-doc-stats__structure {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bt-doc-stats__structure-title {
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.bt-doc-stats__structure-title:disabled {
  cursor: default;
}
.bt-doc-stats__bar {
  height: 8px;
  background: currentColor;
  opacity: 0.25;
  border-radius: 2px;
  min-width: 2px;
}
.bt-doc-stats__structure-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
</style>
