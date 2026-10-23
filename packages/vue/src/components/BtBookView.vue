<script setup lang="ts">
/**
 * 书籍页面视图（BtBookView）
 *
 * 两种阅读模式（`mode`）：
 * - `page`（默认）：一次渲染「当前页」，按容器等比缩放居中（fit / ResizeObserver）；
 *   传入 `fitScale` 时改为直接拿它做整页倍率（PDF「适合宽度 / 高度」语义，允许 >1
 *   放大，文字随页框整体缩放），超出容器的部分由本容器滚动承接（滚轮让位原生滚动）；
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
import {
  formatPageNumber,
  parseReadingPosition,
  type PageNumberStyle,
  type Reader,
  type ReadingPosition,
} from '@bibliotype/reader';
import { useReaderBinding } from '../use-reader.js';
import { useNoteInteraction } from '../use-note-interaction.js';
import {
  adjustScrollOffset,
  estimateFlowChunkHeight,
  resolveAnchorChunkIndex,
  resolveMountWindow,
  type FlowMetrics,
} from '../flow-model.js';
import { usePrefersReducedMotion } from '../prefers-reduced-motion.js';
import { useBreakpoint } from '../use-breakpoint.js';
import { BT_BREAKPOINTS } from '../breakpoints.js';
import type { FlowChunk } from '@bibliotype/reader';
import BtNotePreview from './BtNotePreview.vue';

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
    /**
     * 外部指定的整页缩放倍率（`page` / `scroll` 模式；PDF「适合宽度 / 高度」语义）
     *
     * 传入有限正数时直接作为最终 scale（允许 >1 放大，字体与版面整体等比缩放），
     * 不再按容器 contain 与 `Math.min(1, ratio)` 推算；倍率另受横向安全阀约束
     * （不超过 容器可用宽 / 页宽，不致冒出横向滚动条；纵向预留滚动条槽位）。
     */
    fitScale?: number;
    /** 阅读模式：page 单页翻页（默认） / scroll 连续滚动多页 / scroll-flow 流式阅读（D5） */
    mode?: 'page' | 'scroll' | 'scroll-flow';
    /** 阅读区无障碍名称（读屏用） */
    ariaLabel?: string;
    /**
     * 正文字号（px，可选）
     *
     * 传入时覆盖主题令牌 `font-size-body`（双指缩放 / 宿主字号设置共用同一入口）；
     * 重排（重新量尺）由宿主负责，本组件只做视觉覆盖 + 手势上抛。
     */
    fontSize?: number;
    /**
     * 对页模式（仅 page 模式）：single 单页 / facing 左右双页
     *
     * facing 下当前页与相邻页成对显示（偶数页在左），缩放宽按双页计算；
     * 翻页步长仍为 1，跨过页对时整体换对。
     */
    spread?: 'single' | 'facing';
    /**
     * 翻页动效（仅 page / scroll 分页渲染）
     *
     * - `slide`：新页按阅读方向滑入（横排左右、直排上下），220ms；
     * - `fade`：仅淡入淡出；
     * - `none`：无动效。
     *
     * 系统开启「减少动态效果」或 `pageTransition='none'` 时强制瞬时切换。
     */
    pageTransition?: 'none' | 'slide' | 'fade';
    /**
     * 初始阅读位置（D5）
     *
     * 由宿主持久化的 `ReadingPosition`（或 JSON 串）；`scroll-flow` 下据此挂载目标
     * 分块并滚到锚点句；`page` / `scroll` 下走既有 `reader.restorePosition`。
     */
    initialPosition?: ReadingPosition | string;
    /**
     * 流式分块上限：单块最多块数（D5，缺省 24）
     */
    flowChunkBlocks?: number;
    /**
     * 流式懒挂载预取余量（CSS 长度，缺省 `800px`）：取首个数值作为视口上下预挂载距离
     * （`resolveMountWindow` 的 `overscan`），用于滚动前提前挂载相邻分块。
     */
    flowRootMargin?: string;
    /**
     * 宿主自定义分块高度估算（D5）
     *
     * 不传则用「字数 / 每行字数 × 行高」估算；挂载后由 `ResizeObserver` 实测覆盖。
     */
    estimateFlowHeight?: (chunk: FlowChunk) => number;
  }>(),
  { fit: 'contain', mode: 'page', ariaLabel: '正文阅读区，可用方向键翻页' },
);

const emit = defineEmits<{
  (event: 'update:fontSize', value: number): void;
  /** 阅读位置变化（D5）：宿主据此持久化（刷新 / 换字号后回到原句） */
  (event: 'update:position', value: ReadingPosition): void;
  /** 当前页码变化（0 起）；容器（BtCompareView）据此同步两侧翻页 */
  (event: 'update:page', value: number): void;
  /** 请求的阅读模式不被当前版式支持，已自动回落（D5） */
  (event: 'mode-fallback', payload: { requested: string; effective: string; reason: string }): void;
  /** 点按阅读区中部（阅读器惯例：呼出 / 收起 chrome，H5 A3） */
  (event: 'tap-center'): void;
}>();

const { layout, pagination, pageNumberText, currentPage, totalPages } = useReaderBinding(
  props.reader,
);

/** 书写方向为直排：滚动模式翻页轴随之由纵向转为水平（自右向左） */
const verticalWriting = computed(() => isVerticalMode(layout.value.writingMode));

/**
 * 注释交互（D9）
 *
 * 注区与注码都是 `v-html` 字符串，事件统一委托到页容器；跨页跳转读 Reader
 * 的注释 / 注引用索引，翻页由 `onRequestPage` 走 reader.goToPage。
 */
