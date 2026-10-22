<script setup lang="ts">
/**
 * 注文预览浮层（BtNotePreview）
 *
 * 纯展示：文本由 `useNoteInteraction` 解析好（IR 或 DOM 抽取），本组件只负责
 * 定位与外观。定位复用 `placeFloating`（锚点上方优先、越界翻转、水平夹紧），
 * 与选区替换菜单同一套口径，横排 / 直排共用。
 *
 * 触屏没有 hover：由组合式在点击注码后直接填充预览，锚点为被点的注码。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { placeFloating } from '../floating-position.js';
import type { NotePreviewState } from '../use-note-interaction.js';

const props = defineProps<{
  /** 预览状态（null = 不渲染） */
  preview: NotePreviewState | null;
}>();

const boxRef = ref<HTMLElement | null>(null);
const position = ref<{ top: string; left: string }>({ top: '0px', left: '0px' });

/** 依据锚点矩形与本浮层尺寸计算位置（布局不可用时贴锚点下方） */
function place(): void {
  const box = boxRef.value;
  const state = props.preview;
  if (box === null || state === null) return;
  if (typeof window === 'undefined') return;

  const rect = state.anchor.getBoundingClientRect();
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  // 软键盘弹出时 window.innerHeight 不变（iOS），用 visualViewport 取真实可视区（B1）
  const visual = window.visualViewport;
  const viewport = {
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
  };
  const placement = placeFloating(
    { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    { width, height },
    viewport,
  );
  position.value = { top: `${Math.round(placement.top)}px`, left: `${Math.round(placement.left)}px` };
}

/** 滚动 / 旋转 / 软键盘弹出时重新贴靠锚点（A5：浮动层不脱离目标、不越界） */
function onViewportChange(): void {
  if (props.preview === null) return;
  place();
}

onMounted(() => {
  if (typeof window === 'undefined') return;
  window.addEventListener('resize', onViewportChange);
  // 捕获阶段：阅读区内部滚动容器也要重定位
  window.addEventListener('scroll', onViewportChange, true);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
});

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return;
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
  window.visualViewport?.removeEventListener('resize', onViewportChange);
  window.visualViewport?.removeEventListener('scroll', onViewportChange);
});

watch(
  () => props.preview,
  async (value) => {
    if (value === null) return;
    await nextTick();
    place();
  },
  { immediate: true },
);
</script>

<template>
  <div
    v-if="preview"
    ref="boxRef"
    class="bt-note-preview"
    role="tooltip"
    data-note-preview
    :style="position"
  >
    <p class="bt-note-preview__text">{{ preview.text }}</p>
  </div>
</template>

<style scoped>
.bt-note-preview {
  position: fixed;
  z-index: 40;
  box-sizing: border-box;
  max-width: min(320px, 80vw);
  /* 窄屏 / 软键盘下卡片不超出视口：限高后内部滚动 */
  max-height: min(60vh, 320px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 10px;
  border: 1px solid rgba(127, 127, 127, 0.22);
  border-radius: 8px;
  background: var(--bt-color-background, #fff);
  color: var(--bt-color-note-text, #6b6b6b);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  /* 浮层不接收指针：从注码移出即由 pointerout 收起，避免进出抖动 */
  pointer-events: none;
  font-size: 13px;
  line-height: 1.6;
}

.bt-note-preview__text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
