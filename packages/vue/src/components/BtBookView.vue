<script setup lang="ts">
/**
 * 书籍页面视图（BtBookView）
 *
 * 两种阅读模式（`mode`）：
 * - `page`（默认）：一次渲染「当前页」，按容器等比缩放居中（fit / ResizeObserver）；
 *   翻页靠外部触发（BtPager 按钮 / 键盘）与鼠标滚轮（下翻 = 下一页）。
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
import { DEFAULT_THEME, FONT_SIZE_TOKENS, NODE_TYPES, isTextNode, type BookNode } from '@bibliotype/core';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import { buildPageStyle, buildRootStyle, isVerticalMode } from '@bibliotype/layout';
import { buildBookCss, serializeNode, serializePageGutter, serializePageNotes } from '@bibliotype/layout/html';
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
    /** 阅读区无障碍名称（读屏用） */
    ariaLabel?: string;
    /**
     * 正文字号（px，可选）
     *
     * 传入时覆盖主题令牌 `font-size-body`（双指缩放 / 宿主字号设置共用同一入口）；
     * 重排（重新量尺）由宿主负责，本组件只做视觉覆盖 + 手势上抛。
     */
    fontSize?: number;
  }>(),
  { fit: 'contain', mode: 'page', ariaLabel: '正文阅读区，可用方向键翻页' },
);

const emit = defineEmits<{
  (event: 'update:fontSize', value: number): void;
}>();

const { layout, pagination, pageNumberText, currentPage, totalPages } = useReaderBinding(
  props.reader,
);
const tokens = computed<Readonly<Record<string, string | undefined>>>(() => {
  const base = props.tokens ?? DEFAULT_THEME;
  if (props.fontSize === undefined) return base;
  return { ...base, [FONT_SIZE_TOKENS.BODY]: `${props.fontSize}px` };
});
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

/**
 * 古籍仿真装饰图层的开关（双闸门第一道）
 *
 * 只有布局里真的带 `facsimile` 才开启；`buildBookCss` 内部还有第二道
 * （`pageDecoration && facsimile && 直排`），因此「古籍直排」样式表不变。
 */
const pageDecoration = computed(() => layout.value.facsimile !== undefined);

/** 版心空文本（reader 返回 undefined 时的占位，序列化会因字段为空输出空串） */
const EMPTY_GUTTER_TEXTS = { bookTitle: '', chapterTitle: '', pageNumber: '' } as const;

/** 当前页版心（书口）HTML；未启用仿真版式或封面页为空串 */
const gutterHtml = computed(() => {
  void pagination.value;
  return serializePageGutter(
    props.reader.getPageGutterTexts(currentPage.value) ?? EMPTY_GUTTER_TEXTS,
    layout.value.facsimile,
  );
});

/**
 * 取某页页底注区 HTML（承接续注标记）
 *
 * 数据来自 Reader 已还原的页底注节点（`getPageNotes`）；无注时返回空串，
 * 调用方据此决定是否渲染注区槽，避免空 `<div>` 泄漏进正文流。
 */
function pageNotesHtmlOf(index: number): string {
  void pagination.value;
  const notes = props.reader.getPageNotes(index);
  if (notes.length === 0) return '';
  return serializePageNotes(notes, { continued: props.reader.isPageNotesContinued(index) });
}

/** 当前页页底注区 HTML（page 模式） */
const pageNotesHtml = computed(() => pageNotesHtmlOf(currentPage.value));

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
    pageDecoration: pageDecoration.value,
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

/* ---------- page 模式滚轮翻页 ---------- */

/** 滚轮翻页的主轴累计阈值（px）：凑够一格才翻，避免高灵敏滚轮一格连翻数页 */
const WHEEL_PAGE_THRESHOLD = 120;
/** 翻页后的冷却（ms）：触控板惯性尾巴不再拖动页码 （与键盘连按手感相当） */
const WHEEL_PAGE_COOLDOWN = 320;
let wheelAcc = 0;
let wheelLockAt = 0;

/**
 * 单页模式键盘翻页
 *
 * 舞台可聚焦（`tabindex="0"`），方向键 / PageUp PageDown / 空格 / Home End 映射为翻页；
 * 带修饰键的组合（复制、切换标签等）不拦截。与滚轮同一方向约定：向右 / 向下 = 前进。
 */