const {
  preview: notePreview,
  attach: attachNoteInteraction,
  onClick: onNoteClick,
  onPointerOver: onNotePointerOver,
  onPointerOut: onNotePointerOut,
  onFocusIn: onNoteFocusIn,
  onFocusOut: onNoteFocusOut,
  handleKeydown: handleNoteKeydown,
  closePreview: closeNotePreview,
} = useNoteInteraction({
  reader: props.reader,
  onRequestPage: (page) => props.reader.goToPage(page),
  onLocateNode: (nodeId) => locateFlowNode(nodeId),
});

/* =========================================================================
 * 模式判定 / 翻页动效（D5，前置声明：下方 note-interaction / mode 监听会引用）
 * ========================================================================= */

/** 系统「减少动态效果」探测（SSR / 无 matchMedia 回落 false） */
const prefersReducedMotion = usePrefersReducedMotion();
/** 翻页动效是否关闭（显式 none 或系统减少动态效果） */
const flowReduced = computed(
  () => (props.pageTransition ?? 'slide') === 'none' || prefersReducedMotion.value,
);

/** 仿真版式 / 直排 / 对页下流式不被支持，回落 paged 并提示宿主 */
const facsimileMode = computed(() => layout.value.facsimile !== undefined);
const flowSupported = computed(
  () =>
    props.mode === 'scroll-flow' &&
    !verticalWriting.value &&
    !facsimileMode.value &&
    props.spread !== 'facing',
);
/** 实际生效模式：scroll-flow 不支持时回落 page，其余原样透传 */
const effectiveMode = computed<'page' | 'scroll' | 'scroll-flow'>(() =>
  flowSupported.value
    ? 'scroll-flow'
    : props.mode === 'scroll'
      ? 'scroll'
      : 'page',
);

/** 翻页过渡名称（none / 减少动态效果 → 空；fade 用淡入；其余滑入） */
const transitionName = computed(() =>
  flowReduced.value ? '' : props.pageTransition === 'fade' ? 'bt-fade' : 'bt-turn',
);
/** 翻页过渡 key：页码或版式变化即触发 */
const pageTurnKey = computed(() => `${props.spread}-${props.reader.currentPage}`);

// 翻页后旧预览的锚点已不可见，直接收起（高亮由计时器自行清理）
watch(currentPage, closeNotePreview);
const tokens = computed<Readonly<Record<string, string | undefined>>>(() => {
  const base = props.tokens ?? DEFAULT_THEME;
  if (props.fontSize === undefined) return base;
  return { ...base, [FONT_SIZE_TOKENS.BODY]: `${props.fontSize}px` };
});
const pageSize = computed(() => layout.value.pageSize);

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

/** 当前页分栏数（1~3；缺省 1） */
const currentPageColumns = computed(() => {
  void pagination.value;
  return props.reader.getPageColumns(currentPage.value);
});

/**
 * 页面正文流的分栏样式
 *
 * 分页器已按「页容量 × 栏数」装箱，这里只需让 CSS 把整页内容顺序填入各栏；
 * `column-fill: auto` 保证先填满第一栏再进下一栏（balancing 会把内容均摊，
 * 与分页器的行级切分不对应）。
 */
function flowStyleOf(columns: number): Record<string, string> | undefined {
  if (columns <= 1) return undefined;
  return {
    columnCount: String(columns),
    columnGap: 'var(--bt-column-gap)',
    columnFill: 'auto',
  };
}

/* ---------- 对页（facing spread） ---------- */

/** 对页中缝宽度（px）：0 = 两页紧贴，呈真实书册跨页 */
const SPREAD_GAP = 0;

/** 断点：窄屏（< md）对页并排放不下，自动降级单页（C4；宽视口自动还原） */
const breakpoint = useBreakpoint();
const spreadDowngraded = computed(
  () => props.spread === 'facing' && breakpoint.width.value < BT_BREAKPOINTS.md,
);

/** 是否启用对页（仅 page 模式；窄屏降级为单页） */
const spreadEnabled = computed(
  () => props.spread === 'facing' && props.mode === 'page' && !spreadDowngraded.value,
);

/** 对页总宽（两页 + 中缝） */
const spreadWidth = computed(() => pageSize.value.width * 2 + SPREAD_GAP);

interface SpreadPage {
  index: number;
  html: string;
  columns: number;
  header: string;
  footer: string;
  notesHtml: string;
  gutterHtml: string;
  showPageNumber: boolean;
  numberText: string;
}

/** 对页中的两页数据（左页取偶数页；越界页不出现） */
const spreadPages = computed<SpreadPage[]>(() => {
  if (!spreadEnabled.value) return [];
  const count = totalPages.value;
  if (count === 0) return [];
  const anchor = currentPage.value % 2 === 0 ? currentPage.value : currentPage.value - 1;
  const indexes = [anchor, anchor + 1].filter((index) => index >= 0 && index < count);
  return indexes.map((index) => {
    const nodes = props.reader.getPageFragments(index).filter((node) => !isTextNode(node));
    const firstBlock = nodes[0];
    const chrome = props.reader.getPageChromeTexts(index);
    const gutter = props.reader.getPageGutterTexts(index);
    return {
      index,
      html: nodes.map((node) => serializeNode(node)).join('\n'),
      columns: props.reader.getPageColumns(index),
      header: chrome?.header ?? '',
      footer: chrome?.footer ?? '',
      notesHtml: pageNotesHtmlOf(index),
      gutterHtml: serializePageGutter(gutter ?? EMPTY_GUTTER_TEXTS, layout.value.facsimile),
      showPageNumber:
        chrome === undefined && firstBlock !== undefined && !coverNodes.value.has(firstBlock),
      numberText: formatPageNumber(index + 1, pageNumberStyle.value),
    };
  });
});

