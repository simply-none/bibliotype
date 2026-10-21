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
import { nextTick, ref, watch } from 'vue';
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
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const placement = placeFloating(
    { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    { width, height },
    viewport,
  );
  position.value = { top: `${Math.round(placement.top)}px`, left: `${Math.round(placement.left)}px` };
}

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
