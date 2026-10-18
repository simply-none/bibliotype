<script setup lang="ts">
/**
 * 书籍页面视图（BtBookView）
 *
 * 两种阅读模式（`mode`）：
 * - `page`（默认）：一次渲染「当前页」，按容器等比缩放居中（fit / ResizeObserver）；
 *   翻页靠外部触发（BtPager 按钮 / 键盘），与历史行为一致。
 * - `scroll`：连续滚动多页——把所有分页沿主轴拼接为一个可滚动容器，
 *   滚动时按可见页回写 Reader 页态，外部翻页（按钮 / 键盘 / 目录）则滚动定位到对应页；
 *   双向同步天然收敛（goToPage 命中同页为 no-op，不自激）。
 *   拼接方向随书写方向：横排自上而下纵向滚；直排（vertical-rl）自右向左横向滚，
 *   首页贴右缘、向左续翻，与线装书行款一致。
 *
 * 公共：
 * - 页内容 IR → HTML 经 layout/html 序列化（与导出器同源）；
 * - 注入书册样式表：buildBookCss，容器选择器指向页框 `.bt-reader-page`；
 * - 页框 inline 样式 = buildPageStyle（尺寸 / 页边距）+ buildRootStyle（排版规则）；
 * - 页脚页码：底部居中展示页码（封面页自动隐藏）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_THEME, NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import { buildPageStyle, buildRootStyle, isVerticalMode } from '@bibliotype/layout';
import { buildBookCss, serializeNode } from '@bibliotype/layout/html';
import { formatPageNumber, type PageNumberStyle, type Reader } from '@bibliotype/reader';
import { useReaderBinding } from '../use-reader.js';

const props = withDefaults(
  defineProps<{
    /** 阅读器实例 */
    reader: Reader;
    /** 主题令牌值表（缺省 DEFAULT_THEME） */
    tokens?: Readonly<Record<string, string | undefined>>;
    /** 正文字体族令牌键（古籍可传 FONT_TOKENS.CLASSICAL_BODY） */
    fontToken?: string;
    /** 功能样式表（按功能粒度覆盖节点 / 标记 / 角色样式，与编辑画布 / 导出同源） */
    features?: FeatureStyleSheet;
    /** 命名样式集合（`[data-style-id]` 规则） */
    namedStyles?: NamedStyleSet;
    /** 缩放策略（仅 page 模式）：width 按容器宽 / contain 按容器宽高 / none 原尺寸 */
    fit?: 'width' | 'contain' | 'none';
    /** 阅读模式：page 单页翻页（默认） / scroll 连续滚动多页 */
    mode?: 'page' | 'scroll';
  }>(),
  { fit: 'contain', mode: 'page' },
);

const { layout, pagination, pageNumberText, currentPage } = useReaderBinding(props.reader);
const tokens = computed<Readonly<Record<string, string | undefined>>>(
  () => props.tokens ?? DEFAULT_THEME,
);
const pageSize = computed(() => layout.value.pageSize);
/** 书写方向为直排：滚动模式翻页轴随之由纵向转为水平（自右向左） */
const verticalWriting = computed(() => isVerticalMode(layout.value.writingMode));

/* ---------- 页内容与样式 ---------- */

/**
 * 当前页「行片段」节点（纸书跨页续排）。
 *
 * 与旧 getPageNodes 的区别：跨页长段只取本页应显示的那部分（按真实行切片），
 * 未拆块原样返回。依赖 pagination 使重排 / 换布局后重算。
 */
const pageNodes = computed<readonly BookNode[]>(() => {
  void pagination.value;
  return props.reader.getPageFragments(currentPage.value);
});

/** 当前页 HTML 片段（文本叶子不输出） */
const pageHtml = computed(() =>
  pageNodes.value
    .filter((node) => !isTextNode(node))
    .map((node) => serializeNode(node))
    .join('\n'),
);

/**
 * 封面子树节点集合（判定页脚页码是否隐藏；元素子节点与叶块同属集合）
 *
 * 依赖 pagination 使文档重载 / 重排后重算（scroll 模式逐页判定时使用）。
 */