/** 对页舞台尺寸（缩放后的双页版面） */
const spreadStageStyle = computed(() => ({
  width: `${spreadWidth.value * scale.value}px`,
  height: `${pageSize.value.height * scale.value}px`,
}));

/**
 * 对页中单页的位置
 *
 * `transform: scale()` 不改变布局盒，flex 并排会让右页停在未缩放位置；
 * 故两页均绝对定位，按缩放后的页宽偏移（左页偶数 = 0，右页奇数 = 1）。
 */
function spreadPageStyle(page: SpreadPage) {
  return {
    ...scaledPageStyle.value,
    position: 'absolute' as const,
    top: '0',
    left: `${(page.index % 2) * pageSize.value.width * scale.value}px`,
  };
}

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
const EMPTY_GUTTER_TEXTS = {
  bookTitle: '',
  volumeTitle: '',
  chapterTitle: '',
  pageNumber: '',
} as const;

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

/** page 模式：等比缩放整页并居中（fit / ResizeObserver；fitScale 直接覆盖） */
const rootRef = ref<HTMLElement | null>(null);
const scale = ref(1);
let observer: ResizeObserver | undefined;

/** fitScale 生效判定（未传 / 非法 = null，回退容器适配策略） */
const fitScaleOverride = computed<number | null>(() => {
  const raw = props.fitScale;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
});

function updateScale(): void {
  /* PDF 式整页缩放：宿主算好倍率直接落地，几何不动、字体跟着缩放。
     横向安全阀：宿主按舞台盒算的倍率没预留本容器纵滚动条的宽度（页高超出
     必有纵滚），超出可用宽的份额钳掉，不致再冒出横向滚动条；配合激活时
     预留 scrollbar-gutter，clientWidth 不会因滚动条出现而二次变化。 */
  const override = fitScaleOverride.value;
  if (override !== null) {
    const el = rootRef.value;
    const pageW = spreadEnabled.value ? spreadWidth.value : pageSize.value.width;
    const guard =
      el !== null && el.clientWidth > 0 && pageW > 0 ? el.clientWidth / pageW : override;
    scale.value = Math.min(override, guard);
    return;
  }
  const root = rootRef.value;
  if (props.fit === 'none' || root === null || root.clientWidth <= 0) {
    scale.value = 1;
    return;
  }
  const widthRatio =
    root.clientWidth / (spreadEnabled.value ? spreadWidth.value : pageSize.value.width);
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
/** scroll-flow 模式：流式滚动容器（与 paged / scroll 互不依赖） */
const flowRootRef = ref<HTMLElement | null>(null);
let scrollObserver: ResizeObserver | undefined;

/* 注释委托挂在当前模式的活动容器上（切模式时重绑，旧容器的预览随 attach 清空） */
watch(
  [rootRef, scrollerRef, flowRootRef, () => props.mode],
  () => {
    const container =
      effectiveMode.value === 'scroll'
        ? scrollerRef.value
        : effectiveMode.value === 'scroll-flow'
          ? flowRootRef.value
          : rootRef.value;
    attachNoteInteraction(container);
  },
  { flush: 'post', immediate: true },
);

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
  /* PDF 式整页缩放同样覆盖连续滚动视图：槽位宽 = 页宽 × 倍率，页内字体跟着缩放。
     横向安全阀与原自适应同口径（扣 SCROLL_PADDING），槽位不超过可用宽，
     不致 overflow-x hidden 下把页缘裁掉；fitScale 激活时根上 is-zoom-fit
     预留纵滚槽位，clientWidth 不随溢出二次变化。 */
  const override = fitScaleOverride.value;
  if (override !== null) {
    const pageW = pageSize.value.width;
    const guard =
      el !== null && el.clientWidth > 0 && pageW > 0
        ? (el.clientWidth - SCROLL_PADDING * 2) / pageW
        : override;
    scrollScale.value = Math.min(override, Math.max(0.1, guard));
    syncViewport();
    return;
  }
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
  // D9：Alt+←/→ 切换注释、Esc 关闭注释预览（先于翻页键位消费）
  if (handleNoteKeydown(event)) return;
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
/** 触屏滑动开始时刻（ms，速度方向判定用） */
let touchStartAt = 0;
/** 最近一次滑动的结束时刻（ms）：紧随其后的 click 不再当作点按 */
let swipeEndedAt = 0;
/** 滑动判定阈值（px，小于此值视为点按 / 抖动） */
const TOUCH_SWIPE_THRESHOLD = 50;
/** 快速轻扫位移阈值（px）：时长足够短（< 300ms）时按速度翻页，不必走满 50px */
const TOUCH_FLICK_THRESHOLD = 24;
/** 快速轻扫的时长上限（ms） */
const TOUCH_FLICK_MS = 300;
/** 边缘点击翻页区宽度（占阅读区宽度比）：阅读器惯例的左右边缘区 */
const EDGE_TAP_RATIO = 0.2;
/** 判定点按时距上次滑动结束的最小时长（ms） */
const TAP_SUPPRESS_MS = 350;

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
  touchStartAt = Date.now();
}