const KEY_FORWARD = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ']);
const KEY_BACKWARD = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);
function onPageKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  let handled = false;
  if (event.key === 'Home') {
    handled = props.reader.goToPage(0);
  } else if (event.key === 'End') {
    handled = props.reader.goToPage(props.reader.totalPages - 1);
  } else if (KEY_FORWARD.has(event.key)) {
    handled = props.reader.nextPage();
  } else if (KEY_BACKWARD.has(event.key)) {
    handled = props.reader.prevPage();
  }
  if (handled) event.preventDefault();
}

/** 触屏滑动起点（px） */
let touchStartX = 0;
let touchStartY = 0;
/** 触屏滑动判定阈值（px，小于此值视为点按 / 抖动） */
const TOUCH_SWIPE_THRESHOLD = 40;

/** 正文字号可缩放区间（px） */
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 32;
/** 双指起始间距（px，0 表示当前不是双指手势） */
let pinchStartDistance = 0;
/** 双指起始字号（px） */
let pinchBaseSize = 16;
/** 已上抛的最近字号（避免同值重复 emit） */
let pinchLastSize = 0;

function distanceBetween(touches: TouchList): number {
  const a = touches[0];
  const b = touches[1];
  if (a === undefined || b === undefined) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function clampFontSize(value: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

function onPageTouchStart(event: TouchEvent): void {
  if (event.touches.length >= 2) {
    const distance = distanceBetween(event.touches);
    if (distance > 0) {
      pinchStartDistance = distance;
      pinchBaseSize = clampFontSize(props.fontSize ?? 16);
      pinchLastSize = pinchBaseSize;
    }
  }
  const touch = event.touches[0];
  if (touch === undefined) return;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}

/**
 * 双指缩放 → 字号档位
 *
 * 组件只负责「手势 → 字号」并 emit，重排（重新量尺）交由宿主；手势期间
 * `preventDefault` 阻止浏览器整页缩放。距离变化不足 1px 档位不 emit，避免抖动。
 */
function onPageTouchMove(event: TouchEvent): void {
  if (event.touches.length < 2 || pinchStartDistance <= 0) return;
  event.preventDefault();
  const ratio = distanceBetween(event.touches) / pinchStartDistance;
  const next = clampFontSize(pinchBaseSize * ratio);
  if (next !== pinchLastSize) {
    pinchLastSize = next;
    emit('update:fontSize', next);
  }
}

/**
 * 单页模式触屏滑动翻页
 *
 * - 横排：左滑 = 下一页（手指把纸往左推）；
 * - 直排（vertical-rl）：右滑 = 下一页（行款自右向左）；
 * - 纵向位移大于横向时视为滚动意图，不翻页；不足阈值视为点按。
 */
function onPageTouchEnd(event: TouchEvent): void {
  // 双指手势结束后不把残留位移当成滑动翻页
  const wasPinch = pinchStartDistance > 0;
  pinchStartDistance = 0;
  if (wasPinch) return;
  const touch = event.changedTouches[0];
  if (touch === undefined) return;
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if (Math.abs(dx) < TOUCH_SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
  const forward = verticalWriting.value ? dx > 0 : dx < 0;
  if (forward) {
    props.reader.nextPage();
  } else {
    props.reader.prevPage();
  }
}

/**
 * 滚动模式键盘翻页
 *
 * 容器可聚焦（`tabindex="0"`），PageUp / PageDown / 空格 / Home / End 滚动约一屏；
 * 直排（横向滚动）时改按容器宽度推进。带修饰键的组合不拦截。
 */
function onScrollKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const el = scrollerRef.value;
  if (el === null) return;
  const horizontal = verticalWriting.value;
  const step = horizontal ? el.clientWidth : el.clientHeight;
  if (step <= 0) return;
  let handled = true;
  if (event.key === 'Home') {
    el.scrollTo({ left: 0, top: 0 });
  } else if (event.key === 'End') {
    el.scrollTo({ left: el.scrollWidth, top: el.scrollHeight });
  } else if (event.key === 'PageDown' || event.key === ' ') {
    if (horizontal) el.scrollBy({ left: step, top: 0 });
    else el.scrollBy({ left: 0, top: step });
  } else if (event.key === 'PageUp') {
    if (horizontal) el.scrollBy({ left: -step, top: 0 });
    else el.scrollBy({ left: 0, top: -step });
  } else {
    handled = false;
  }
  if (handled) event.preventDefault();
}

/**
 * 单页模式下的鼠标滚轮：舞台 overflow hidden、滚轮无原生可滚区，故映射为翻页。
 * 取主导轴增量累计（同向累加、反向重新起算，不做正负抵消）；「向下 / 向右拨 =
 * 向前翻页」，与直排、横排的阅读前进方向一致；真翻成一页才 preventDefault。
 */
function onPageWheel(event: WheelEvent): void {
  const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!Number.isFinite(raw) || raw === 0) return;
  const now = Date.now();
  if (now < wheelLockAt) {
    wheelAcc = 0;
    return;
  }
  wheelAcc = Math.sign(raw) === Math.sign(wheelAcc) ? wheelAcc + raw : raw;
  if (Math.abs(wheelAcc) < WHEEL_PAGE_THRESHOLD) return;
  const forward = wheelAcc > 0;
  wheelAcc = 0;
  const flipped = forward ? props.reader.nextPage() : props.reader.prevPage();
  if (flipped) {
    event.preventDefault();
    wheelLockAt = now + WHEEL_PAGE_COOLDOWN;
  } else {
    // 首 / 末边缘：短锁避免惯性流量反复撞墙（不阻隔后续反向滚动）
    wheelLockAt = now + 120;
  }
}

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
  /** 版心（书口）HTML（空串 = 不渲染；未启用仿真版式时恒为空） */
  gutterHtml: string;
  /** 页底注区 HTML（空串 = 不渲染；未开启页底浮注或本页无注时恒为空） */
  notesHtml: string;
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
    const gutter = props.reader.getPageGutterTexts(i);
    list.push({
      index: i,
      mainPos: SCROLL_PADDING + i * step,
      html: blockNodes.map((node) => serializeNode(node)).join('\n'),
      gutterHtml: serializePageGutter(gutter ?? EMPTY_GUTTER_TEXTS, layout.value.facsimile),
      notesHtml: pageNotesHtmlOf(i),
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
  <!-- 单页模式：一次渲染当前页，等比缩放居中；滚轮 / 键盘 / 触屏滑动 = 翻页 -->
  <div
    v-if="mode === 'page'"
    ref="rootRef"
    class="bt-book-view bt-book-view--paged"
    role="document"
    tabindex="0"
    :aria-label="ariaLabel"
    @wheel="onPageWheel"
    @keydown="onPageKeydown"
    @touchstart.passive="onPageTouchStart"
    @touchmove="onPageTouchMove"
    @touchend="onPageTouchEnd"
  >
    <div class="bt-book-view__stage" :style="stageStyle">
      <div class="bt-reader-page" :style="scaledPageStyle">
        <div v-if="currentChrome?.header" class="bt-page-header">{{ currentChrome.header }}</div>
        <div class="bt-reader-page__flow" v-html="pageHtml"></div>
        <div v-if="pageNotesHtml" class="bt-page-notes-host" v-html="pageNotesHtml"></div>
        <div v-if="gutterHtml" class="bt-page-gutter-host" v-html="gutterHtml"></div>
        <footer v-if="currentChrome?.footer" class="bt-page-footer">{{ currentChrome.footer }}</footer>
        <footer
          v-else-if="currentChrome === undefined && showPageNumber"
          class="bt-page-number"
        >{{ pageNumberText }}</footer>
      </div>
    </div>
    <!-- 页码播报：视觉隐藏，读屏在翻页后朗读当前页 -->
    <span class="bt-sr-only" aria-live="polite">{{ pageNumberText }} / 共 {{ totalPages }} 页</span>
  </div>

  <!-- 连续滚动模式：窗口化渲染可见页，滚动 ↔ 页态双向同步（直排时沿水平自右向左） -->
  <div
    v-else
    ref="scrollerRef"
    class="bt-book-view bt-book-view--scroll"
    :class="{ 'bt-book-view--scroll-x': verticalWriting }"
    tabindex="0"
    :aria-label="ariaLabel"
    @scroll="onScroll"
    @wheel="onWheel"
    @keydown="onScrollKeydown"
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
          <div v-if="page.notesHtml" class="bt-page-notes-host" v-html="page.notesHtml"></div>
          <div v-if="page.gutterHtml" class="bt-page-gutter-host" v-html="page.gutterHtml"></div>
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

/* 键盘可聚焦：焦点环只在键盘导航时出现，避免鼠标点击后留框 */
.bt-book-view--paged:focus {
  outline: none;
}

.bt-book-view--paged:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

/* 仅读屏可见（页码播报等） */
.bt-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.bt-book-view--scroll {
  display: block;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 滚动模式同样支持键盘翻屏：焦点环只在键盘导航时出现 */
.bt-book-view--scroll:focus {
  outline: none;
}

.bt-book-view--scroll:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
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
