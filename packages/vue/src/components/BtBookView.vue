<script setup lang="ts">
/**
 * 书籍页面视图（BtBookView）
 *
 * 两种阅读模式（`mode`）：
 * - `page`（默认）：一次渲染「当前页」，按容器等比缩放居中（fit / ResizeObserver）；
 *   翻页靠外部触发（BtPager 按钮 / 键盘），与历史行为一致。
 * - `scroll`：连续滚动多页——把所有分页纵向拼接为一个可滚动容器，
 *   滚动时按可见页回写 Reader 页态，外部翻页（按钮 / 键盘 / 目录）则滚动定位到对应页；
 *   双向同步天然收敛（goToPage 命中同页为 no-op，不自激）。
 *
 * 公共：
 * - 页内容 IR → HTML 经 layout/html 序列化（与导出器同源）；
 * - 注入书册样式表：buildBookCss，容器选择器指向页框 `.bt-reader-page`；
 * - 页框 inline 样式 = buildPageStyle（尺寸 / 页边距）+ buildRootStyle（排版规则）；
 * - 页脚页码：底部居中展示页码（封面页自动隐藏）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_THEME, NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import { buildPageStyle, buildRootStyle } from '@bibliotype/layout';
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
    /** 缩放策略（仅 page 模式）：width 按容器宽 / contain 按容器宽高 / none 原尺寸 */
    fit?: 'width' | 'contain' | 'none';
    /** 阅读模式：page 单页翻页（默认） / scroll 连续滚动多页 */
    mode?: 'page' | 'scroll';
  }>(),
  { fit: 'contain', mode: 'page' },
);

const { layout, pagination, pageNodes, pageNumberText, currentPage } = useReaderBinding(props.reader);
const tokens = computed<Readonly<Record<string, string | undefined>>>(
  () => props.tokens ?? DEFAULT_THEME,
);
const pageSize = computed(() => layout.value.pageSize);

/* ---------- 页内容与样式 ---------- */

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

