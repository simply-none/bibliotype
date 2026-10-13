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
 * - props.editable（缺省 true）：为 false 时画布只读（拒绝输入 / 粘贴 / 拖拽）；
 * - props.scale（缺省 1）：编辑态缩放，整页（含分页参考线）一起 transform 缩放，
 *   滚动区按缩放后尺寸预留版面（与 BtBookView 的 fit 缩放同口径）；
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
  /** 视图是否可编辑（缺省 true；false 时画布只读，拒绝用户输入） */
  editable?: boolean;
  /**
   * DOM 实测块尺寸映射（与预览 Reader 同源）
   *
   * 提供时分页参考线采用实测尺寸判定断页（与预览逐页一致）；
   * 缺省回退到按字符数估算（配 measure）。
   */
  blockSizes?: ReadonlyMap<string, number>;
  /** 编辑态缩放比例（缺省 1；限幅 0.2~2，整页含分页参考线一起缩放） */
  scale?: number;
}>();

const canvasRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
// 只读开关：以 ref 承载、经闭包透传给绑定，切换时无需重建视图（refresh 重求值）
const isEditable = ref(props.editable !== false);
const binding = useEditorBinding(props.editor, { isEditable: () => isEditable.value });

const resolvedTokens = computed<Readonly<Record<string, string | undefined>>>(
  () => props.tokens ?? DEFAULT_THEME,
);
const resolvedOptions = computed<LayoutOptions>(() => props.options ?? DEFAULT_LAYOUT_OPTIONS);
const vertical = computed(() => isVerticalMode(resolvedOptions.value.writingMode));

/* ---------- 编辑态缩放（整页 + 分页参考线一起 transform 缩放，滚动区预留缩放后尺寸） ---------- */

/** 缩放比例（限幅 0.2~2，非法回退 1） */
const resolvedScale = computed(() => {
  const raw = props.scale ?? 1;
  return Number.isFinite(raw) ? Math.min(2, Math.max(0.2, raw)) : 1;
});

/** 页面盒原生尺寸（未缩放，px）；初值取开本尺寸避免挂载前闪烁，挂载后由 .ProseMirror 实测覆盖 */
const nativeSize = ref({
  width: resolvedOptions.value.pageSize.width,
  height: resolvedOptions.value.pageSize.height,
});

/** 舞台（按缩放后尺寸预留版面，横向居中） */
const stageStyle = computed(() => ({
  width: `${nativeSize.value.width * resolvedScale.value}px`,
  height: `${nativeSize.value.height * resolvedScale.value}px`,
}));

/** 页盒（原生宽度 + transform 缩放，左上为原点；分页参考线在其内随同缩放） */
const pageZoomStyle = computed(() => ({
  width: `${nativeSize.value.width}px`,
  transform: `scale(${resolvedScale.value})`,
  transformOrigin: 'top left',
}));

/** 实测 .ProseMirror 原生尺寸（内容增删 / 字体变化经 ResizeObserver 自动更新） */
let pageObserver: ResizeObserver | undefined;
function measureNative(): void {
  const pm = binding.view.value?.dom;
  if (pm === undefined || pm === null) return;
  nativeSize.value = { width: pm.offsetWidth, height: pm.offsetHeight };
}

// 视图挂载 / 重建后接管其 DOM 尺寸监听
watch(
  () => binding.view.value,
  (next) => {
    pageObserver?.disconnect();
    pageObserver = undefined;
    if (typeof ResizeObserver !== 'undefined' && next !== null && next !== undefined) {
      pageObserver = new ResizeObserver(measureNative);
      pageObserver.observe(next.dom);
    }
    measureNative();
  },
  { immediate: true },
);

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

/* ---------- 分页纸张效果（B3：与预览同源的块 → 页归属，按真实 DOM 定位） ---------- */

interface PageSheet {
  /** 页码（自 1 起，展示用） */
  page: number;
  /** 纸张面板定位样式（相对页盒坐标，随缩放层一起 transform） */
  style: Record<string, string>;
}

const sheets = ref<PageSheet[]>([]);

/** 页间缝隙（px，原生坐标）：上下/左右各缩进一半，露出台面底色形成分页感 */
const SHEET_GAP = 28;

