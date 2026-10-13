<script setup lang="ts">
/**
 * 编辑画布（BtEditor）
 *
 * - props.editor：BookEditor 实例（由使用方创建 / 管理生命周期）；
 * - props.tokens / options / fontToken：与 BtBookView 同源的主题令牌 / 布局 / 字体，
 *   用于让编辑态套用与阅读 / 导出「同一套书册样式」（所见即所得）；
 * - 默认插槽作用域透传 EditorBinding（供工具条访问命令与激活态）；
 * - 挂载时创建 EditorView，卸载时销毁；editor 实例替换时重建视图；
 * - 书册样式表以 `.bt-editor__canvas .ProseMirror` 为根容器注入（与 BtBookView
 *   的 buildBookCss 生成逻辑一致，节点 / 角色选择器限定在编辑画布内不外泄）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_THEME, LAYOUT_TOKENS } from '@bibliotype/core';
import { buildRootStyle, DEFAULT_LAYOUT_OPTIONS, isVerticalMode, type LayoutOptions } from '@bibliotype/layout';
import { buildBookCss, declarationToCss } from '@bibliotype/layout/html';
import type { BookEditor } from '@bibliotype/editor';
import { useEditorBinding } from '../use-editor.js';
import 'prosemirror-view/style/prosemirror.css';

const props = defineProps<{
  editor: BookEditor;
  /** 主题令牌值表（缺省 DEFAULT_THEME，与 BtBookView 传同一份以对齐样式） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 布局选项（书写方向 / 页面尺寸 / 分栏，缺省 DEFAULT_LAYOUT_OPTIONS） */
  options?: LayoutOptions;
  /** 正文字体族令牌键（古籍可传 FONT_TOKENS.CLASSICAL_BODY） */
  fontToken?: string;
}>();

const canvasRef = ref<HTMLElement | null>(null);
const binding = useEditorBinding(props.editor);

const resolvedTokens = computed<Readonly<Record<string, string | undefined>>>(
  () => props.tokens ?? DEFAULT_THEME,
);
const resolvedOptions = computed<LayoutOptions>(() => props.options ?? DEFAULT_LAYOUT_OPTIONS);
const vertical = computed(() => isVerticalMode(resolvedOptions.value.writingMode));

/* ---------- 书页尺寸盒（画布内 .ProseMirror 作为「一页」） ---------- */

/** 页面几何 CSS 变量（供 scoped 样式驱动 .ProseMirror 的宽 / 高 / 页边距） */
const pageVars = computed<Record<string, string>>(() => {
  const { pageSize } = resolvedOptions.value;
  return {
    '--bt-page-w': `${pageSize.width}px`,
    '--bt-page-h': `${pageSize.height}px`,
    '--bt-page-padding': resolvedTokens.value[LAYOUT_TOKENS.PAGE_MARGIN] ?? '48px 56px',
  };
});

/* ---------- 书册样式表注入（与 BtBookView 同源） ---------- */

const STYLE_ELEMENT_ID = 'bt-editor-book-css';
const CONTAINER_SELECTOR = '.bt-editor__canvas .ProseMirror';

function syncBookStyle(): void {
  if (typeof document === 'undefined') return;
  const tokens = resolvedTokens.value;
  const options = resolvedOptions.value;
  // 节点 / 角色样式（buildBookCss）+ 根容器排版（buildRootStyle：字体 / 缩进 / 版框）
  const rootRule = `${CONTAINER_SELECTOR} {\n${declarationToCss(
    buildRootStyle({ tokens, options, fontToken: props.fontToken }),
  )}\n}`;
  const css =
    buildBookCss({
      tokens,
      options,
      fontToken: props.fontToken,
      containerSelector: CONTAINER_SELECTOR,
    }) + `\n${rootRule}\n`;
  let element = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (element === null) {
    element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    document.head.appendChild(element);
  }
  if (element.textContent !== css) {
    element.textContent = css;
  }
}

function removeBookStyle(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
}

onMounted(() => {
  syncBookStyle();
  if (canvasRef.value !== null) {
    binding.attach(canvasRef.value);
  }
});

onBeforeUnmount(() => {
  binding.detach();
  removeBookStyle();
});

watch([resolvedTokens, resolvedOptions, () => props.fontToken], syncBookStyle);

// editor 实例替换（如切换文档后重建）时重新挂载视图
watch(
  () => props.editor,
  () => {
    if (canvasRef.value !== null) {
      binding.attach(canvasRef.value);
    }
  },
);
</script>

<template>
  <div class="bt-editor">
    <div v-if="$slots.default" class="bt-editor__toolbar">
      <slot v-bind="binding" />
    </div>
    <div
      ref="canvasRef"
      class="bt-editor__canvas"
      :class="vertical ? 'bt-editor__canvas--vertical' : 'bt-editor__canvas--horizontal'"
      :style="pageVars"
    />
  </div>
</template>

<style scoped>
.bt-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.bt-editor__toolbar {
  flex: none;
}

/* 滚动视口：填满舞台，页面盒（.ProseMirror）超出时滚动 */
.bt-editor__canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bt-editor-stage, transparent);
}

/* 页面盒：与阅读页同尺寸 / 同页边距；字体、颜色、书写方向、版框由注入的书册样式表驱动 */
.bt-editor__canvas :deep(.ProseMirror) {
  box-sizing: border-box;
  padding: var(--bt-page-padding);
  outline: none;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* 横排：固定页宽（行宽与阅读页一致），高度随内容增长、至少一页 */
.bt-editor__canvas--horizontal :deep(.ProseMirror) {
  width: var(--bt-page-w);
  min-height: var(--bt-page-h);
  margin-inline: auto;
}

/* 直排：固定页高（列长与阅读页一致），宽度随分栏增长、至少一页 */
.bt-editor__canvas--vertical :deep(.ProseMirror) {
  height: var(--bt-page-h);
  min-width: var(--bt-page-w);
}
</style>