/** 当前是否存在非塌陷选区（滑动翻页与文本选择互斥，A3） */
function hasTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection?.();
  return selection !== null && selection !== undefined && !selection.isCollapsed;
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
 * - 判定：位移 ≥ 50px，或时长 < 300ms 的快速轻扫（≥ 24px）；纵向位移更大视为
 *   滚动意图，不翻页；不足阈值视为点按；
 * - 冲突消解：存在文本选区时不翻页（选择优先）。
 */
function onPageTouchEnd(event: TouchEvent): void {
  // 双指手势结束后不把残留位移当成滑动翻页
  const wasPinch = pinchStartDistance > 0;
  pinchStartDistance = 0;
  if (wasPinch) return;
  if (hasTextSelection()) return;
  const touch = event.changedTouches[0];
  if (touch === undefined) return;
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const absX = Math.abs(dx);
  if (absX <= Math.abs(dy)) return;
  const elapsed = Date.now() - touchStartAt;
  const far = absX >= TOUCH_SWIPE_THRESHOLD;
  const flick = absX >= TOUCH_FLICK_THRESHOLD && elapsed <= TOUCH_FLICK_MS;
  if (!far && !flick) return;
  swipeEndedAt = Date.now();
  const forward = verticalWriting.value ? dx > 0 : dx < 0;
  if (forward) {
    props.reader.nextPage();
  } else {
    props.reader.prevPage();
  }
}

/**
 * 单页模式点按分区（A3）
 *
 * 先交给注释委托（点击注码 / 回跳符号时由它消费并 preventDefault），未命中时按
 * 位置分区：左右边缘（各 20%）翻页，中部上抛 `tap-center` 由宿主呼出 / 收起 chrome。
 * 存在选区、刚完成滑动、点中链接或表单控件时不分区。
 */
function onPageTap(event: MouseEvent): void {
  onNoteClick(event);
  if (event.defaultPrevented) return;
  if (hasTextSelection()) return;
  if (Date.now() - swipeEndedAt < TAP_SUPPRESS_MS) return;
  const target = event.target;
  if (target instanceof Element) {
    if (target.closest('a[href], button, input, select, textarea, [contenteditable="true"]') !== null) return;
  }
  const host = event.currentTarget;
  if (!(host instanceof HTMLElement)) return;
  const rect = host.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = (event.clientX - rect.left) / rect.width;
  // 直排自右向左续读：左缘继续「下一页」，右缘回「上一页」
  const forwardZone = verticalWriting.value ? ratio <= EDGE_TAP_RATIO : ratio >= 1 - EDGE_TAP_RATIO;
  const backwardZone = verticalWriting.value ? ratio >= 1 - EDGE_TAP_RATIO : ratio <= EDGE_TAP_RATIO;
  if (backwardZone) {
    props.reader.prevPage();
    return;
  }
  if (forwardZone) {
    props.reader.nextPage();
    return;
  }
  emit('tap-center');
}

/**
 * 滚动模式键盘翻页
 *
 * 容器可聚焦（`tabindex="0"`），PageUp / PageDown / 空格 / Home / End 滚动约一屏；
 * 直排（横向滚动）时改按容器宽度推进。带修饰键的组合不拦截。
 */
function onScrollKeydown(event: KeyboardEvent): void {
  if (handleNoteKeydown(event)) return;
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
 * 单页模式下的鼠标滚轮：常规下舞台无原生可滚区，滚轮映射为翻页；
 * 放大超出容器（fitScale > 适配尺寸）时让位原生滚动，否则滚不到页的四边。
 * 取主导轴增量累计（同向累加、反向重新起算，不做正负抵消）；「向下 / 向右拨 =
 * 向前翻页」，与直排、横排的阅读前进方向一致；真翻成一页才 preventDefault。
 */
function onPageWheel(event: WheelEvent): void {
  const root = rootRef.value;
  if (
    root !== null &&
    (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1)
  ) {
    return;
  }
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
  /** 本页分栏数（1~3） */
  columns: number;
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
      columns: props.reader.getPageColumns(i),
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
    } else if (mode === 'scroll-flow') {
      const root = flowRootRef.value;
      if (root !== null) {
        flowScrollTop.value = root.scrollTop;
        flowViewportH.value = root.clientHeight;
      }
      applyInitialFlowPosition();
    } else {
      attachPageObserver();
    }
  },
);

onMounted(() => {
  if (props.mode === 'scroll') {
    attachScrollObserver();
    void nextTick(() => scrollToPage(props.reader.currentPage));
  } else if (props.mode === 'scroll-flow') {
    const root = flowRootRef.value;
    if (root !== null) {
      flowScrollTop.value = root.scrollTop;
      flowViewportH.value = root.clientHeight;
    }
    applyInitialFlowPosition();
  } else {
    attachPageObserver();
  }
});

onBeforeUnmount(() => {
  detachObservers();
  flowRO?.disconnect();
  if (scrollRaf !== 0) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }
  if (flowRaf !== 0) {
    cancelAnimationFrame(flowRaf);
    flowRaf = 0;
  }
});

// 缩放策略 / 页面尺寸 / 对页降级 / 外部倍率变化：按当前模式重算对应缩放。
// 必须 post-flush：fitScale 激活时 is-zoom-fit 类（scrollbar-gutter 预留）随本次
// 渲染才落 DOM，pre-flush 里读 clientWidth 会拿到无槽位的旧可用宽，差一个滚动条宽
// 且不会自纠（gutter 不改根元素 border-box，ResizeObserver 不二次触发）。
watch(
  [() => props.fit, () => props.fitScale, () => props.spread, pageSize, spreadEnabled],
  () => {
    if (props.mode === 'scroll') updateScrollScale();
    else updateScale();
  },
  { flush: 'post' },
);

