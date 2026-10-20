/**
 * Reader 阅读器门面
 *
 * 无 DOM 的阅读状态机：聚合「文档 + 布局 + 分页 + 目录」，
 * 提供翻页、跳转、进度与事件；渲染交给 vue/react 封装或使用方。
 */
import {
  NODE_TYPES,
  DEFAULT_THEME,
  createBlockAnchor,
  createEventBus,
  isTextNode,
  type BibliotypeEventMap,
  type BookDocument,
  type BookNode,
  type EventBus,
} from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  mergeLayoutOptions,
  paginate,
  resolvePageMainSize,
  resolveBottomSlack,
  sliceNodeByCharRange,
  type BlockAxis,
  type LayoutOptions,
  type MeasurableBlock,
  type PageGutterTexts,
  type PageItem,
  type PaginatedPage,
} from '@bibliotype/layout';
import {
  DEFAULT_MEASURE_CONTEXT,
  defaultEstimator,
  collectNodeText,
  extractBlocksIndexed,
  isLeafBlock,
  type BlockMeasureContext,
  type BlockSizeEstimator,
} from './document-blocks.js';
import { findNodeById } from './find-node.js';
import { countOutlineItems, extractOutline, type OutlineItem } from './outline.js';
import { formatPageNumber, type PageNumberStyle } from './page-numbering.js';
import {
  isNodeInCover,
  isPageChromeEnabled,
  resolveChapterTitleForNode,
  resolvePageChromeTexts,
  type PageChromeTexts,
} from './page-chrome.js';
import { resolvePageGutterTexts } from './page-gutter.js';
import {
  buildMatchExcerpt,
  buildSearchPattern,
  collectSubtreeNodes,
  findMatchRanges,
  type ReaderSearchOptions,
  type ReaderSearchResult,
} from './search.js';
import {
  createReadingPosition,
  parseReadingPosition,
  type ReadingPosition,
} from './position.js';

export type { ReaderSearchOptions, ReaderSearchResult, TextMatchRange } from './search.js';
export type { ReadingPosition } from './position.js';

/** 重排参数 */
export interface RepaginateOptions {
  /** 布局配置局部覆盖 */
  layout?: Partial<LayoutOptions>;
  /** 每页可用主轴尺寸（px） */
  pageMainSize?: number;
  /** 页底溢出（px）覆盖；传 null 关闭，传 undefined 保持当前值 */
  bottomSlack?: number | null;
  /** 估算上下文局部覆盖（字号/行距变化时联动重算行尺寸） */
  measure?: Partial<BlockMeasureContext>;
  /** 实测块尺寸映射；传 null 清空回退估算，传 undefined 保持当前映射 */
  blockSizes?: ReadonlyMap<string, number> | null;
  /**
   * 块 → 每行起始字符偏移表（DOM 实测）
   *
   * 供 getPageFragments 把跨页块按真实行切成片段；缺省回退 charsPerLine 估算。
   */
  lineOffsets?: ReadonlyMap<string, number[]> | null;
  /** 块 id → 真实行高（px，DOM 实测，不含块间距）；与 lineOffsets 同源产出 */
  lineSizes?: ReadonlyMap<string, number> | null;
  /** 块 id → 逐行主轴尺寸（px，DOM 实测；注音等行高不等时按行判页）；与 lineSizes 同源 */
  lineMainSizes?: ReadonlyMap<string, number[]> | null;
  /**
   * 块 id → 块体高（px，DOM 实测自身盒高，不含外边距）；与 blockSizes 同源产出
   *
   * blockSizes 是「推进量」（体高 + 与下一块的折叠间距）；paginate 按体高计
   * 「往本页追加一块」的代价，消除每页重复扣一份间距造成的页底空白
   * （见 extractBlocks 的 bodySizes 说明）。
   */
  bodySizes?: ReadonlyMap<string, number> | null;
  /** 排文主轴；传 null 清空回退横排（undefined 保持当前值） */
  axis?: BlockAxis | null;
}