const coverNodes = computed<ReadonlySet<BookNode>>(() => {
  void pagination.value;
  const result = new Set<BookNode>();
  const doc = props.reader.document;
  if (doc === undefined) return result;

  const collect = (node: BookNode): void => {
    result.add(node);
    for (const child of node.children ?? []) collect(child);
  };
  const walk = (node: BookNode): void => {
    if (node.type === NODE_TYPES.COVER) {
      collect(node);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.root);
  return result;
});

/** 页脚页码显示：封面页不标页码（书籍惯例） */
const showPageNumber = computed(() => {
  const firstBlock = pageNodes.value.find((node) => !isTextNode(node));
  if (firstBlock === undefined) return false;
  return !coverNodes.value.has(firstBlock);
});

/**
 * 当前页页眉 / 页脚文本
 *
 * `undefined` = 未配置页眉页脚（或该页是封面）→ 渲染层回退「页脚仅页码」的
 * 老行为，保证未启用该功能的文档逐像素不变；否则页眉页脚严格按配置渲染，
 * 页脚配成「不显示」时页码也一并不显示（由设置面板显式控制）。
 */
const currentChrome = computed(() => {
  void pagination.value;
  void layout.value;
  return props.reader.getPageChromeTexts(currentPage.value);
});

/** 页框样式（固定尺寸 + 页边距 + 排版规则） */
const pageStyle = computed(() => ({
  ...buildPageStyle(pageSize.value, tokens.value),
  ...buildRootStyle({
    tokens: tokens.value,
    options: layout.value,
    fontToken: props.fontToken,
  }),
}));

/** 注入 / 更新全局书册样式表（多实例共享，以最后写入为准） */
const STYLE_ELEMENT_ID = 'bt-book-css';

/** 页首块 margin 吞掉（书排惯例）：分页模型把块间折叠间距计入前一块推进量，
 * 新页从版心上缘 0 起排；渲染若保留首块 margin-top 会塌穿 flow 外溢到页边距区，
 * 页首多出空隙且页尾末行被 overflow 裁切（标题 UA 外边距 ~23px、注文 0.55em）。 */
const PAGE_START_RULE = `\n.bt-reader-page__flow > :first-child {\n  margin-block-start: 0;\n}\n`;

function syncBookStyle(): void {
  if (typeof document === 'undefined') return;
  const css = buildBookCss({
    tokens: tokens.value,
    options: layout.value,
    fontToken: props.fontToken,
    containerSelector: '.bt-reader-page',
    features: props.features,
    namedStyles: props.namedStyles,
  });
  const next = css + PAGE_START_RULE;
  let element = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (element === null) {
    element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    document.head.appendChild(element);
  }
  if (element.textContent !== next) {
    element.textContent = next;
  }
}

onMounted(syncBookStyle);
watch([tokens, () => layout.value, () => props.features, () => props.namedStyles], syncBookStyle);

/** 页码样式（当前布局） */
const pageNumberStyle = computed(() => layout.value.pageNumberStyle as PageNumberStyle);

/* ---------- 缩放 ---------- */

/** page 模式：等比缩放整页并居中（fit / ResizeObserver） */
const rootRef = ref<HTMLElement | null>(null);
const scale = ref(1);
let observer: ResizeObserver | undefined;

function updateScale(): void {
  const root = rootRef.value;
  if (props.fit === 'none' || root === null || root.clientWidth <= 0) {
    scale.value = 1;
    return;
  }
  const widthRatio = root.clientWidth / pageSize.value.width;
  const heightRatio = root.clientHeight / pageSize.value.height;
  const ratio =
    props.fit === 'width' || root.clientHeight <= 0
      ? widthRatio
      : Math.min(widthRatio, heightRatio);
  scale.value = Math.min(1, ratio);
}

/** scroll 模式：横排按容器宽适配；直排横向滚动额外受容器高约束（整页高须可见） */
const scrollerRef = ref<HTMLElement | null>(null);
const scrollScale = ref(1);
let scrollObserver: ResizeObserver | undefined;

/** 几何常量：滚动轨道内边距 / 页间距 / 上下各多渲染的缓冲页数 */
const SCROLL_PADDING = 16;
const SCROLL_GAP = 20;
const OVERSCAN = 2;

/** 单页缩放后高度（各页等高，可精确推算总尺寸与页位） */
const slotHeight = computed(() => pageSize.value.height * scrollScale.value);
/** 单页缩放后宽度（数值，供步长计算；带 px 字符串版见 slotWidth） */
const slotMainWidth = computed(() => pageSize.value.width * scrollScale.value);
/** 页步长：沿主轴（横排 = 页高 + 间距；直排 = 页宽 + 间距） */
const stride = computed(() =>
  verticalWriting.value ? slotMainWidth.value + SCROLL_GAP : slotHeight.value + SCROLL_GAP,
);

function updateScrollScale(): void {
  const el = scrollerRef.value;
  if (el === null || el.clientWidth <= 0) {
    scrollScale.value = 1;
    return;
  }
  let ratio = (el.clientWidth - SCROLL_PADDING * 2) / pageSize.value.width;
  if (verticalWriting.value) {
    // 直排页沿水平排列：页高是交叉轴，必须整页高可见，缩放取宽 / 高双约束较小者
    ratio = Math.min(ratio, (el.clientHeight - SCROLL_PADDING * 2) / pageSize.value.height);
  }
  scrollScale.value = Math.min(1, Math.max(0.1, ratio));
  syncViewport();
}

/** 实际生效缩放：随模式切换 */
const viewScale = computed(() => (props.mode === 'scroll' ? scrollScale.value : scale.value));

/** 页框最终样式：原尺寸渲染 + transform 缩放（transform-origin 左上） */
const scaledPageStyle = computed(() => ({
  ...pageStyle.value,
  transform: `scale(${viewScale.value})`,
  transformOrigin: 'top left',
}));

/** 舞台尺寸：为缩放下了的整页预留版面（不遮挡相邻内容） */
const stageStyle = computed(() => ({
  width: `${pageSize.value.width * scale.value}px`,
  height: `${pageSize.value.height * scale.value}px`,
}));

/** scroll 模式每页槽位宽度字符串（主轴定位偏移由 renderedPages.mainPos 逐页给定） */
const slotWidth = computed(() => `${slotMainWidth.value}px`);

/* ---------- scroll 模式：窗口化虚拟滚动 + 页态双向同步 ---------- */

/** 滚动视口沿主轴状态（横排 = scrollTop / clientHeight；直排 = 自内容右缘偏移 / 可视宽），驱动渲染窗口与可见页推算 */
const viewport = ref({ top: 0, height: 0 });

function syncViewport(): void {
  const scroller = scrollerRef.value;
  if (scroller === null) return;
  if (verticalWriting.value) {
    // 直排自右向左：主轴偏移 = 内容右缘到视口右缘的距离（scrollLeft 最大时视口贴右缘）
    const maxLeft = scroller.scrollWidth - scroller.clientWidth;
    viewport.value = { top: Math.max(0, maxLeft - scroller.scrollLeft), height: scroller.clientWidth };
  } else {
    viewport.value = { top: scroller.scrollTop, height: scroller.clientHeight };
  }
}

/** 总页数 */
const pageCount = computed(() => (props.mode === 'scroll' ? pagination.value.length : 0));

/** 滚动内容主轴总尺寸（含首尾内边距），撑出真实滚动条 */
const contentStyle = computed(() => {
  const count = pageCount.value;
  const main = count > 0 ? SCROLL_PADDING * 2 + count * stride.value - SCROLL_GAP : 0;
  return verticalWriting.value
    ? { width: `${main}px`, height: `${slotHeight.value}px` }
    : { height: `${main}px` };
});

/** 当前渲染窗口 [start, end]（含 overscan） */
const range = computed(() => {
  const count = pageCount.value;
  if (count === 0) return { start: 0, end: -1 };
  const step = stride.value > 0 ? stride.value : 1;
  const { top, height } = viewport.value;
  const firstVisible = Math.floor(top / step);
  const lastVisible = Math.floor((top + height) / step);
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(count - 1, lastVisible + OVERSCAN);
  return { start, end };
});

interface RenderedPage {
  index: number;
  /** 本页沿主轴的起始偏移（横排 = 距顶，直排 = 距右缘） */
  mainPos: number;
  html: string;
  showPageNumber: boolean;
  numberText: string;
  /** 页眉文本（空串 = 不渲染） */
  header: string;
  /** 页脚文本（空串 = 不渲染；启用页眉页脚时不再单独显示页码） */
  footer: string;
}

/**
 * 仅序列化 / 挂载可见窗口内的页（窗口外不构建，避免大部头一次性渲染全部分页）。
 *
 * 依赖 range / pagination / scrollScale / tokens / layout，滚动与重排时增量重建。
 */
const renderedPages = computed<RenderedPage[]>(() => {
  if (props.mode !== 'scroll') return [];
  const { start, end } = range.value;
  const style = pageNumberStyle.value;
  const step = stride.value;
  const list: RenderedPage[] = [];
  for (let i = start; i <= end; i += 1) {
    const nodes = props.reader.getPageFragments(i);
    const blockNodes = nodes.filter((node) => !isTextNode(node));
    const firstBlock = blockNodes[0];
    const chrome = props.reader.getPageChromeTexts(i);
    list.push({
      index: i,
      mainPos: SCROLL_PADDING + i * step,
      html: blockNodes.map((node) => serializeNode(node)).join('\n'),
      // 启用页眉页脚后，页码归属页脚字段；未启用才走老的「页脚仅页码」
      showPageNumber:
        chrome === undefined && firstBlock !== undefined && !coverNodes.value.has(firstBlock),
      numberText: formatPageNumber(i + 1, style),
      header: chrome?.header ?? '',
      footer: chrome?.footer ?? '',
    });
  }
  return list;
});

/** 槽位定位：横排沿纵轴写 top（自上而下）；直排沿横轴写 right（自右向左），主轴偏移同源 mainPos */
function slotStyle(page: RenderedPage): Record<string, string | number> {
  const size = { width: slotWidth.value, height: `${slotHeight.value}px` };
  return verticalWriting.value
    ? { right: `${page.mainPos}px`, top: 0, ...size }
    : { top: `${page.mainPos}px`, ...size };
}

/** 由主轴滚动位置推算参考线（自起始沿 35% 处）所在页 */
function indexFromViewport(): number {
  const count = pageCount.value;
  if (count === 0) return 0;
  const step = stride.value > 0 ? stride.value : 1;
  const y = viewport.value.top + viewport.value.height * 0.35 - SCROLL_PADDING;
  return Math.min(count - 1, Math.max(0, Math.floor(y / step)));
}

/** 用户滚动 → 更新视口并回写页态（命中同页时 goToPage 为 no-op，不自激） */
let fromUserScroll = false;
let scrollRaf = 0;

function onScroll(): void {
  if (props.mode !== 'scroll' || scrollRaf !== 0) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    syncViewport();
    const idx = indexFromViewport();
    if (idx !== props.reader.currentPage) {
      fromUserScroll = true;
      props.reader.goToPage(idx);
    }
  });
}