/* =========================================================================
 * scroll-flow 流式阅读（D5）
 *
 * 与 page / scroll 互不依赖：直接读 IR 分块（reader.getFlowChunks），只序列化
 * 视口窗口内的分块，未挂载分块用估算高度撑起滚动条；挂载后由 ResizeObserver
 * 实测覆盖。位置以「视口首块锚点」回写，刷新 / 换字号后回到原句。
 * ========================================================================= */

/** 流式键盘：PageDown / 空格按视口滚动，Home / End 到首尾（注释快捷键优先） */
function onFlowKeydown(event: KeyboardEvent): void {
  if (handleNoteKeydown(event)) return;
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const el = flowRootRef.value;
  if (el === null) return;
  const step = el.clientHeight;
  if (step <= 0) return;
  let handled = true;
  if (event.key === 'Home') el.scrollTo({ top: 0 });
  else if (event.key === 'End') el.scrollTo({ top: el.scrollHeight });
  else if (event.key === 'PageDown' || event.key === ' ') el.scrollBy({ top: step });
  else if (event.key === 'PageUp') el.scrollBy({ top: -step });
  else if (event.key === 'ArrowDown') el.scrollBy({ top: step * 0.1 });
  else if (event.key === 'ArrowUp') el.scrollBy({ top: -step * 0.1 });
  else handled = false;
  if (handled) event.preventDefault();
}

watch(
  () => props.mode,
  (mode) => {
    if (mode === 'scroll-flow' && !flowSupported.value) {
      emit('mode-fallback', {
        requested: 'scroll-flow',
        effective: 'page',
        reason: facsimileMode.value
          ? 'facsimile'
          : verticalWriting.value
            ? 'vertical-writing'
            : 'facing-spread',
      });
    }
  },
  { immediate: true },
);

/** 流式分块（随文档 / 分块上限缓存） */
const flowChunks = computed<readonly FlowChunk[]>(() =>
  props.reader.getFlowChunks({ maxBlocksPerChunk: props.flowChunkBlocks }),
);

/** 流式版式度量（估算占位高度用） */
const flowMetrics = computed<FlowMetrics>(() => {
  const fsRaw = tokens.value[FONT_SIZE_TOKENS.BODY];
  const fontSize = fsRaw !== undefined ? parseFloat(fsRaw) || 16 : 16;
  return {
    width: pageSize.value.width > 0 ? pageSize.value.width : 640,
    fontSize,
    lineHeight: 1.8,
    paragraphSpacing: fontSize * 0.9,
  };
});

/** 各分块实测高度（挂载后回写；未测量用估算） */
const flowMeasured = ref<Record<number, number>>({});
function estimateChunkHeight(chunk: FlowChunk, index: number): number {
  if (flowMeasured.value[index] !== undefined) return flowMeasured.value[index]!;
  return props.estimateFlowHeight !== undefined
    ? props.estimateFlowHeight(chunk)
    : estimateFlowChunkHeight(chunk, flowMetrics.value);
}
const flowHeights = computed<number[]>(() => flowChunks.value.map(estimateChunkHeight));

/** 分块顶部绝对偏移（累计实测高度） */
const flowOffsets = computed<number[]>(() => {
  const offsets: number[] = [];
  let acc = 0;
  for (const h of flowHeights.value) {
    offsets.push(acc);
    acc += h;
  }
  return offsets;
});

/** 滚动状态 */
const flowScrollTop = ref(0);
const flowViewportH = ref(0);

/** 强制挂载的分块（initialPosition / 注释定位触发），不随滚动卸载 */
const flowForced = ref<Set<number>>(new Set());

/** 流式预取余量：解析 `flowRootMargin`（如 `800px 0px`）取首个数值，缺省 800 */
const flowOverscanPx = computed(() => {
  const raw = props.flowRootMargin;
  if (typeof raw !== 'string') return 800;
  const match = raw.match(/(\d+)px/);
  return match !== null ? Number(match[1]) : 800;
});

const flowWindow = computed(() =>
  resolveMountWindow({
    offsets: flowOffsets.value,
    heights: flowHeights.value,
    scrollTop: flowScrollTop.value,
    viewportHeight: flowViewportH.value,
    overscan: flowOverscanPx.value,
  }),
);
/** 当前需渲染内容（窗口 ∪ 强制）的分块序号集合 */
const flowMounted = computed<Record<number, boolean>>(() => {
  const mounted: Record<number, boolean> = {};
  const { start, end } = flowWindow.value;
  for (let i = start; i <= end; i += 1) mounted[i] = true;
  for (const idx of flowForced.value) mounted[idx] = true;
  return mounted;
});

/** 流式进度文案（无障碍播报） */
const flowProgressText = computed(() => {
  if (flowChunks.value.length === 0) return '';
  const pos = props.reader.getPosition();
  return `已读 ${Math.round((pos?.progress ?? 0) * 100)}%`;
});

/** 单块序列化（text 叶子不输出） */
function flowChunkHtml(index: number): string {
  const chunk = flowChunks.value[index]!;
  return chunk.nodes
    .filter((node) => !isTextNode(node))
    .map((node) => serializeNode(node))
    .join('\n');
}