/** Reader 配置 */
export interface ReaderOptions {
  /** 布局配置（局部覆盖，基于 DEFAULT_LAYOUT_OPTIONS 合并） */
  layout?: Partial<LayoutOptions>;
  /** 每页可用主轴尺寸（px）；默认按页面尺寸与标准页边距推导 */
  pageMainSize?: number;
  /**
   * 页底溢出（px）；缺省按「布局 + 令牌 + 行高」推导（`resolveBottomSlack`）
   *
   * 显式传入可保证与调用方的版心口径一致（如 demo 自行解析 tokens 时）；
   * 传 0 关闭溢出（行为与引入该能力前一致）。
   */
  bottomSlack?: number;
  /** 估算上下文覆盖（每行字符数/行高/块间距） */
  measure?: Partial<BlockMeasureContext>;
  /** 自定义块尺寸估算器 */
  estimator?: BlockSizeEstimator;
  /**
   * 按块 id 的实测主轴尺寸（px）
   *
   * 由渲染层 DOM 实测产出；命中且为正的块采用实测值，否则回退 estimator 估算。
   */
  blockSizes?: ReadonlyMap<string, number>;
  /**
   * 块 → 每行起始字符偏移表（DOM 实测）；供 getPageFragments 按真实行切片
   */
  lineOffsets?: ReadonlyMap<string, number[]>;
  /** 块 id → 真实行高（px，DOM 实测，不含块间距）；与 lineOffsets 同源产出 */
  lineSizes?: ReadonlyMap<string, number>;
  /**
   * 块 id → 逐行主轴尺寸（px，DOM 实测，长度 = 真实行数）
   *
   * 注音（ruby）等行内增高使同一段落各行行盒不等高时，分页按逐行累加判页，
   * 不再用均高近似（均高会让注音行溢出页心或把高行压成矮行）。
   */
  lineMainSizes?: ReadonlyMap<string, number[]>;
  /** 块 id → 块体高（px，DOM 实测，不含外边距）；供 paginate 按体高判页 */
  bodySizes?: ReadonlyMap<string, number>;
  /**
   * 排文主轴（直排传 `'column'`，缺省 `'row'`）
   *
   * 只影响块上的 `axis` 标注与下游对 `lineSize` 的解释，不影响分页算术。
   */
  axis?: BlockAxis;
  /**
   * 主题令牌值表（缺省 DEFAULT_THEME）
   *
   * page-margin / page-border 令牌参与默认每页主轴尺寸推导（resolvePageMainSize），
   * 与编辑画布 / PDF 导出同源；未传 pageMainSize 且主题含版框时必须传入，
   * 否则兜底口径按无边框计算。
   */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 外部事件总线（与 core 实例共享）；默认自建 */
  events?: EventBus<BibliotypeEventMap>;
  /**
   * 脚注浮注（页底注区）
   *
   * 开启后脚注块不进正文流，落所在页的页底注区：正文容量按注区高度收缩，
   * 注区超过 `noteMaxRatio` 时整条续到下一页页底（跨页续注）。
   */
  footnoteFloat?: boolean;
  /** 页底注区最多占页面主轴的多少（0~1，缺省 0.4；仅 `footnoteFloat` 生效） */
  noteMaxRatio?: number;
}

/** 默认每页主轴尺寸（横排取内容区高，竖排取内容区宽；含页边距与版框边框扣除） */
function defaultPageMainSize(
  layout: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  return resolvePageMainSize(layout, tokens);
}

/** 阅读器状态机 */
export class Reader {
  /** 事件总线（document:load / page:change / toc:ready） */
  readonly events: EventBus<BibliotypeEventMap>;