/** 目标页对齐到容器主轴起始沿（横排 = 顶缘，直排 = 右缘），并即时刷新视口以纳入渲染窗口 */
function scrollToPage(index: number): void {
  const scroller = scrollerRef.value;
  if (scroller === null) return;
  if (index < 0 || index >= pageCount.value) return;
  const pos = SCROLL_PADDING + index * stride.value;
  if (verticalWriting.value) {
    const maxLeft = scroller.scrollWidth - scroller.clientWidth;
    scroller.scrollLeft = Math.max(0, maxLeft - pos);
  } else {
    scroller.scrollTop = pos;
  }
  syncViewport();
}

/**
 * 直排横向滚动下的鼠标滚轮适配：容器仅 overflow-x 可滚时，部分浏览器不把
 * 纵向滚轮映射到横轴，滚轮无响应。约定「向下拨 = 向前翻页」——视口左移，
 * 即 scrollLeft 递减（直排右起，首页在右缘）。触控板横向手势（|deltaX| 较大）
 * 不拦截，交由浏览器原生行为。
 */
function onWheel(event: WheelEvent): void {
  if (props.mode !== 'scroll' || !verticalWriting.value) return;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  const scroller = scrollerRef.value;
  if (scroller === null) return;
  event.preventDefault();
  scroller.scrollLeft -= event.deltaY;
}

