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
 * - props.loading（缺省 false）：分页开启时，首次分页完成前以加载占位覆盖画布，
 *   避免大文档在去抖 + 全量 DOM 实测期间先暴露未分页的连续内容；
 * - props.scale（缺省 1）：画布缩放，连续与 paged 两种模式均生效（paged 下覆盖
 *   「按容器宽自适应且限 ≤1」，允许放大超过 100%）；
 * - props.initialPage：首轮分页就绪后定位到该页（自 0 起），配合
 *   `update:visiblePage` 事件实现「阅读当前页 ↔ 编辑视口页」位置记忆；
 * - 默认插槽作用域透传 EditorBinding（供工具条访问命令与激活态）；
 * - 挂载时创建 EditorView，卸载时销毁；editor 实例替换时重建视图；
 * - 书册样式表以 `.bt-editor__canvas .ProseMirror` 为根容器注入（与 BtBookView
 *   的 buildBookCss 生成逻辑一致，节点 / 角色选择器限定在编辑画布内不外泄）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_THEME, LAYOUT_TOKENS } from '@bibliotype/core';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import {
  buildRootStyle,
  computeMetricsSignature,
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  type LayoutOptions,
} from '@bibliotype/layout';
import { buildBookCss, declarationToCss } from '@bibliotype/layout/html';
import type { BlockMeasureContext } from '@bibliotype/reader';
import type { BookEditor } from '@bibliotype/editor';
import type { Command } from 'prosemirror-state';
import { useEditorBinding, type EditorBinding } from '../use-editor.js';
import PagedCanvas from '../paged-editor/PagedCanvas.vue';
import { usePagedLayout } from '../paged-editor/use-paged-layout.js';
import { locatePmPosition } from '../paged-editor/selection-bridge.js';
import { resolveCaretTarget } from '../paged-editor/input-router.js';
import 'prosemirror-view/style/prosemirror.css';

const props = defineProps<{
  editor: BookEditor;
  /** 主题令牌值表（缺省 DEFAULT_THEME，与 BtBookView 传同一份以对齐样式） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 布局选项（书写方向 / 页面尺寸 / 分栏，缺省 DEFAULT_LAYOUT_OPTIONS） */
  options?: LayoutOptions;
  /** 正文字体族令牌键（古籍可传 FONT_TOKENS.CLASSICAL_BODY） */
  fontToken?: string;
  /**
   * 功能样式表（按功能粒度覆盖节点 / 标记 / 角色样式）
   *
   * 与 BtBookView / 导出共用同一份：编辑画布、阅读预览、EPUB、PDF 四端同源。
   * 只含纯视觉声明时只重写样式表（不重排）；含度量类声明时经
   * `computeMetricsSignature` 变化触发一次重排。
   */
  features?: FeatureStyleSheet;
  /** 命名样式集合（挂到具体段落的具名样式，输出 `[data-style-id]` 规则） */
  namedStyles?: NamedStyleSet;
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
  /**
   * 页底溢出（px）：末行允许伸入下边距的深度
   *
   * 缺省按「布局 + 令牌 + 行高」推导（与阅读预览 / PDF 导出同源口径）；
   * 传 0 关闭。须与另外两端传同一值，否则编辑画布与阅读页归属不一致。
   */
  bottomSlack?: number;
  /** 块度量估算上下文（横排下作缺 DOM 实测时的回退估算口径） */
  measure?: BlockMeasureContext;
  /** 视图是否可编辑（缺省 true；false 时画布只读，拒绝用户输入） */
  editable?: boolean;
  /**
   * 首次分页前显示加载占位（缺省 false：维持现行为，分页就绪前短暂展示连续画布）
   *
   * 为 true 且 pagination 开启时，在分页内核首次产出结果（成功或判定不可用）之前，
   * 用不透明 loading 遮罩覆盖整个编辑视口；仅首次触发，后续增量重排不再出现。
   */
  loading?: boolean;
  /**
   * 外部实测块尺寸映射（块 id → 主轴尺寸 px）
   *
   * 已废弃：paged 内核自带同源 DOM 量尺（measurePagination），不再消费此映射；
   * 保留签名仅为兼容既有调用方。
   */
  blockSizes?: ReadonlyMap<string, number>;
  /** 画布缩放比例（缺省 1；限幅 0.2~2；paged 模式同样生效，覆盖容器宽自适应） */
  scale?: number;
  /** paged 首轮分页就绪后定位页（自 0 起；「阅读当前页 → 进编辑」位置定位） */
  initialPage?: number;
}>();

const emit = defineEmits<{
  /** paged 模式视口页变化（透传 PagedCanvas，供外部「保存并预览」回写阅读页态） */
  'update:visiblePage': [index: number];
}>();

const canvasRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
// 只读开关：以 ref 承载、经闭包透传给绑定，切换时无需重建视图（refresh 重求值）
const isEditable = ref(props.editable !== false);
// paged 态跳过隐藏 PM 视图同步（命令 .scrollIntoView 不再乱滚外层，页面跳动消除）
const binding = useEditorBinding(props.editor, {
  isEditable: () => isEditable.value,
  syncView: () => !pagedActive.value,
});

const resolvedTokens = computed<Readonly<Record<string, string | undefined>>>(
  () => props.tokens ?? DEFAULT_THEME,
);
const resolvedOptions = computed<LayoutOptions>(() => props.options ?? DEFAULT_LAYOUT_OPTIONS);
const vertical = computed(() => isVerticalMode(resolvedOptions.value.writingMode));

/* ---------- 自定义可编辑分页引擎（paged 模式） ---------- */

const fontTokenRef = computed(() => props.fontToken);
const measureRef = computed(() => props.measure);
const pageMainSizeRef = computed(() => props.pageMainSize);
const bottomSlackRef = computed(() => props.bottomSlack);

/**
 * paged 编辑桥的 IME 组合态（由 PagedCanvas 上抛）。
 *
 * 组合进行中冻结重排：否则上一笔编辑的去抖重排会在下一次中文组合期间落地，
 * v-html 重建正在输入的片段 DOM + `restoreCaretFromModel` 抢光标，导致未落模的
 * 组合文本在跨页段落的页边界两处重复。组合结束后统一补排一次。
 */
const pagedComposing = ref(false);

/**
 * 排版度量签名：决定「是否需要重新分页」
 *
 * 只含度量类配置（字号 / 行距 / 缩进 / 页边距 / 分栏 / 版框 / 功能样式里的度量声明）。
 * 用户拖动颜色、线型、底色等纯视觉参数时签名不变 → 只换样式表，不重排。
 */
const metricsSignatureRef = computed(() =>
  computeMetricsSignature({
    tokens: resolvedTokens.value,
    options: resolvedOptions.value,
    features: props.features,
  }),
);

const paged = usePagedLayout({
  editor: props.editor,
  options: resolvedOptions,
  tokens: resolvedTokens,
  fontToken: fontTokenRef,
  measure: measureRef,
  pageMainSize: pageMainSizeRef,
  bottomSlack: bottomSlackRef,
  metricsSignature: metricsSignatureRef,
  composing: pagedComposing,
  version: binding.version,
});

/**
 * paged 生效：开启分页 + 未显式要求连续（paginationMode !== 'overlay'）+ 内核可用。
 *
 * 缺省（paginationMode 未给）即尝试 paged（翻默认）；单栏横排 / 直排均可用，
 * 多栏等 usable=false 时自动回退连续画布，不劣化。
 */
const pagedActive = computed(
  () => props.pagination === true && props.paginationMode !== 'overlay' && paged.usable.value,
);

/** 首轮分页是否已产出结果（成功或判定不可用均算完成，避免多栏等场景永久 loading） */
const firstLayoutDone = computed(() => paged.lastResult.value !== null);

/** loading 遮罩：显式开启 loading + 分页开启 + 首轮重排未就绪 */
const showLoading = computed(
  () => props.loading === true && props.pagination === true && !firstLayoutDone.value,
);

/**
 * paged 编辑事件桥（方案 S）：PagedCanvas 已把输入经 selection-bridge 落成
 * BookEditor 事务（editor.dispatch），此处补齐视图同步与重排：
 * - edited：refresh({skipViewSync})（version++，PM 视图隐藏不同步）→ 携块 id 提示走增量重排；
 * - sync：选区落模后仅 refresh（纯选区不改 doc，重排守卫自动跳过）；
 * - history：撤销 / 重做走 PM 插件栈（binding.undo/redo），随后 version 驱动重排。
 */
function onPagedEdited(blockId: string): void {
  // paged 态 PM 视图隐藏（v-show）：跳过 updateState（全量 PM DOM 重建），仅 version++ 驱动重排
  binding.refresh({ skipViewSync: true });
  paged.scheduleRelayout(blockId);
}

function onPagedSync(): void {
  // 纯选区落模：不改 doc，PM 视图无需同步，仅 version++ 维持激活态 / 守卫响应
  binding.refresh({ skipViewSync: true });
}

function onPagedHistory(dir: 'undo' | 'redo'): void {
  if (dir === 'undo') binding.undo();
  else binding.redo();
}

/**
 * 目录跳转（编辑态）：把 nodeId 解析为模型选区并滚动进入视图。
 *
 * - 连续画布态：binding.goToNode 的 scrollIntoView 由可见 PM 视图直接响应；
 * - paged 态：PM 视图被 v-show 隐藏、不响应 scrollIntoView，故据返回位置在分页索引里
 *   定位所属页并翻到该页，再请求重排后按模型选区还原光标（跨页滚动兜底）。
 * 未命中返回 false。
 */