  private doc: BookDocument | undefined;
  private options: LayoutOptions;
  private pageMainSize: number;
  /** 页底溢出（px）；显式给定时以外部值为准（与调用方版心口径对齐） */
  private bottomSlack: number | undefined;
  /** 主题令牌值表（默认每页主轴尺寸推导用） */
  private readonly tokens: Readonly<Record<string, string | undefined>>;
  private readonly estimator: BlockSizeEstimator;
  private measure: BlockMeasureContext;
  /** 实测块尺寸映射（DOM 实测）；缺省回退估算 */
  private blockSizes: ReadonlyMap<string, number> | undefined;
  /** 块 → 每行起始字符偏移表（DOM 实测）；供 getPageFragments 按真实行切片 */
  private lineOffsets: ReadonlyMap<string, number[]> | undefined;
  /** 块 id → 真实行高（px，DOM 实测，不含块间距） */
  private lineSizes: ReadonlyMap<string, number> | undefined;
  /** 块 id → 逐行主轴尺寸（px，DOM 实测；注音行高不等时按行判页） */
  private lineMainSizes: ReadonlyMap<string, number[]> | undefined;
  /** 块 id → 块体高（px，DOM 实测，不含外边距） */
  private bodySizes: ReadonlyMap<string, number> | undefined;
  /** 排文主轴（直排为 column）：透传给 extractBlocks，仅供下游解释 lineSize 语义 */
  private axis: BlockAxis | undefined;
  /** 脚注浮注：脚注块不进正文流，落所在页页底注区 */
  private readonly footnoteFloat: boolean;
  /** 页底注区上限（占页面容量比例，已夹到 0.05~1） */
  private readonly noteMaxRatio: number;

  private blocks: MeasurableBlock[] = [];
  private pages: PaginatedPage[] = [];
  private outlineItems: OutlineItem[] = [];
  private pageIndex = 0;
  private readonly pageByBlockId = new Map<string, number>();
  /** 块 id → 源节点（分页管线同源产出，免逐块全树查找） */
  private nodeById: ReadonlyMap<string, BookNode> = new Map();
  /** pageMainSize 是否由外部显式给定（否则随布局变化重算） */
  private pageMainSizeExplicit: boolean;