// 外部翻页（按钮 / 键盘 / 目录）→ 滚动定位；由滚动驱动的回写则跳过
watch(currentPage, (index) => {
  if (props.mode !== 'scroll') return;
  if (fromUserScroll) {
    fromUserScroll = false;
    return;
  }
  void nextTick(() => scrollToPage(index));
});

// 重排 / 换布局后页高变化，重新测尺并对齐当前页
watch(pagination, () => {
  if (props.mode !== 'scroll') return;
  void nextTick(() => {
    updateScrollScale();
    scrollToPage(props.reader.currentPage);
  });
});

/* ---------- 观察器装配（随模式切换重挂） ---------- */

/**
 * 两种模式的容器各自由 v-if 控制，切换时 DOM 会被销毁 / 重建。
 * 观察器必须在模式切换后重新挂到新容器上，否则切回 page 时
 * 旧观察器指向已卸载节点、updateScale 不再触发→缩放失效→内容被裁剪。
 */
function attachPageObserver(): void {
  updateScale();
  if (typeof ResizeObserver === 'undefined' || rootRef.value === null) return;
  observer?.disconnect();
  observer = new ResizeObserver(updateScale);
  observer.observe(rootRef.value);
}

function attachScrollObserver(): void {
  updateScrollScale();
  if (typeof ResizeObserver === 'undefined' || scrollerRef.value === null) return;
  scrollObserver?.disconnect();
  scrollObserver = new ResizeObserver(updateScrollScale);
  scrollObserver.observe(scrollerRef.value);
}