/** 流式内容排版样式（沿用书册令牌的字体 / 行距 / 书写方向） */
const flowRootStyle = computed(() => buildRootStyle({ tokens: tokens.value, options: layout.value }));

/** 注释定位（流式）：挂载目标块并滚入视口 */
function locateFlowNode(nodeId: string): boolean {
  if (effectiveMode.value !== 'scroll-flow') return false;
  const idx = resolveAnchorChunkIndex(flowChunks.value, nodeId);
  if (idx < 0) return false;
  flowForced.value = new Set(flowForced.value).add(idx);
  void nextTick(() => {
    const root = flowRootRef.value;
    if (root === null) return;
    const target = root.querySelector(`#${cssEscape(nodeId)}`);
    if (target !== null) {
      target.scrollIntoView({ block: 'start' });
    } else {
      root.scrollTop = flowOffsets.value[idx] ?? 0;
    }
  });
  return true;
}

/** CSS 选择器转义（注释 id 可能是树路径，含 `/`） */
function cssEscape(value: string): string {
  if (typeof window !== 'undefined' && typeof window.CSS?.escape === 'function') {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

let flowRaf = 0;
let lastEmittedAnchor = '';
function emitFlowPosition(): void {
  const top = flowScrollTop.value + 1;
  const offsets = flowOffsets.value;
  const heights = flowHeights.value;
  let idx = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i]! + heights[i]! <= top) idx = i;
    else break;
  }
  const chunk = flowChunks.value[idx];
  if (chunk === undefined) return;
  const nodeId = chunk.nodeIds.find((id) => id !== '' && !id.startsWith('flow-')) ?? chunk.nodeIds[0];
  if (nodeId === undefined) return;
  const position = props.reader.getPositionForNode(nodeId);
  if (position === undefined) return;
  if (position.anchor.nodeId !== lastEmittedAnchor) {
    lastEmittedAnchor = position.anchor.nodeId;
    emit('update:position', position);
  }
}

function onFlowScroll(): void {
  const root = flowRootRef.value;
  if (root === null) return;
  flowScrollTop.value = root.scrollTop;
  flowViewportH.value = root.clientHeight;
  if (flowRaf !== 0) return;
  flowRaf = requestAnimationFrame(() => {
    flowRaf = 0;
    emitFlowPosition();
  });
}

/** 初始位置恢复（D5）：挂载目标块并滚到锚点句 */
function applyInitialFlowPosition(): void {
  if (props.initialPosition === undefined) return;
  const parsed =
    typeof props.initialPosition === 'string'
      ? parseReadingPosition(props.initialPosition)
      : props.initialPosition;
  if (parsed === undefined || parsed.anchor?.nodeId === undefined) return;
  const nodeId = parsed.anchor.nodeId;
  const idx = resolveAnchorChunkIndex(flowChunks.value, nodeId);
  if (idx < 0) return;
  flowForced.value = new Set(flowForced.value).add(idx);
  void nextTick(() => {
    const root = flowRootRef.value;
    if (root === null) return;
    const target = root.querySelector(`#${cssEscape(nodeId)}`);
    if (target !== null) {
      target.scrollIntoView({ block: 'start' });
    } else {
      root.scrollTop = flowOffsets.value[idx] ?? 0;
    }
  });
}

/** 实测高度回写：观察所有已挂载分块内容，挂载后写入实测高度 */
let flowRO: ResizeObserver | undefined;
const flowObserved = new WeakMap<Element, number>();
function ensureFlowResizeObserver(): void {
  if (typeof ResizeObserver === 'undefined') return;
  if (flowRO === undefined) {
    flowRO = new ResizeObserver((entries) => {
      let prev = flowHeights.value;
      const next = { ...flowMeasured.value };
      let changed = false;
      for (const entry of entries) {
        const idx = flowObserved.get(entry.target);
        if (idx === undefined) continue;
        const h = (entry.target as HTMLElement).getBoundingClientRect().height;
        if (h > 0 && Math.abs((next[idx] ?? 0) - h) > 0.5) {
          next[idx] = h;
          changed = true;
        }
      }
      if (changed) {
        flowMeasured.value = next;
        // 上方高度变化补偿滚动位置，避免跳动
        const correctedTop = adjustScrollOffset({
          previousHeights: prev,
          heights: flowHeights.value,
          anchorIndex: resolveAnchorChunkIndex(flowChunks.value, lastEmittedAnchor) ?? 0,
          scrollTop: flowRootRef.value?.scrollTop ?? 0,
        });
        const root = flowRootRef.value;
        if (root !== null && Math.abs(correctedTop - root.scrollTop) > 0.5) {
          root.scrollTop = correctedTop;
        }
      }
    });
  }
}

watch(
  flowMounted,
  async () => {
    await nextTick();
    ensureFlowResizeObserver();
    const root = flowRootRef.value;
    if (root === null) return;
    root.querySelectorAll('.bt-flow-chunk__content').forEach((el) => {
      const key = el.getAttribute('data-flow-idx');
      if (key === null) return;
      const idx = Number(key);
      if (!flowObserved.has(el)) {
        flowObserved.set(el, idx);
        flowRO?.observe(el);
      }
    });
  },
  { deep: true },
);

// 进入 scroll-flow 时初始化滚动状态并尝试恢复初始位置
watch(
  effectiveMode,
  async (mode) => {
    if (mode !== 'scroll-flow') return;
    await nextTick();
    const root = flowRootRef.value;
    if (root !== null) {
      flowScrollTop.value = root.scrollTop;
      flowViewportH.value = root.clientHeight;
    }
    applyInitialFlowPosition();
  },
  { immediate: true },
);

