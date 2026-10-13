<script setup lang="ts">
/**
 * 编辑画布（BtEditor）
 *
 * - props.editor：BookEditor 实例（由使用方创建 / 管理生命周期）；
 * - props.tokens / options / fontToken：与 BtBookView 同源的主题令牌 / 布局 / 字体，
 *   用于让编辑态套用与阅读 / 导出「同一套书册样式」（所见即所得）；
 * - props.pagination / pageMainSize / measure：编辑态分页参考线（B3）——
 *   以与预览同源的 extractBlocks + paginate（同 measure / 同 pageMainSize）算出
 *   「块 → 页」归属，再按各页首块在真实 DOM 中的位置叠加分页线与页码；
 * - 默认插槽作用域透传 EditorBinding（供工具条访问命令与激活态）；
 * - 挂载时创建 EditorView，卸载时销毁；editor 实例替换时重建视图；
 * - 书册样式表以 `.bt-editor__canvas .ProseMirror` 为根容器注入（与 BtBookView
 *   的 buildBookCss 生成逻辑一致，节点 / 角色选择器限定在编辑画布内不外泄）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_THEME, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  buildRootStyle,
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  paginate,
  resolvePageMainSize,
  type LayoutOptions,
} from '@bibliotype/layout';
import { buildBookCss, declarationToCss } from '@bibliotype/layout/html';
import { extractBlocks, type BlockMeasureContext } from '@bibliotype/reader';
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
  /** 是否显示分页参考线（缺省 false：连续编辑，不叠加） */
  pagination?: boolean;
  /** 每页可用主轴尺寸（px）；缺省按 options.pageSize 与 page-margin 令牌推导 */
  pageMainSize?: number;
  /** 块度量估算上下文（与预览 Reader 传同一份，保证分页归属一致） */
  measure?: BlockMeasureContext;
}>();

const canvasRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
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

/* ---------- 分页参考线（B3：与预览同源的块 → 页归属，按真实 DOM 定位） ---------- */

interface PageBreak {
  /** 页码（自 1 起，展示用） */
  page: number;
  /** 分隔线定位样式（相对滚动内容坐标） */
  style: Record<string, string>;
}

const breaks = ref<PageBreak[]>([]);

/** CSS 选择器转义（happy-dom / 老浏览器无 CSS.escape 时降级） */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function recomputeBreaks(): void {
  if (props.pagination !== true) {
    breaks.value = [];
    return;
  }
  const canvas = canvasRef.value;
  if (canvas === null) return;
  const pm = canvas.querySelector<HTMLElement>('.ProseMirror');
  if (pm === null) return;

  const doc = props.editor.getDocument();
  const blocks = extractBlocks(doc, { context: props.measure });
  const mainSize =
    props.pageMainSize ?? resolvePageMainSize(resolvedOptions.value, resolvedTokens.value);
  if (mainSize <= 0 || blocks.length === 0) {
    breaks.value = [];
    return;
  }
  const result = paginate(blocks, { pageMainSize: mainSize });

  // 页面盒（.ProseMirror）相对滚动内容原点的位置（offsetParent = 滚动容器）
  const pageLeft = pm.offsetLeft;
  const pageTop = pm.offsetTop;
  const pageWidth = pm.offsetWidth;
  const pageHeight = pm.offsetHeight;
  const isVertical = vertical.value;

  const next: PageBreak[] = [];
  for (let i = 1; i < result.pages.length; i += 1) {
    const firstId = result.pages[i]?.blocks[0]?.id;
    if (firstId === undefined) continue;
    const el = pm.querySelector<HTMLElement>(`[data-bt-id="${cssEscape(firstId)}"]`);
    if (el === null) continue;
    let style: Record<string, string>;
    if (isVertical) {
      style = {
        top: `${pageTop}px`,
        height: `${pageHeight}px`,
        left: `${el.offsetLeft + el.offsetWidth}px`,
      };
    } else {
      style = { left: `${pageLeft}px`, width: `${pageWidth}px`, top: `${el.offsetTop}px` };
    }
    next.push({ page: i + 1, style });
  }
  breaks.value = next;
}

