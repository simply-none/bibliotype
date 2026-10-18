<script setup lang="ts">
/**
 * 阅读进度条（Demo 组件）
 *
 * 经 useReaderBinding 订阅 Reader 事件，展示页码与阅读进度；
 * 主题切换重建 Reader 时由父级 :key 重建本组件以重新绑定。
 * 尺寸一律用逻辑属性（track = block-size 粗细、fill = inline-size 进度）→ 容器被整块
 * 转置为 vertical-rl（直排时的左侧设置列）后，轨道与填充自动改沿垂直方向生长。
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
      <div class="progress__fill" :style="{ '--bt-progress': `${percent}%` }" />
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
  /* 横排 = 高 6px 的横条；转置后 block 轴变水平 → 自动成 6px 宽的竖条 */
  block-size: 6px;
  overflow: hidden;
  background: var(--demo-border, #e2ddd2);
  border-radius: 3px;
}

.progress__fill {
  /* 进度沿 inline 轴（横排 = 宽度，直排 = 高度）推进 */
  inline-size: var(--bt-progress, 0%);
  block-size: 100%;
  background: var(--demo-accent, #8c5a2b);
  border-radius: 3px;
  transition: inline-size 0.2s ease;
}

.progress__text {
  flex: none;
  font-size: 12px;
  color: var(--demo-muted, #6b6b6b);
  white-space: nowrap;
}
</style>