/** 页码变化：容器据此同步双文档翻页，宿主可据此持久化页码 */
watch(currentPage, (page) => {
  emit('update:page', page);
});

/** 暴露给宿主 / 容器（BtCompareView 页码同步）：以当前文档口径翻页 */
defineExpose({
  /** 跳转到指定页码（越界由 Reader 内部钳制） */
  goToPage: (page: number): boolean => props.reader.goToPage(page),
  /** 当前页码（0 起） */
  currentPage: (): number => props.reader.currentPage,
});
</script>

<template>
  <!-- 单页模式：一次渲染当前页，等比缩放居中；滚轮 / 键盘 / 触屏滑动 = 翻页 -->
  <div
    v-if="effectiveMode === 'page'"
    ref="rootRef"
    class="bt-book-view bt-book-view--paged"
    :class="{ 'is-vertical': verticalWriting, 'is-zoom-fit': fitScaleOverride !== null }"
    role="document"
    tabindex="0"
    :aria-label="ariaLabel"
    :data-mode-fallback="mode === 'scroll-flow' ? 'paged' : undefined"
    :data-spread="spreadEnabled ? 'facing' : 'single'"
    :data-spread-downgraded="spreadDowngraded ? 'true' : undefined"
    @wheel="onPageWheel"
    @keydown="onPageKeydown"
    @touchstart.passive="onPageTouchStart"
    @touchmove="onPageTouchMove"
    @touchend="onPageTouchEnd"
    @click="onPageTap"
    @pointerover="onNotePointerOver"
    @pointerout="onNotePointerOut"
    @focusin="onNoteFocusIn"
    @focusout="onNoteFocusOut"
  >
    <Transition :name="transitionName" mode="out-in">
      <div :key="pageTurnKey" class="bt-book-view__turn">
    <!-- 对页模式：左右并排渲染当前页对（左页为偶数页），整体按双页宽缩放 -->
    <div v-if="spreadEnabled" class="bt-book-view__spread" :style="spreadStageStyle">
      <div v-for="p in spreadPages" :key="p.index" class="bt-reader-page" :style="spreadPageStyle(p)">
        <div v-if="p.header" class="bt-page-header">{{ p.header }}</div>
        <div
          class="bt-reader-page__flow"
          :class="{ 'is-multicolumn': p.columns > 1 }"
          :style="flowStyleOf(p.columns)"
          v-html="p.html"
        ></div>
        <div v-if="p.notesHtml" class="bt-page-notes-host" v-html="p.notesHtml"></div>
        <div v-if="p.gutterHtml" class="bt-page-gutter-host" v-html="p.gutterHtml"></div>
        <footer v-if="p.footer" class="bt-page-footer">{{ p.footer }}</footer>
        <footer v-else-if="p.showPageNumber" class="bt-page-number">{{ p.numberText }}</footer>
      </div>
    </div>
    <div v-else class="bt-book-view__stage" :style="stageStyle">
      <div class="bt-reader-page" :style="scaledPageStyle">
        <div v-if="currentChrome?.header" class="bt-page-header">{{ currentChrome.header }}</div>
        <div
          class="bt-reader-page__flow"
          :class="{ 'is-multicolumn': currentPageColumns > 1 }"
          :style="flowStyleOf(currentPageColumns)"
          v-html="pageHtml"
        ></div>
        <div v-if="pageNotesHtml" class="bt-page-notes-host" v-html="pageNotesHtml"></div>
        <div v-if="gutterHtml" class="bt-page-gutter-host" v-html="gutterHtml"></div>
        <footer v-if="currentChrome?.footer" class="bt-page-footer">{{ currentChrome.footer }}</footer>
        <footer
          v-else-if="currentChrome === undefined && showPageNumber"
          class="bt-page-number"
        >{{ pageNumberText }}</footer>
      </div>
      </div>
      </div>
    </Transition>
    <!-- 页码播报：视觉隐藏，读屏在翻页后朗读当前页 -->
    <span class="bt-sr-only" aria-live="polite">{{ pageNumberText }} / 共 {{ totalPages }} 页</span>
    <BtNotePreview :preview="notePreview" />
  </div>

  <!-- 连续滚动模式：窗口化渲染可见页，滚动 ↔ 页态双向同步（直排时沿水平自右向左） -->
  <div
    v-else-if="effectiveMode === 'scroll'"
    ref="scrollerRef"
    class="bt-book-view bt-book-view--scroll"
    :class="{ 'bt-book-view--scroll-x': verticalWriting, 'is-zoom-fit': fitScaleOverride !== null }"
    tabindex="0"
    :aria-label="ariaLabel"
    @scroll="onScroll"
    @wheel="onWheel"
    @keydown="onScrollKeydown"
    @click="onNoteClick"
    @pointerover="onNotePointerOver"
    @pointerout="onNotePointerOut"
    @focusin="onNoteFocusIn"
    @focusout="onNoteFocusOut"
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
          <div
            class="bt-reader-page__flow"
            :class="{ 'is-multicolumn': page.columns > 1 }"
            :style="flowStyleOf(page.columns)"
            v-html="page.html"
          ></div>
          <div v-if="page.notesHtml" class="bt-page-notes-host" v-html="page.notesHtml"></div>
          <div v-if="page.gutterHtml" class="bt-page-gutter-host" v-html="page.gutterHtml"></div>
          <footer v-if="page.footer" class="bt-page-footer">{{ page.footer }}</footer>
          <footer v-else-if="page.showPageNumber" class="bt-page-number">{{ page.numberText }}</footer>
        </div>
      </div>
    </div>
    <BtNotePreview :preview="notePreview" />
  </div>

  <!-- 流式阅读模式（D5）：按章分块、视口窗口懒挂载、锚点进度持久化 -->
  <div
    v-else
    ref="flowRootRef"
    class="bt-book-view bt-book-view--flow"
    :class="{ 'is-vertical': verticalWriting }"
    tabindex="0"
    :aria-label="ariaLabel"
    :data-mode-fallback="mode === 'scroll-flow' ? 'paged' : undefined"
    @scroll="onFlowScroll"
    @keydown="onFlowKeydown"
    @click="onNoteClick"
    @pointerover="onNotePointerOver"
    @pointerout="onNotePointerOut"
    @focusin="onNoteFocusIn"
    @focusout="onNoteFocusOut"
  >
    <div class="bt-book-view__flow">
      <section
        v-for="(chunk, i) in flowChunks"
        :key="chunk.key"
        class="bt-flow-chunk"
        :data-flow-key="chunk.key"
        :aria-label="chunk.title ?? '正文'"
      >
        <div
          v-if="flowMounted[i]"
          class="bt-reader-page__flow bt-flow-chunk__content"
          :data-flow-idx="i"
          :style="flowRootStyle"
          v-html="flowChunkHtml(i)"
        ></div>
        <div
          v-else
          class="bt-flow-skeleton"
          :style="{ height: `${flowHeights[i]}px` }"
          aria-hidden="true"
        ></div>
      </section>
    </div>
    <span class="bt-sr-only" aria-live="polite">{{ flowProgressText }}</span>
    <BtNotePreview :preview="notePreview" />
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
  width: 100%;
  height: 100%;
  /* 缩放后超出容器时可滚达四边（fitScale > 适配尺寸 / fit none 原尺寸大页）；
     常规 contain 适配不溢出，不会真的冒出滚动条 */
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.25) transparent;
}