function syncBookStyle(): void {
  if (typeof document === 'undefined') return;
  const css = buildBookCss({
    tokens: tokens.value,
    options: layout.value,
    fontToken: props.fontToken,
    containerSelector: '.bt-reader-page',
  });
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

onMounted(syncBookStyle);
watch([tokens, () => layout.value], syncBookStyle);

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

/** scroll 模式：按滚动容器宽度等比缩放（不放大，仅按宽适配） */
const scrollerRef = ref<HTMLElement | null>(null);
const scrollScale = ref(1);
let scrollObserver: ResizeObserver | undefined;

/** 几何常量：滚动轨道内边距 / 页间距 / 上下各多渲染的缓冲页数 */
const SCROLL_PADDING = 16;
const SCROLL_GAP = 20;
const OVERSCAN = 2;

/** 单页缩放后高度（各页等高，可精确推算总高与页位） */
const slotHeight = computed(() => pageSize.value.height * scrollScale.value);
/** 页步长（页高 + 间距） */
const stride = computed(() => slotHeight.value + SCROLL_GAP);

function updateScrollScale(): void {
  const el = scrollerRef.value;
  if (el === null || el.clientWidth <= 0) {
    scrollScale.value = 1;
    return;
  }
  const available = el.clientWidth - SCROLL_PADDING * 2;
  scrollScale.value = Math.min(1, Math.max(0.1, available / pageSize.value.width));
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

/** scroll 模式每页槽位宽度（页高由 slotHeight 推算定位） */
const slotWidth = computed(() => `${pageSize.value.width * scrollScale.value}px`);

/* ---------- scroll 模式：窗口化虚拟滚动 + 页态双向同步 ---------- */

/** 滚动视口（scrollTop / clientHeight），驱动渲染窗口与可见页推算 */
const viewport = ref({ top: 0, height: 0 });

function syncViewport(): void {
  const scroller = scrollerRef.value;
  if (scroller === null) return;
  viewport.value = { top: scroller.scrollTop, height: scroller.clientHeight };
}

/** 总页数 */
const pageCount = computed(() => (props.mode === 'scroll' ? pagination.value.length : 0));

/** 滚动内容总高（含首尾内边距），撑出真实滚动条 */
const contentStyle = computed(() => {
  const count = pageCount.value;
  const height = count > 0 ? SCROLL_PADDING * 2 + count * stride.value - SCROLL_GAP : 0;
  return { height: `${height}px` };
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
  top: number;
  html: string;
  showPageNumber: boolean;
  numberText: string;
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
    const nodes = props.reader.getPageNodes(i);
    const blockNodes = nodes.filter((node) => !isTextNode(node));
    const firstBlock = blockNodes[0];
    list.push({
      index: i,
      top: SCROLL_PADDING + i * step,
      html: blockNodes.map((node) => serializeNode(node)).join('\n'),
      showPageNumber: firstBlock !== undefined && !coverNodes.value.has(firstBlock),
      numberText: formatPageNumber(i + 1, style),
    });
  }
  return list;
});

/** 由 scrollTop 推算参考线（视口 35% 高处）所在页 */
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

/** 目标页对齐到容器顶部（按页步长直接定位，并即时刷新视口以纳入渲染窗口） */
function scrollToPage(index: number): void {
  const scroller = scrollerRef.value;
  if (scroller === null) return;
  if (index < 0 || index >= pageCount.value) return;
  scroller.scrollTop = SCROLL_PADDING + index * stride.value;
  syncViewport();
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

// 切入 scroll：首帧后对齐到当前页
watch(
  () => props.mode,
  (mode) => {
    if (mode !== 'scroll') return;
    void nextTick(() => {
      updateScrollScale();
      scrollToPage(props.reader.currentPage);
    });
  },
);

onMounted(() => {
  updateScale();
  if (
    props.mode === 'page' &&
    props.fit !== 'none' &&
    typeof ResizeObserver !== 'undefined' &&
    rootRef.value !== null
  ) {
    observer = new ResizeObserver(updateScale);
    observer.observe(rootRef.value);
  }
  if (props.mode === 'scroll') {
    updateScrollScale();
    if (typeof ResizeObserver !== 'undefined' && scrollerRef.value !== null) {
      scrollObserver = new ResizeObserver(updateScrollScale);
      scrollObserver.observe(scrollerRef.value);
    }
    void nextTick(() => scrollToPage(props.reader.currentPage));
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  scrollObserver?.disconnect();
  if (scrollRaf !== 0) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }
});

watch([() => props.fit, pageSize], updateScale);
watch([() => props.mode, pageSize], () => {
  if (props.mode === 'scroll') updateScrollScale();
});
</script>

<template>
  <!-- 单页模式：一次渲染当前页，等比缩放居中 -->
  <div v-if="mode === 'page'" ref="rootRef" class="bt-book-view">
    <div class="bt-book-view__stage" :style="stageStyle">
      <div class="bt-reader-page" :style="scaledPageStyle">
        <div class="bt-reader-page__flow" v-html="pageHtml"></div>
        <footer v-if="showPageNumber" class="bt-page-number">{{ pageNumberText }}</footer>
      </div>
    </div>
  </div>

  <!-- 连续滚动模式：窗口化渲染可见页，滚动 ↔ 页态双向同步 -->
  <div v-else ref="scrollerRef" class="bt-book-view bt-book-view--scroll" @scroll="onScroll">
    <div class="bt-scroll__track" :style="contentStyle">
      <div
        v-for="page in renderedPages"
        :key="page.index"
        class="bt-scroll__slot"
        :class="{ 'is-active': page.index === currentPage }"
        :style="{ top: `${page.top}px`, width: slotWidth, height: `${slotHeight}px` }"
      >
        <div class="bt-reader-page" :style="scaledPageStyle">
          <div class="bt-reader-page__flow" v-html="page.html"></div>
          <footer v-if="page.showPageNumber" class="bt-page-number">{{ page.numberText }}</footer>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.bt-scroll__track {
  position: relative;
  width: 100%;
}

.bt-scroll__slot {
  position: absolute;
  inset-inline: 0;
  margin-inline: auto;
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
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
}
</style>
