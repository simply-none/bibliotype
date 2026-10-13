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

/** 连续滚动模式的全部页（page 模式返回空数组，避免无谓序列化） */
interface TrackPage {
  index: number;
  html: string;
  showPageNumber: boolean;
  numberText: string;
}
const trackPages = computed<TrackPage[]>(() => {
  if (props.mode !== 'scroll') return [];
  const style = pageNumberStyle.value;
  const items: TrackPage[] = [];
  for (const page of pagination.value) {
    const nodes = props.reader.getPageNodes(page.index);
    const blockNodes = nodes.filter((node) => !isTextNode(node));
    const firstBlock = blockNodes[0];
    items.push({
      index: page.index,
      html: blockNodes.map((node) => serializeNode(node)).join('\n'),
      showPageNumber: firstBlock !== undefined && !coverNodes.value.has(firstBlock),
      numberText: formatPageNumber(page.index + 1, style),
    });
  }
  return items;
});

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
/** 滚动轨道内边距（与 .bt-scroll__track 的 padding 对齐） */
const SCROLL_PADDING = 16;

function updateScrollScale(): void {
  const el = scrollerRef.value;
  if (el === null || el.clientWidth <= 0) {
    scrollScale.value = 1;
    return;
  }
  const available = el.clientWidth - SCROLL_PADDING * 2;
  scrollScale.value = Math.min(1, Math.max(0.1, available / pageSize.value.width));
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

/** scroll 模式每页槽位尺寸（缩放后的整页占位） */
const slotStyle = computed(() => ({
  width: `${pageSize.value.width * scrollScale.value}px`,
  height: `${pageSize.value.height * scrollScale.value}px`,
}));

/* ---------- scroll 模式：滚动 ↔ 页态双向同步 ---------- */

/** 各页 DOM 元素（按页索引归档，供滚动定位与可见页测算） */
const pageEls: Record<number, HTMLElement> = {};

function setPageEl(el: unknown, index: number): void {
  if (el === null || el === undefined) {
    delete pageEls[index];
    return;
  }
  pageEls[index] = el as HTMLElement;
}

/** 视口参考线（容器 35% 高度处）对应的可见页索引 */
function computeVisibleIndex(): number {
  const scroller = scrollerRef.value;
  if (scroller === null) return 0;
  const refLine = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.35;
  let idx = 0;
  for (let i = 0; i < trackPages.value.length; i += 1) {
    const el = pageEls[i];
    if (el === undefined) continue;
    if (el.getBoundingClientRect().top <= refLine) idx = i;
    else break;
  }
  return idx;
}

/** 用户滚动 → 回写 Reader 页态（命中同页时 goToPage 为 no-op，不自激） */
let fromUserScroll = false;
let scrollRaf = 0;

function onScroll(): void {
  if (props.mode !== 'scroll' || scrollRaf !== 0) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const idx = computeVisibleIndex();
    if (idx !== props.reader.currentPage) {
      fromUserScroll = true;
      props.reader.goToPage(idx);
    }
  });
}

/** 目标页对齐到容器顶部（瞬时滚动，触发一次 scroll 事件后与可见页一致） */
function scrollToPage(index: number): void {
  const scroller = scrollerRef.value;
  const el = pageEls[index];
  if (scroller === null || el === undefined) return;
  scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
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

// 重排 / 换布局后页高变化，重新对齐当前页
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

  <!-- 连续滚动模式：全部分页纵向拼接，滚动 ↔ 页态双向同步 -->
  <div v-else ref="scrollerRef" class="bt-book-view bt-book-view--scroll" @scroll="onScroll">
    <div class="bt-scroll__track">
      <div
        v-for="page in trackPages"
        :key="page.index"
        :ref="(el) => setPageEl(el, page.index)"
        class="bt-scroll__slot"
        :class="{ 'is-active': page.index === currentPage }"
        :style="slotStyle"
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 16px;
}

.bt-scroll__slot {
  position: relative;
  flex: none;
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
