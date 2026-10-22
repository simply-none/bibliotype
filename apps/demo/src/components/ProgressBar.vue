<script setup lang="ts">
/**
 * 阅读进度条（Demo 组件）
 *
 * 经 useReaderBinding 订阅 Reader 事件，展示页码与阅读进度；
 * 主题切换重建 Reader 时由父级 :key 重建本组件以重新绑定。
 * 尺寸一律用逻辑属性（track = block-size 粗细、fill = inline-size 进度）→ 容器被整块
 * 转置为 vertical-rl（直排时的左侧设置列）后，轨道与填充自动改沿垂直方向生长。
 *
 * 触摸跳页（H5 A6）：轨道可拖 / 可点，按指针在轨道上的比例换算目标页并 `goToPage`；
 * 轨道本身是 `slider` 角色，键盘 ←/→ 逐页（触控与键盘共用同一入口）。
 */
import { computed, ref } from 'vue';
import type { Reader } from '@bibliotype/reader';
import { useReaderBinding } from '@bibliotype/vue';

const props = defineProps<{ reader: Reader }>();

const { progress, currentPage, totalPages, pageNumberText } = useReaderBinding(props.reader);

/** 进度百分比（0~100 取整） */
const percent = computed(() => Math.round(progress.value * 100));

const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);

/**
 * 按指针横坐标跳页
 *
 * @param clientX 指针视口横坐标
 */
function seekTo(clientX: number): void {
  const el = trackRef.value;
  if (el === null || totalPages.value <= 1) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const page = Math.round(ratio * (totalPages.value - 1));
  if (page !== currentPage.value) props.reader.goToPage(page);
}

function onPointerDown(event: PointerEvent): void {
  const el = trackRef.value;
  if (el === null) return;
  dragging.value = true;
  el.setPointerCapture?.(event.pointerId);
  seekTo(event.clientX);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  seekTo(event.clientX);
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  trackRef.value?.releasePointerCapture?.(event.pointerId);
}

/** 键盘逐页（与 Pointer 共用 goToPage 入口） */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  props.reader.goToPage(Math.min(totalPages.value - 1, Math.max(0, currentPage.value + delta)));
}
</script>

<template>
  <div class="progress">
    <div
      ref="trackRef"
      class="progress__track"
      :class="{ 'progress__track--dragging': dragging }"
      role="slider"
      tabindex="0"
      aria-label="阅读进度"
      :aria-valuemin="1"
      :aria-valuemax="Math.max(1, totalPages)"
      :aria-valuenow="currentPage + 1"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @keydown="onKeydown"
    >
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
  position: relative;
  flex: 1;
  /* 横排 = 高 6px 的横条；转置后 block 轴变水平 → 自动成 6px 宽的竖条 */
  block-size: 6px;
  overflow: hidden;
  background: var(--demo-border, #e2ddd2);
  border-radius: 3px;
  cursor: pointer;
  /* 拖动跳页：屏蔽浏览器手势接管（A6） */
  touch-action: none;
  outline: none;
}

/* 触屏（D2）：视觉仍是 6px 细条，点击区上下各补到 44px */
@media (pointer: coarse) {
  .progress__track {
    block-size: 6px;
    padding-block: 19px;
    margin-block: -19px;
    background-clip: content-box;
  }
}

.progress__track--dragging {
  cursor: grabbing;
}

.progress__track:focus-visible {
  box-shadow: 0 0 0 2px rgba(140, 90, 43, 0.35);
}

.progress__fill {
  /* 进度沿 inline 轴（横排 = 宽度，直排 = 高度）推进 */
  inline-size: var(--bt-progress, 0%);
  block-size: 100%;
  background: var(--demo-accent, #8c5a2b);
  border-radius: 3px;
  transition: inline-size 0.2s ease;
}

.progress__track--dragging .progress__fill {
  transition: none;
}

.progress__text {
  flex: none;
  font-size: 12px;
  color: var(--demo-muted, #6b6b6b);
  white-space: nowrap;
}
</style>
