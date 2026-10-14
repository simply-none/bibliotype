<script setup lang="ts">
/**
 * 编辑画布（BtEditor）
 *
 * - props.editor：BookEditor 实例（由使用方创建 / 管理生命周期）；
 * - props.tokens / options / fontToken：与 BtBookView 同源的主题令牌 / 布局 / 字体，
 *   让编辑态套用与阅读 / 导出「同一套书册样式」（所见即所得）；
 * - props.pagination（缺省 false）+ paginationMode（缺省 'paged'）：编辑态分页——
 *   'paged' 走自定义可编辑分页引擎（usePagedLayout 内核 + PagedCanvas 真实书页盒，
 *   行级跨页续排、缝隙处结构上无字、编辑经 selection-bridge 落 BookEditor 事务）；
 *   内核不可用（直排 / 多栏 / 无量尺）或显式 'overlay' 时回退连续画布（不叠纸张）；
 * - props.editable（缺省 true）：为 false 时画布只读（拒绝输入 / 粘贴 / 拖拽）；
 * - props.scale（缺省 1）：连续画布缩放（paged 模式由 PagedCanvas 自适应宽度）；
 * - 默认插槽作用域透传 EditorBinding（供工具条访问命令与激活态）；
 * - 挂载时创建 EditorView，卸载时销毁；editor 实例替换时重建视图；
 * - 书册样式表以 `.bt-editor__canvas .ProseMirror` 为根容器注入（与 BtBookView
 *   的 buildBookCss 生成逻辑一致，节点 / 角色选择器限定在编辑画布内不外泄）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_THEME, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  buildRootStyle,
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  type LayoutOptions,
} from '@bibliotype/layout';
import { buildBookCss, declarationToCss } from '@bibliotype/layout/html';
import type { BlockMeasureContext } from '@bibliotype/reader';
import type { BookEditor } from '@bibliotype/editor';
import { useEditorBinding } from '../use-editor.js';
import PagedCanvas from '../paged-editor/PagedCanvas.vue';
import { usePagedLayout } from '../paged-editor/use-paged-layout.js';
import 'prosemirror-view/style/prosemirror.css';

const props = defineProps<{
  editor: BookEditor;
  /** 主题令牌值表（缺省 DEFAULT_THEME，与 BtBookView 传同一份以对齐样式） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 布局选项（书写方向 / 页面尺寸 / 分栏，缺省 DEFAULT_LAYOUT_OPTIONS） */
  options?: LayoutOptions;
  /** 正文字体族令牌键（古籍可传 FONT_TOKENS.CLASSICAL_BODY） */
  fontToken?: string;
  /** 是否分页（缺省 false：连续编辑，不分页） */
  pagination?: boolean;
  /**
   * 分页渲染模式（缺省 'paged'：自定义可编辑分页引擎）
   *
   * 'overlay' 为历史值，现回退为连续画布（旧「叠层纸张 + 注入 margin」因逐页漂移
   * 无法根治已废弃）；paged 内核不可用（直排 / 多栏 / 无 DOM 量尺）时同样回退连续画布。
   */
  paginationMode?: 'overlay' | 'paged';
  /** 每页可用主轴尺寸（px）；缺省按 options.pageSize 与 page-margin 令牌推导 */
  pageMainSize?: number;
  /** 块度量估算上下文（横排下作缺 DOM 实测时的回退估算口径） */
  measure?: BlockMeasureContext;
  /** 视图是否可编辑（缺省 true；false 时画布只读，拒绝用户输入） */
  editable?: boolean;
  /**
   * 外部实测块尺寸映射（块 id → 主轴尺寸 px）
   *
   * 已废弃：paged 内核自带同源 DOM 量尺（measurePagination），不再消费此映射；
   * 保留签名仅为兼容既有调用方。
   */
  blockSizes?: ReadonlyMap<string, number>;
  /** 连续画布缩放比例（缺省 1；限幅 0.2~2；paged 模式忽略，按容器宽自适应） */
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

/* ---------- 自定义可编辑分页引擎（paged 模式） ---------- */

const fontTokenRef = computed(() => props.fontToken);
const measureRef = computed(() => props.measure);
const pageMainSizeRef = computed(() => props.pageMainSize);

const paged = usePagedLayout({
  editor: props.editor,
  options: resolvedOptions,
  tokens: resolvedTokens,
  fontToken: fontTokenRef,
  measure: measureRef,
  pageMainSize: pageMainSizeRef,
  version: binding.version,
});

/**
 * paged 生效：开启分页 + 未显式要求连续（paginationMode !== 'overlay'）+ 内核可用。
 *
 * 缺省（paginationMode 未给）即尝试 paged（翻默认）；直排 / 多栏等 usable=false 时
 * 自动回退连续画布，不劣化。
 */
const pagedActive = computed(
  () => props.pagination === true && props.paginationMode !== 'overlay' && paged.usable.value,
);