  constructor(options: ReaderOptions = {}) {
    this.options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, options.layout ?? {});
    this.tokens = options.tokens ?? DEFAULT_THEME;
    this.pageMainSizeExplicit = options.pageMainSize !== undefined;
    this.pageMainSize = options.pageMainSize ?? defaultPageMainSize(this.options, this.tokens);
    this.bottomSlack = options.bottomSlack;
    this.measure = { ...DEFAULT_MEASURE_CONTEXT, ...options.measure };
    this.estimator = options.estimator ?? defaultEstimator;
    this.blockSizes = options.blockSizes;
    this.lineOffsets = options.lineOffsets;
    this.lineSizes = options.lineSizes;
    this.lineMainSizes = options.lineMainSizes;
    this.bodySizes = options.bodySizes;
    this.axis = options.axis;
    this.footnoteFloat = options.footnoteFloat === true;
    // 与 paginate 的夹取口径一致：注区至少 5%（保证有空间），至多占满一页
    this.noteMaxRatio = Math.min(1, Math.max(0.05, options.noteMaxRatio ?? 0.4));
    this.events = options.events ?? createEventBus();
  }

  /** 排文主轴（直排为 `'column'`；缺省 `'row'`） */
  get blockAxis(): BlockAxis {
    return this.axis ?? 'row';
  }

  /* ---------------- 文档与重排 ---------------- */

  /** 载入文档：提取块 → 分页 → 建目录 → 触发事件 */
  loadDocument(doc: BookDocument): void {
    this.doc = doc;
    this.pageIndex = 0;
    this.outlineItems = extractOutline(doc.root);
    this.events.emit('document:load', { document: doc });

    this.repaginate();

    this.events.emit('toc:ready', { itemCount: countOutlineItems(this.outlineItems) });
  }

  /**
   * 重新分页（配置变更：换字号/页面尺寸/估算器上下文）
   *
   * 保持当前页（页码越界时收敛到末页）。
   */
  repaginate(overrides: RepaginateOptions = {}): void {
    if (this.doc === undefined) {
      throw new Error('Reader 尚未载入文档，无法重排。');
    }
    if (overrides.layout !== undefined) {
      this.options = mergeLayoutOptions(this.options, overrides.layout);
      // 未显式给定每页主轴尺寸时，随页面尺寸 / 书写方向变化重算
      if (!this.pageMainSizeExplicit) {
        this.pageMainSize = defaultPageMainSize(this.options, this.tokens);
      }
    }
    if (overrides.pageMainSize !== undefined) {
      this.pageMainSize = overrides.pageMainSize;
      this.pageMainSizeExplicit = true;
    }
    if (overrides.bottomSlack !== undefined) {
      this.bottomSlack = overrides.bottomSlack ?? undefined;
    }
    if (overrides.measure !== undefined) {
      this.measure = { ...this.measure, ...overrides.measure };
    }
    if (overrides.blockSizes !== undefined) {
      this.blockSizes = overrides.blockSizes ?? undefined;
    }
    if (overrides.lineOffsets !== undefined) {
      this.lineOffsets = overrides.lineOffsets ?? undefined;
    }
    if (overrides.lineSizes !== undefined) {
      this.lineSizes = overrides.lineSizes ?? undefined;
    }
    if (overrides.lineMainSizes !== undefined) {
      this.lineMainSizes = overrides.lineMainSizes ?? undefined;
    }
    if (overrides.bodySizes !== undefined) {
      this.bodySizes = overrides.bodySizes ?? undefined;
    }
    if (overrides.axis !== undefined) {
      this.axis = overrides.axis ?? undefined;
    }

    const extracted = extractBlocksIndexed(this.doc, {
      estimator: this.estimator,
      context: this.measure,
      blockSizes: this.blockSizes,
      lineOffsets: this.lineOffsets,
      lineSizes: this.lineSizes,
      lineMainSizes: this.lineMainSizes,
      bodySizes: this.bodySizes,
      axis: this.axis,
    });
    this.nodeById = extracted.nodeById;
    this.blocks = this.footnoteFloat
      ? extracted.blocks.map((block) => {
          // 仅脚注浮注：尾注（书末）/ 边注（版心外侧）仍按正文流就地排
          const node = extracted.nodeById.get(block.id);
          return node?.type === NODE_TYPES.FOOTNOTE ? { ...block, floatToBottom: true } : block;
        })
      : extracted.blocks;
    const result = paginate(this.blocks, {
      pageMainSize: this.pageMainSize,
      bottomSlack: this.bottomSlackPx,
      ...(this.footnoteFloat ? { noteArea: { maxRatio: this.noteMaxRatio } } : {}),
    });
    this.pages = result.pages;

    this.pageByBlockId.clear();
    for (const page of result.pages) {
      for (const block of page.blocks) {
        this.pageByBlockId.set(block.id, page.index);
      }
      // 页底注块同样可定位（脚注跳转 / 阅读位置锚点落在注文上）
      for (const item of page.notes ?? []) {
        this.pageByBlockId.set(item.block.id, page.index);
      }
    }
    this.indexNodeAnchors();

    this.pageIndex = Math.min(this.pageIndex, Math.max(0, result.totalPages - 1));
    this.events.emit('page:change', {
      pageIndex: this.pageIndex,
      totalPages: this.totalPages,
    });
  }

  /* ---------------- 状态读取 ---------------- */

  /** 当前文档 */
  get document(): BookDocument | undefined {
    return this.doc;
  }

  /** 当前布局配置 */
  get layout(): LayoutOptions {
    return this.options;
  }

  /**
   * 生效的页底溢出（px）
   *
   * 未显式给定时按「布局 + 令牌 + 行高」推导（行高取估算上下文的正文行高，
   * 与页底残留的度量口径一致），并截断到不压页码带。
   */
  get bottomSlackPx(): number {
    return (
      this.bottomSlack ??
      resolveBottomSlack(this.options, this.tokens, this.measure.lineSize)
    );
  }

  /** 当前每页可用主轴尺寸（px）；随布局重算，供使用方对齐编辑态分页 */
  get pageMainSizePx(): number {
    return this.pageMainSize;
  }

  /** 当前页（自 0 起） */
  get currentPage(): number {
    return this.pageIndex;
  }

  /** 总页数 */
  get totalPages(): number {
    return this.pages.length;
  }

  /** 阅读进度（0~1，按已读至的页尾计） */
  get progress(): number {
    if (this.pages.length === 0) return 0;
    return (this.pageIndex + 1) / this.pages.length;
  }

  /** 目录树 */
  get outline(): readonly OutlineItem[] {
    return this.outlineItems;
  }

  /** 全部块（分页前） */
  get allBlocks(): readonly MeasurableBlock[] {
    return this.blocks;
  }

  /** 分页结果 */
  get pagination(): readonly PaginatedPage[] {
    return this.pages;
  }

  /** 取某页的块 */
  getPageBlocks(pageIndex: number): readonly MeasurableBlock[] {
    return this.pages[pageIndex]?.blocks ?? [];
  }

  /** 取某页的节点（块 id 经块索引还原；未载入或未命中时缺省） */
  getPageNodes(pageIndex: number): readonly BookNode[] {
    if (this.doc === undefined) return [];
    const nodes: BookNode[] = [];
    for (const block of this.getPageBlocks(pageIndex)) {
      const node = this.nodeOf(block.id);
      if (node !== undefined) nodes.push(node);
    }
    return nodes;
  }

  /**
   * 取某页的页底注条目（脚注浮注开启时；含跨页续注片段）
   *
   * 注条目不占正文 `items` / `usedMainSize`，渲染侧排在版心底部注区；
   * 未开启 `footnoteFloat` 或该页无注时返回空数组。
   */
  getPageNoteItems(pageIndex: number): readonly PageItem[] {
    return this.pages[pageIndex]?.notes ?? [];
  }

  /** 取某页的页底注节点（注条目块 id 经块索引还原） */
  getPageNotes(pageIndex: number): readonly BookNode[] {
    if (this.doc === undefined) return [];
    const nodes: BookNode[] = [];
    for (const item of this.getPageNoteItems(pageIndex)) {
      const node = this.nodeOf(item.block.id);
      if (node !== undefined) nodes.push(node);
    }
    return nodes;
  }

  /** 某页页底注区占用的主轴尺寸（px；未开启浮注或无注时为 0） */
  getPageNoteMainSize(pageIndex: number): number {
    return this.pages[pageIndex]?.noteMainSize ?? 0;
  }

  /**
   * 某页注区是否承接上一页溢出的注释（跨页续注）
   *
   * 供渲染侧决定是否在注区顶部输出「续前页」。未开启浮注、首页或无续注时为 false。
   */
  isPageNotesContinued(pageIndex: number): boolean {
    return this.pages[pageIndex]?.notesCarried === true;
  }

  /**
   * 取某页的「行片段」节点（纸书跨页续排的渲染契约）
   *
   * 与 getPageNodes 的区别：跨页拆分的块只输出本页应显示的那部分文本
   * （按 page.items 的 fromLine / lineCount 切片），未拆块原样返回。
   * 预览 / 导出按此渲染即可消除整段重复与裁切。行→字符偏移优先用
   * DOM 实测 lineOffsets，缺省回退 charsPerLine 估算。
   */
  getPageFragments(pageIndex: number): readonly BookNode[] {
    if (this.doc === undefined) return [];
    const page = this.pages[pageIndex];
    if (page === undefined) return [];
    const nodes: BookNode[] = [];
    for (const item of page.items) {
      const node = this.nodeOf(item.block.id);
      if (node === undefined) continue;
      // lineCount === 0：未拆分（整块），原样返回
      if (item.lineCount === 0) {
        nodes.push(node);
        continue;
      }
      const { from, to } = this.charRangeForLines(item.block.id, item.fromLine, item.lineCount);
      nodes.push(sliceNodeByCharRange(node, from, to));
    }
    return nodes;
  }

  /**
   * 块 id → 源节点
   *
   * 优先用分页时同源产出的块索引（O(1)）；未命中（如文档在重排前被改写）
   * 回退全树查找，保持旧行为。
   */
  private nodeOf(id: string): BookNode | undefined {
    return (
      this.nodeById.get(id) ??
      (this.doc === undefined ? undefined : findNodeById(this.doc.root, id))
    );
  }

  /** 行区间 [fromLine, fromLine+lineCount) → 字符半开区间（实测优先，回退估算） */
  private charRangeForLines(
    id: string,
    fromLine: number,
    lineCount: number,
  ): { from: number; to: number } {
    const offsets = this.lineOffsets?.get(id);
    if (offsets !== undefined && offsets.length > 0) {
      const from = offsets[fromLine] ?? offsets[offsets.length - 1] ?? 0;
      const to = offsets[fromLine + lineCount] ?? Number.MAX_SAFE_INTEGER;
      return { from, to };
    }
    const cpl = Math.max(1, this.measure.charsPerLine);
    return { from: fromLine * cpl, to: (fromLine + lineCount) * cpl };
  }

  /** 当前页的展示页码（按配置的页码样式） */
  formatCurrentPageNumber(): string {
    const style = this.options.pageNumberStyle as PageNumberStyle;
    return formatPageNumber(this.pageIndex + 1, style);
  }

  /* ---------------- 页眉 / 页脚 ---------------- */

  /** 是否启用页眉 / 页脚（false 时渲染层走「仅页码」老路径） */
  get pageChromeEnabled(): boolean {
    return isPageChromeEnabled(this.options.pageChrome);
  }

  /** 该页是否属于封面（书籍惯例：封面不标页码与页眉页脚） */
  isCoverPage(pageIndex: number = this.pageIndex): boolean {
    if (this.doc === undefined) return false;
    const first = this.pages[pageIndex]?.blocks[0];
    if (first === undefined) return false;
    return isNodeInCover(this.doc.root, first.id);
  }

  /** 页首块所属章名（页眉 `chapterTitle` 字段；无结构标题时为空串） */
  getPageChapterTitle(pageIndex: number = this.pageIndex): string {
    if (this.doc === undefined) return '';
    const first = this.pages[pageIndex]?.blocks[0];
    if (first === undefined) return '';
    return resolveChapterTitleForNode(this.doc.root, first.id);
  }

  /**
   * 页眉 / 页脚文本（按 `layout.pageChrome` 解析）
   *
   * 返回 `undefined` 表示**不启用**（配置缺失或该页是封面）——渲染层据此
   * 回退到「页脚仅页码」的老行为，保证未配置页眉页脚的旧文档逐像素不变。
   */
  getPageChromeTexts(pageIndex: number = this.pageIndex): PageChromeTexts | undefined {
    const chrome = this.options.pageChrome;
    if (this.doc === undefined || chrome === undefined || !isPageChromeEnabled(chrome)) {
      return undefined;
    }
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pages.length) {
      return undefined;
    }
    if (this.isCoverPage(pageIndex)) return undefined;
    const style = this.options.pageNumberStyle as PageNumberStyle;
    return resolvePageChromeTexts({
      chrome,
      pageIndex,
      bookTitle: this.doc.metadata.title,
      chapterTitle: this.getPageChapterTitle(pageIndex),
      pageNumberText: formatPageNumber(pageIndex + 1, style),
    });
  }

  /**
   * 版心（书口）竖写文本（按 `layout.facsimile.gutter` 解析）
   *
   * 返回 `undefined` 表示**不渲染版心**：未启用古籍仿真版式 / 未配置版心 /
   * 该页是封面 / 页序非法。与 `getPageChromeTexts` 并列且互不影响——
   * 未启用仿真版式的文档（含「古籍直排」）恒为 `undefined`。
   */
  getPageGutterTexts(pageIndex: number = this.pageIndex): PageGutterTexts | undefined {
    const gutter = this.options.facsimile?.gutter;
    if (this.doc === undefined || gutter === undefined) {
      return undefined;
    }
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pages.length) {
      return undefined;
    }
    if (this.isCoverPage(pageIndex)) return undefined;
    const style = this.options.pageNumberStyle as PageNumberStyle;
    return resolvePageGutterTexts({
      bookTitle: this.doc.metadata.title,
      chapterTitle: this.getPageChapterTitle(pageIndex),
      pageNumberText: formatPageNumber(pageIndex + 1, style),
    });
  }

  /**
   * 全文搜索（按块级文本）
   *
   * 逐页扫描叶块文本，返回带页号与上下文摘录的结果；`nodeId` 可直接传给 goToNode。
   *
   * - 缺省为**字面匹配 + 大小写敏感**（与历史行为一致）；
   * - `regex: true` 把查询串按正则解释（非法正则抛 `RangeError`）；
   * - `caseSensitive: false` 忽略大小写；
   * - `scope` 限定到某结构节点的子树（「本章内查找」）；
   * - `ranges: true` 时返回命中区间（相对块纯文本），供渲染层高亮；
   * - 跨页拆分的同一块只报告一次（首次出现页）。
   */
  search(query: string, options: ReaderSearchOptions = {}): ReaderSearchResult[] {
    const keyword = query.trim();
    if (keyword === '' || this.doc === undefined) return [];
    const limit = options.limit ?? 50;
    const contextLength = options.contextLength ?? 12;
    const maxRangesPerBlock = options.maxRangesPerBlock ?? 20;
    const pattern = buildSearchPattern(keyword, {
      regex: options.regex,
      caseSensitive: options.caseSensitive,
    });

    const scopeNodes =
      options.scope === undefined ? undefined : collectSubtreeNodes(this.doc.root, options.scope);
    if (options.scope !== undefined && scopeNodes === undefined) {
      return [];
    }

    const results: ReaderSearchResult[] = [];
    const seen = new Set<string>();
    for (const page of this.pages) {
      // 页底注（脚注浮注）不进 page.blocks，单独并入扫描，注文同样可搜
      const pageBlocks = [
        ...page.blocks,
        ...(page.notes === undefined ? [] : page.notes.map((item) => item.block)),
      ];
      for (const block of pageBlocks) {
        if (seen.has(block.id)) continue;
        const node = this.nodeOf(block.id);
        if (node === undefined) continue;
        if (scopeNodes !== undefined && !scopeNodes.has(node)) continue;
        const text = collectNodeText(node);
        if (text === '') continue;

        const { count, ranges } = findMatchRanges(text, pattern, maxRangesPerBlock);
        const first = ranges[0];
        if (count === 0 || first === undefined) continue;

        seen.add(block.id);
        const result: ReaderSearchResult = {
          nodeId: block.id,
          pageIndex: page.index,
          blockType: node.type,
          excerpt: buildMatchExcerpt(text, first.from, first.to, contextLength),
          matchCount: count,
        };
        if (options.ranges === true) {
          result.ranges = ranges;
        }
        results.push(result);
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  /* ---------------- 阅读位置 ---------------- */

  /**
   * 当前位置快照（锚点 = 当前页首块）
   *
   * 页码只作锚点失效时的回退；`savedAt` 由调用方注入（库内不取当前时间）。
   * 未载入文档 / 空文档返回 `undefined`。
   */
  getPosition(options: { savedAt?: string } = {}): ReadingPosition | undefined {
    const page = this.pages[this.pageIndex];
    if (page === undefined) return undefined;
    const firstId = page.items[0]?.block.id ?? page.blocks[0]?.id;
    if (firstId === undefined) return undefined;
    return createReadingPosition(
      createBlockAnchor(firstId),
      this.pageIndex,
      this.progress,
      options.savedAt,
    );
  }

  /**
   * 恢复阅读位置
   *
   * 优先按锚点定位（版式变化后仍准确）；锚点目标已被删除时回退到快照页码。
   *
   * @param position 位置快照对象或其 JSON 字符串
   * @returns 是否已定位到有效页（空文档返回 false）
   */
  restorePosition(position: ReadingPosition | string): boolean {
    if (this.pages.length === 0) return false;
    const parsed = typeof position === 'string' ? parseReadingPosition(position) : position;
    const target = this.pageByBlockId.get(parsed.anchor.nodeId);
    if (target !== undefined) {
      return this.goToPage(target) || target === this.pageIndex;
    }
    const fallback = Math.min(parsed.pageIndex, this.pages.length - 1);
    if (fallback < 0) return false;
    return this.goToPage(fallback) || fallback === this.pageIndex;
  }

  /* ---------------- 导航 ---------------- */

  /** 下一页 */
  nextPage(): boolean {
    return this.goToPage(this.pageIndex + 1);
  }

  /** 上一页 */
  prevPage(): boolean {
    return this.goToPage(this.pageIndex - 1);
  }

  /**
   * 跳转页码（越界返回 false 且不移动）
   */
  goToPage(pageIndex: number): boolean {
    if (pageIndex < 0 || pageIndex >= this.pages.length || pageIndex === this.pageIndex) {
      return false;
    }
    this.pageIndex = pageIndex;
    this.events.emit('page:change', {
      pageIndex: this.pageIndex,
      totalPages: this.totalPages,
    });
    return true;
  }

  /**
   * 按节点 id 跳转到所在页
   *
   * 支持叶块 id 与结构容器 id（容器定位到其首叶所在页）。
   *
   * @returns 找到并跳转成功为 true；节点无 id / 不在块序列中为 false
   */
  goToNode(nodeId: string): boolean {
    const target = this.pageByBlockId.get(nodeId);
    if (target === undefined) return false;
    if (target === this.pageIndex) return true;
    return this.goToPage(target);
  }

  /**
   * 索引节点锚点：结构容器 id → 首叶所在页
   *
   * 块序列仅含叶块，而目录项指向卷/章/节容器，
   * 故需把容器 id 映射到其首个叶块（路径规则与 extractBlocks 一致）所在页。
   */
  private indexNodeAnchors(): void {
    if (this.doc === undefined) return;

    /** 深度优先返回子树首个叶块 id（叶块判定与 extractBlocks 一致） */
    const firstLeafIn = (node: BookNode, path: string): string | undefined => {
      if (isLeafBlock(node)) {
        if (node.type === NODE_TYPES.BOOK) return undefined;
        return node.id ?? path;
      }

      const elementChildren = (node.children ?? []).filter((child) => !isTextNode(child));
      let firstLeaf: string | undefined;
      for (const [index, child] of elementChildren.entries()) {
        const leaf = firstLeafIn(child, `${path}/${index}`);
        if (firstLeaf === undefined) firstLeaf = leaf;
      }

      // 无 id 的容器（导入文档常态）按树路径落锚，与 extractBlocks 的块 id 口径一致；
      // 书根路径为空串，不作锚点。
      const anchorId = node.id ?? path;
      if (firstLeaf !== undefined && anchorId.length > 0 && !this.pageByBlockId.has(anchorId)) {
        const page = this.pageByBlockId.get(firstLeaf);
        if (page !== undefined) {
          this.pageByBlockId.set(anchorId, page);
        }
      }
      return firstLeaf;
    };

    firstLeafIn(this.doc.root, '');
  }
}