/* 居中改用 auto 外边距：空间富余时仍居中；溢出时 auto 退化为 0（起点锚定），
   若用 align/justify center，超出端会被滚到。sr-only / 注释预览不在流内 */
.bt-book-view--paged > .bt-book-view__turn {
  flex: none;
  margin: auto;
}

/* fitScale 激活时预留纵向滚动条槽位：clientWidth 从首帧就含槽位宽，
   不随「缩放后是否溢出」二次变化，适宽倍率落地即精确贴满 */
.bt-book-view.is-zoom-fit {
  scrollbar-gutter: stable;
}

/*
 * 多栏正文流：分页器已按「页容量 × 栏数」装箱，CSS 只负责顺序填栏。
 * 子块 `break-inside: avoid` 防止浏览器二次拆分已按行切好的片段。
 */
.bt-reader-page__flow.is-multicolumn {
  column-fill: auto;
}

.bt-reader-page__flow.is-multicolumn > * {
  break-inside: avoid;
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

/* 对页：容器给出缩放后的双页版面，两页绝对定位在左右半区 */
.bt-book-view__spread {
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

/* ---- 翻页动效（D5） ---- */
.bt-book-view__turn {
  position: relative;
}

.bt-turn-enter-active,
.bt-turn-leave-active {
  transition:
    transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 0.22s ease;
  will-change: transform, opacity;
}

/* 横排：新页自右向左滑入、旧页同向滑出 */
.bt-book-view--paged:not(.is-vertical) .bt-turn-enter-from {
  transform: translateX(12%);
  opacity: 0.6;
}
.bt-book-view--paged:not(.is-vertical) .bt-turn-leave-to {
  transform: translateX(-12%);
  opacity: 0;
}

/* 直排：翻页方向改为自下而上 */
.bt-book-view--paged.is-vertical .bt-turn-enter-from {
  transform: translateY(12%);
  opacity: 0.6;
}
.bt-book-view--paged.is-vertical .bt-turn-leave-to {
  transform: translateY(-12%);
  opacity: 0;
}

.bt-fade-enter-active,
.bt-fade-leave-active {
  transition: opacity 0.22s ease;
}
.bt-fade-enter-from,
.bt-fade-leave-to {
  opacity: 0;
}

/* 系统「减少动态效果」：彻底关闭过渡，仍瞬时切换 */
@media (prefers-reduced-motion: reduce) {
  .bt-turn-enter-active,
  .bt-turn-leave-active,
  .bt-fade-enter-active,
  .bt-fade-leave-active {
    transition: none;
  }
}

/* ---- 流式阅读（D5） ---- */
.bt-book-view--flow {
  display: block;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.25) transparent;
}
.bt-book-view--flow:focus {
  outline: none;
}
.bt-book-view--flow:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
.bt-book-view__flow {
  max-width: 38em;
  margin: 0 auto;
  padding: 24px 16px;
}
.bt-flow-chunk {
  display: block;
}
.bt-flow-chunk__content {
  transition: opacity 0.12s ease;
}
/* 未挂载分块：低对比骨架占位，行高与真实一致，无扫光动效 */
.bt-flow-skeleton {
  border-radius: 4px;
  background: currentColor;
  opacity: 0.06;
  margin: 0.9em 0;
  pointer-events: none;
}
.bt-book-view--flow.is-vertical .bt-book-view__flow {
  writing-mode: vertical-rl;
}

@media (prefers-reduced-motion: reduce) {
  .bt-flow-chunk__content {
    transition: none;
  }
}
</style>