/**
 * paged 编辑事件桥（方案 S）：PagedCanvas 已把输入经 selection-bridge 落成
 * BookEditor 事务（editor.dispatch），此处补齐视图同步与重排：
 * - edited：refresh（同步隐藏 PM 视图 + version++）→ 携块 id 提示走增量重排；
 * - sync：选区落模后仅 refresh（纯选区不改 doc，重排守卫自动跳过）；
 * - history：撤销 / 重做走 PM 插件栈（binding.undo/redo），随后 version 驱动重排。
 */
function onPagedEdited(blockId: string): void {
  binding.refresh();
  paged.scheduleRelayout(blockId);
}

function onPagedSync(): void {
  binding.refresh();
}

function onPagedHistory(dir: 'undo' | 'redo'): void {
  if (dir === 'undo') binding.undo();
  else binding.redo();
}

/* ---------- 连续画布缩放（paged 不可用 / 未分页时；paged 模式由 PagedCanvas 自适应） ---------- */

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

/** 页盒（原生宽度 + transform 缩放，左上为原点） */
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

/* ---------- 书页尺寸盒（连续画布内 .ProseMirror 作为「一页」） ---------- */

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

/**
 * 字体加载完成后重排分页。
 *
 * 挂载首帧往往用回退字体量尺；古籍正文字体（异步 webfont）到位后行高与换行位置
 * 整体变化，需重跑 measurePagination。paged 模式下重排由 usePagedLayout 负责。
 */
function onFontsSettled(): void {
  paged.scheduleRelayout();
}

function watchFontLoad(): void {
  if (typeof document === 'undefined') return;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts !== undefined) {
    if (fonts.status === 'loaded') return;
    void fonts.ready.then(onFontsSettled).catch(() => undefined);
    fonts.addEventListener?.('loadingdone', onFontsSettled);
    fonts.addEventListener?.('loadingerror', onFontsSettled);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', onFontsSettled, { once: true });
  }
}

onMounted(() => {
  syncBookStyle();
  if (canvasRef.value !== null) {
    binding.attach(canvasRef.value);
  }
  paged.scheduleRelayout();
  watchFontLoad();
});

onBeforeUnmount(() => {
  binding.detach();
  removeBookStyle();
  pageObserver?.disconnect();
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

// editor 实例替换（如切换文档后重建）时重新挂载视图并重排
watch(
  () => props.editor,
  () => {
    if (canvasRef.value !== null) {
      binding.attach(canvasRef.value);
    }
    paged.scheduleRelayout();
  },
);

// 分页模式 / 每页尺寸 / 度量变化时重排，确保 pages 及时就绪
watch([() => props.paginationMode, () => props.pageMainSize, () => props.measure], () =>
  paged.scheduleRelayout(),
);
</script>

<template>
  <div class="bt-editor">
    <div v-if="$slots.default" class="bt-editor__toolbar">
      <slot v-bind="binding" />
    </div>
    <div ref="scrollRef" class="bt-editor__scroll">
      <PagedCanvas
        v-if="pagedActive"
        class="bt-editor__paged"
        :pages="paged.pages.value"
        :options="resolvedOptions"
        :tokens="resolvedTokens"
        :font-token="props.fontToken"
        :editable="isEditable"
        :editor="props.editor"
        :index="paged.pagedIndex.value"
        :chars-per-line="paged.charsPerLine.value"
        @edited="onPagedEdited"
        @sync="onPagedSync"
        @history="onPagedHistory"
      />
      <div v-show="!pagedActive" class="bt-editor__stage" :style="stageStyle">
        <div class="bt-editor__page" :style="pageZoomStyle">
          <div
            ref="canvasRef"
            class="bt-editor__canvas"
            :class="[
              vertical ? 'bt-editor__canvas--vertical' : 'bt-editor__canvas--horizontal',
              isEditable ? '' : 'bt-editor__canvas--readonly',
            ]"
            :style="pageVars"
          />
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

/* 滚动视口：填满舞台；底色即「台面」 */
.bt-editor__scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bt-editor-stage, #dcd6c9);
}

/* paged 模式：自定义分页外壳填满滚动区（PM 画布仍在 DOM 内，v-show 隐藏供编辑接管） */
.bt-editor__paged {
  position: absolute;
  inset: 0;
}

/* 舞台：连续画布按缩放后尺寸占位（横向居中），作为页盒的定位上下文 */
.bt-editor__stage {
  position: relative;
  margin-inline: auto;
}

/* 页盒：原生尺寸定位 + transform 缩放（左上原点） */
.bt-editor__page {
  position: absolute;
  top: 0;
  left: 0;
}

/* 画布：内容高度增长（滚动交给 .bt-editor__scroll） */
.bt-editor__canvas {
  position: relative;
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

/* 只读：取消文本光标暗示（contenteditable=false 已由视图保证不可输入） */
.bt-editor__canvas--readonly :deep(.ProseMirror) {
  cursor: default;
}
</style>