function goToNode(nodeId: string): boolean {
  const pos = binding.goToNode(nodeId);
  if (pos === null) return false;
  if (pagedActive.value && pagedCanvasRef.value !== null) {
    const index = paged.pagedIndex.value;
    const pages = paged.pages.value;
    if (index !== null) {
      const hit = locatePmPosition(index, pos);
      if (hit !== null) {
        const target = resolveCaretTarget(
          pages,
          index,
          paged.charsPerLine.value,
          hit.loc.blockId,
          hit.blockChar,
        );
        if (target !== null) {
          pagedCanvasRef.value.scrollToPage(target.pageIndex);
        }
      }
    }
    // 模型已设选区：重排后 caret 还原（含跨页滚动兜底）确保光标落在该节点
    pagedCanvasRef.value.requestCaretRestore();
  }
  return true;
}

/* ---------- 工具栏命令的 paged 感知包装 ---------- */

/** PagedCanvas 暴露的编辑桥方法（重排后光标还原 / 选区同步） */
const pagedCanvasRef = ref<InstanceType<typeof PagedCanvas> | null>(null);

/**
 * 在 paged 态下包裹一次命令执行：先同步刷选区到模型，执行成功后请求重排后还原光标。
 *
 * 工具栏命令直接改模型并把 PM 选区移入新容器，但不经过片段编辑那套 restorePending 流程，
 * 导致重排后 v-html 重建片段、焦点/光标丢失：引用 / 列表 / 表格 / 边注「点了没反应」，
 * 双行注 / 校勘记「要点很多次才能输入」。经此包装后光标随模型选区落回正确片段。
 * 连续画布态（非 paged）原样执行，行为不变。
 */
function runPagedAware(action: () => boolean): boolean {
  if (!pagedActive.value || isEditable.value === false) return action();
  pagedCanvasRef.value?.flushSelectionSync();
  const ok = action();
  if (ok) pagedCanvasRef.value?.requestCaretRestore();
  return ok;
}

/**
 * 透传给默认插槽的 binding：在原始 binding 之上覆写 execute / undo / redo 为 paged 感知版。
 * 其余成员（editor / view / version / isMarkActive / refresh…）按引用共享，激活态与视图链路不变。
 */
const slotBinding: EditorBinding = {
  ...binding,
  execute: (command: Command) => runPagedAware(() => binding.execute(command)),
  undo: () => runPagedAware(() => binding.undo()),
  redo: () => runPagedAware(() => binding.redo()),
};

// 切回连续画布时补全量视图同步：paged 态期间 PM DOM 停在旧状态（skipViewSync 积累的偏差）
watch(pagedActive, (active) => {
  if (!active) binding.refresh();
});

/* ---------- 画布缩放（连续 / paged 均生效；paged 下透传给 PagedCanvas 覆盖自适应） ---------- */

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
      features: props.features,
      namedStyles: props.namedStyles,
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

watch(
  [resolvedTokens, resolvedOptions, () => props.fontToken, () => props.features, () => props.namedStyles],
  syncBookStyle,
);

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

// 分页模式 / 每页尺寸 / 页底溢出 / 度量变化时重排，确保 pages 及时就绪
watch(
  [() => props.paginationMode, () => props.pageMainSize, () => props.bottomSlack, () => props.measure],
  () => paged.scheduleRelayout(),
);

/** 暴露给使用方的命令接口（编辑态目录跳转等） */
defineExpose({ goToNode });
</script>

<template>
  <div class="bt-editor">
    <div v-if="$slots.default" class="bt-editor__toolbar">
      <slot v-bind="slotBinding" />
    </div>
    <div ref="scrollRef" class="bt-editor__scroll">
      <PagedCanvas
        v-if="pagedActive"
        ref="pagedCanvasRef"
        class="bt-editor__paged"
        :pages="paged.pages.value"
        :options="resolvedOptions"
        :tokens="resolvedTokens"
        :font-token="props.fontToken"
        :features="props.features"
        :named-styles="props.namedStyles"
        :editable="isEditable"
        :scale="props.scale === undefined ? undefined : resolvedScale"
        :editor="props.editor"
        :index="paged.pagedIndex.value"
        :chars-per-line="paged.charsPerLine.value"
        :initial-page="props.initialPage"
        @update:visible-page="emit('update:visiblePage', $event)"
        @edited="onPagedEdited"
        @sync="onPagedSync"
        @composition="pagedComposing = $event"
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
      <div v-if="showLoading" class="bt-editor__loading">
        <span class="bt-editor__loading-spinner" />
        <span>正在分页…</span>
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

/* loading 遮罩：首次分页就绪前覆盖整个视口（不透明，隐藏未分页内容） */
.bt-editor__loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #6b5f4c;
  font-size: 14px;
  background: var(--bt-editor-stage, #dcd6c9);
}

.bt-editor__loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: bt-editor-loading-spin 0.8s linear infinite;
}

@keyframes bt-editor-loading-spin {
  to {
    transform: rotate(360deg);
  }
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