function detachObservers(): void {
  observer?.disconnect();
  observer = undefined;
  scrollObserver?.disconnect();
  scrollObserver = undefined;
}

// 模式切换：卸旧观察器，等新容器挂载后重挂（scroll 额外对齐当前页）
watch(
  () => props.mode,
  async (mode) => {
    detachObservers();
    await nextTick();
    if (mode === 'scroll') {
      attachScrollObserver();
      scrollToPage(props.reader.currentPage);
    } else {
      attachPageObserver();
    }
  },
);

onMounted(() => {
  if (props.mode === 'scroll') {
    attachScrollObserver();
    void nextTick(() => scrollToPage(props.reader.currentPage));
  } else {
    attachPageObserver();
  }
});

onBeforeUnmount(() => {
  detachObservers();
  if (scrollRaf !== 0) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }
});

// 缩放策略 / 页面尺寸变化：按当前模式重算对应缩放
watch([() => props.fit, pageSize], () => {
  if (props.mode === 'scroll') updateScrollScale();
  else updateScale();
});
</script>

<template>
  <!-- 单页模式：一次渲染当前页，等比缩放居中 -->
  <div v-if="mode === 'page'" ref="rootRef" class="bt-book-view">
    <div class="bt-book-view__stage" :style="stageStyle">
      <div class="bt-reader-page" :style="scaledPageStyle">
        <div v-if="currentChrome?.header" class="bt-page-header">{{ currentChrome.header }}</div>
        <div class="bt-reader-page__flow" v-html="pageHtml"></div>
        <footer v-if="currentChrome?.footer" class="bt-page-footer">{{ currentChrome.footer }}</footer>
        <footer
          v-else-if="currentChrome === undefined && showPageNumber"
          class="bt-page-number"
        >{{ pageNumberText }}</footer>
      </div>
    </div>
  </div>

  <!-- 连续滚动模式：窗口化渲染可见页，滚动 ↔ 页态双向同步（直排时沿水平自右向左） -->
  <div
    v-else
    ref="scrollerRef"
    class="bt-book-view bt-book-view--scroll"
    :class="{ 'bt-book-view--scroll-x': verticalWriting }"
    @scroll="onScroll"
    @wheel="onWheel"
  >
    <div class="bt-scroll__track" :style="contentStyle">
      <div
        v-for="page in renderedPages"
        :key="page.index"
        class="bt-scroll__slot"
        :class="{ 'is-active': page.index === currentPage }"
        :style="slotStyle(page)"
      >
        <div class="bt-reader-page" :style="scaledPageStyle">
          <div v-if="page.header" class="bt-page-header">{{ page.header }}</div>
          <div class="bt-reader-page__flow" v-html="page.html"></div>
          <footer v-if="page.footer" class="bt-page-footer">{{ page.footer }}</footer>
          <footer v-else-if="page.showPageNumber" class="bt-page-number">{{ page.numberText }}</footer>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 视图层（舞台 / 滚动槽位 / 页框定位盒）与书写方向无关：页框 inline 样式带
 * writing-mode: vertical-rl，若定位语义用逻辑属性（inset-inline-start）会被页框
 * 自身的直排物理翻转为 top 与 right，页以右缘锚定、整体左移被裁（可见纸面
 * 全空白）。故外壳一律强制横排 + 物理 top/left 定位，竖排只发生在页内正文流。
 */