/** CSS 选择器转义（happy-dom / 老浏览器无 CSS.escape 时降级） */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function recomputeSheets(): void {
  if (props.pagination !== true) {
    sheets.value = [];
    return;
  }
  const canvas = canvasRef.value;
  if (canvas === null) return;
  const pm = canvas.querySelector<HTMLElement>('.ProseMirror');
  if (pm === null) return;

  const doc = props.editor.getDocument();
  const blocks = extractBlocks(doc, { context: props.measure, blockSizes: props.blockSizes });
  const mainSize =
    props.pageMainSize ?? resolvePageMainSize(resolvedOptions.value, resolvedTokens.value);
  if (mainSize <= 0 || blocks.length === 0) {
    sheets.value = [];
    return;
  }
  const result = paginate(blocks, { pageMainSize: mainSize });

  // 页面盒（.ProseMirror）相对定位原点（offsetParent = .bt-editor__page，与纸张同源）
  const pageLeft = pm.offsetLeft;
  const pageTop = pm.offsetTop;
  const pageWidth = pm.offsetWidth;
  const pageHeight = pm.offsetHeight;
  const isVertical = vertical.value;
  // 主轴起点 / 交叉轴原点；首页从页盒起点开始（含页边距），末页到页盒末尾
  const origin = isVertical ? pageLeft : pageTop;
  const contentEnd = isVertical ? pageLeft + pageWidth : pageTop + pageHeight;

  const starts: number[] = [];
  for (const [i, page] of result.pages.entries()) {
    const firstId = page.blocks[0]?.id;
    const el =
      i === 0 || firstId === undefined
        ? null
        : pm.querySelector<HTMLElement>(`[data-bt-id="${cssEscape(firstId)}"]`);
    starts.push(el !== null ? (isVertical ? el.offsetLeft : el.offsetTop) : origin);
  }

  const half = SHEET_GAP / 2;
  const next: PageSheet[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i] as number;
    const end = i + 1 < starts.length ? (starts[i + 1] as number) : contentEnd;
    const mainLen = Math.max(0, end - start - SHEET_GAP);
    const mainPos = start + half;
    const style = isVertical
      ? {
          top: `${pageTop}px`,
          height: `${pageHeight}px`,
          left: `${mainPos}px`,
          width: `${mainLen}px`,
        }
      : {
          left: `${pageLeft}px`,
          width: `${pageWidth}px`,
          top: `${mainPos}px`,
          height: `${mainLen}px`,
        };
    next.push({ page: i + 1, style });
  }
  sheets.value = next;
}

/** 事务 / 尺寸 / 令牌变化后的去抖重算（等 DOM 稳定再测） */
let recomputeTimer: ReturnType<typeof setTimeout> | undefined;
let recomputeRaf = 0;

function scheduleRecompute(): void {
  if (props.pagination !== true) {
    sheets.value = [];
    return;
  }
  if (recomputeTimer !== undefined) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = undefined;
    void nextTick(() => {
      if (recomputeRaf !== 0) cancelAnimationFrame(recomputeRaf);
      recomputeRaf = requestAnimationFrame(() => {
        recomputeRaf = 0;
        recomputeSheets();
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
  pageObserver?.disconnect();
  if (recomputeTimer !== undefined) clearTimeout(recomputeTimer);
  if (recomputeRaf !== 0) cancelAnimationFrame(recomputeRaf);
});

watch([resolvedTokens, resolvedOptions, () => props.fontToken], syncBookStyle);

// 可编辑性切换：同步 ref 并刷新视图（让 EditorView 重新求值 editable 闭包）
watch(
  () => props.editable,
  (value) => {
    isEditable.value = value !== false;
    binding.refresh();
  },
);

watch(
  [() => props.pagination, () => props.pageMainSize, () => props.measure, () => props.blockSizes, vertical],
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
      <div class="bt-editor__stage" :style="stageStyle">
        <div class="bt-editor__page" :style="pageZoomStyle">
          <div
            ref="canvasRef"
            class="bt-editor__canvas"
            :class="[
              vertical ? 'bt-editor__canvas--vertical' : 'bt-editor__canvas--horizontal',
              isEditable ? '' : 'bt-editor__canvas--readonly',
              pagination ? 'bt-editor__canvas--paged' : '',
            ]"
            :style="pageVars"
          />
          <div v-if="pagination" class="bt-editor__overlay" aria-hidden="true">
            <div
              v-for="item in sheets"
              :key="item.page"
              class="bt-editor__sheet"
              :style="item.style"
            >
              <span class="bt-editor__sheet-label">第 {{ item.page }} 页</span>
            </div>
          </div>
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

/* 滚动视口：填满舞台并作为分页纸张的定位上下文；底色即「台面」，页间缝隙露出此色 */
.bt-editor__scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bt-editor-stage, #dcd6c9);
}

/* 舞台：按缩放后尺寸占位（横向居中），作为页盒的定位上下文 */
.bt-editor__stage {
  position: relative;
  margin-inline: auto;
}

/* 页盒：原生尺寸定位 + transform 缩放（左上原点）；内部 canvas 与参考线同处缩放层 */
.bt-editor__page {
  position: absolute;
  top: 0;
  left: 0;
}

/* 画布：内容高度增长（滚动交给 .bt-editor__scroll）；置于纸张之上 */
.bt-editor__canvas {
  position: relative;
  z-index: 1;
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

/* 分页态：正文底色改由下层 .bt-editor__sheet 提供，这里透明以露出页间缝隙 */
.bt-editor__canvas--paged :deep(.ProseMirror) {
  background-color: transparent;
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

/* 只读：取消文本光标暗示（contenteditable=false 已由视图保证不可输入） */
.bt-editor__canvas--readonly :deep(.ProseMirror) {
  cursor: default;
}

/* ---------- 分页纸张覆盖层（位于正文之下，z-index 0） ---------- */

.bt-editor__overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  pointer-events: none;
}

/* 单页纸张：纸色 + 阴影，页间留缝露出台面底色 */
.bt-editor__sheet {
  position: absolute;
  box-sizing: border-box;
  background: var(--bt-background, #faf8f4);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.16),
    0 6px 18px rgba(0, 0, 0, 0.12);
}

.bt-editor__sheet-label {
  position: absolute;
  top: -18px;
  left: 0;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.05em;
  white-space: nowrap;
  color: var(--bt-accent, #8c5a2b);
}
</style>