/** 事务 / 尺寸 / 令牌变化后的去抖重算（等 DOM 稳定再测） */
let recomputeTimer: ReturnType<typeof setTimeout> | undefined;
let recomputeRaf = 0;

function scheduleRecompute(): void {
  if (props.pagination !== true) {
    breaks.value = [];
    return;
  }
  if (recomputeTimer !== undefined) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = undefined;
    void nextTick(() => {
      if (recomputeRaf !== 0) cancelAnimationFrame(recomputeRaf);
      recomputeRaf = requestAnimationFrame(() => {
        recomputeRaf = 0;
        recomputeBreaks();
      });
    });
  }, 120);
}

let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  syncBookStyle();
  if (canvasRef.value !== null) {
    binding.attach(canvasRef.value);
  }
  scheduleRecompute();
  if (typeof ResizeObserver !== 'undefined' && scrollRef.value !== null) {
    resizeObserver = new ResizeObserver(scheduleRecompute);
    resizeObserver.observe(scrollRef.value);
  }
});

onBeforeUnmount(() => {
  binding.detach();
  removeBookStyle();
  resizeObserver?.disconnect();
  if (recomputeTimer !== undefined) clearTimeout(recomputeTimer);
  if (recomputeRaf !== 0) cancelAnimationFrame(recomputeRaf);
});

watch([resolvedTokens, resolvedOptions, () => props.fontToken], syncBookStyle);

watch(
  [() => props.pagination, () => props.pageMainSize, () => props.measure, vertical],
  scheduleRecompute,
);

// 每次编辑事务（版本自增）后重算分页线
watch(() => binding.version.value, scheduleRecompute);

// editor 实例替换（如切换文档后重建）时重新挂载视图
watch(
  () => props.editor,
  () => {
    if (canvasRef.value !== null) {
      binding.attach(canvasRef.value);
    }
    scheduleRecompute();
  },
);
</script>

<template>
  <div class="bt-editor">
    <div v-if="$slots.default" class="bt-editor__toolbar">
      <slot v-bind="binding" />
    </div>
    <div ref="scrollRef" class="bt-editor__scroll">
      <div
        ref="canvasRef"
        class="bt-editor__canvas"
        :class="vertical ? 'bt-editor__canvas--vertical' : 'bt-editor__canvas--horizontal'"
        :style="pageVars"
      />
      <div v-if="pagination" class="bt-editor__overlay" aria-hidden="true">
        <div
          v-for="item in breaks"
          :key="item.page"
          class="bt-editor__break"
          :class="vertical ? 'bt-editor__break--vertical' : 'bt-editor__break--horizontal'"
          :style="item.style"
        >
          <span class="bt-editor__break-label">第 {{ item.page }} 页</span>
        </div>
      </div>
    </div>
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

/* 滚动视口：填满舞台并作为分页参考线的定位上下文 */
.bt-editor__scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bt-editor-stage, transparent);
}

/* 画布：内容高度增长（滚动交给 .bt-editor__scroll） */
.bt-editor__canvas {
  width: 100%;
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

/* ---------- 分页参考线覆盖层 ---------- */

.bt-editor__overlay {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.bt-editor__break {
  position: absolute;
  color: var(--bt-accent, #8c5a2b);
}

.bt-editor__break--horizontal {
  height: 0;
  border-block-start: 1px dashed currentColor;
}

.bt-editor__break--vertical {
  width: 0;
  border-inline-start: 1px dashed currentColor;
}

.bt-editor__break-label {
  position: absolute;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.05em;
  white-space: nowrap;
  background: var(--bt-background, #fff);
  padding: 1px 4px;
}

.bt-editor__break--horizontal .bt-editor__break-label {
  top: -8px;
  left: 0;
}

.bt-editor__break--vertical .bt-editor__break-label {
  top: 0;
  left: 2px;
}
</style>