.bt-book-view,
.bt-book-view__stage,
.bt-scroll__slot {
  writing-mode: horizontal-tb;
}

.bt-book-view {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.bt-book-view--scroll {
  display: block;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 直排滚动：页沿水平自右向左排列，横向滚动、纵向居中不滚；
   justify 显式 flex-start：基类的 center 在内容超宽时会把左端溢出区裁到不可滚达 */
.bt-book-view--scroll-x {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  overflow-x: auto;
  overflow-y: hidden;
}

/* 轨道宽度由 contentStyle 按页数撑开；min-width 保证页少时仍铺满视口、右锚定不漂 */
.bt-book-view--scroll-x .bt-scroll__track {
  flex: none;
  min-width: 100%;
}

/* 槽位改右锚定（mainPos 写 right）：断开基规则的 left:0 与居中 margin，
   避免 left 固定 + right 定位互斥后被静态位置接管 */
.bt-book-view--scroll-x .bt-scroll__slot {
  left: auto;
  margin-left: 0;
  margin-right: 0;
}

.bt-scroll__track {
  position: relative;
  width: 100%;
}

.bt-scroll__slot {
  position: absolute;
  left: 0;
  right: 0;
  margin-left: auto;
  margin-right: auto;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.18);
  transition: box-shadow 0.2s ease;
}

.bt-scroll__slot.is-active {
  box-shadow:
    0 2px 14px rgba(0, 0, 0, 0.18),
    0 0 0 2px rgba(60, 120, 220, 0.55);
}

.bt-book-view__stage {
  position: relative;
  flex: none;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.18);
}

.bt-reader-page {
  /* 物理定位：本元素自身处于 vertical-rl（inline 样式驱动），逻辑 inset 会按
     其书写方向解析为 top/right 导致页框左移溢出舞台；改物理 top/left 后方向无关。
     right / bottom 显式置 auto：页框带固定宽高，若任何规则同时命中 right:0（或被
     旧样式表残留污染）会形成 over-constrained，直排下右锚定生效、left 被解析为
     负值（stage宽 − 页宽）整页左移被裁。scoped 属性选择器特异度高于普通类规则，
     此处兜底必胜。 */
  position: absolute;
  top: 0;
  left: 0;
  right: auto;
  bottom: auto;
}
</style>
