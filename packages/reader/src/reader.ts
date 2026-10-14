/**
 * Reader 阅读器门面
 *
 * 无 DOM 的阅读状态机：聚合「文档 + 布局 + 分页 + 目录」，
 * 提供翻页、跳转、进度与事件；渲染交给 vue/react 封装或使用方。
 */
import {
  NODE_TYPES,
  createEventBus,
  isTextNode,
  type BibliotypeEventMap,
  type BookDocument,
  type BookNode,
  type EventBus,
} from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  mergeLayoutOptions,
  paginate,
  resolveContentBox,
  sliceNodeByCharRange,
  type LayoutOptions,
  type MeasurableBlock,
  type PaginatedPage,
} from '@bibliotype/layout';
import {
  DEFAULT_MEASURE_CONTEXT,
  defaultEstimator,
  collectNodeText,
  extractBlocks,
  isLeafBlock,
  type BlockMeasureContext,
  type BlockSizeEstimator,
} from './document-blocks.js';
import { findNodeById } from './find-node.js';
import { countOutlineItems, extractOutline, type OutlineItem } from './outline.js';
import { formatPageNumber, type PageNumberStyle } from './page-numbering.js';

/** 重排参数 */
export interface RepaginateOptions {
  /** 布局配置局部覆盖 */
  layout?: Partial<LayoutOptions>;
  /** 每页可用主轴尺寸（px） */
  pageMainSize?: number;
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
}

/** 搜索选项 */
export interface ReaderSearchOptions {
  /** 结果上限（默认 50） */
  limit?: number;
  /** 摘录上下文半径（命中词前后各取多少字符，默认 12） */
  contextLength?: number;
}

/** 搜索结果条目 */
export interface ReaderSearchResult {
  /** 命中块（叶块）节点 id，可直接用于 goToNode */
  nodeId: string;
  /** 命中块所在页（自 0 起） */
  pageIndex: number;
  /** 命中块节点类型 */
  blockType: string;
  /** 去掉首尾空白的命中上下文摘录（首尾越界处以省略号标记） */
  excerpt: string;
  /** 该块内命中次数 */
  matchCount: number;
}

/** 截取命中上下文摘录 */
function buildExcerpt(
  text: string,
  index: number,
  keywordLength: number,
  contextLength: number,
): string {
  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + keywordLength + contextLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/** Reader 配置 */
export interface ReaderOptions {
  /** 布局配置（局部覆盖，基于 DEFAULT_LAYOUT_OPTIONS 合并） */
  layout?: Partial<LayoutOptions>;
  /** 每页可用主轴尺寸（px）；默认按页面尺寸与标准页边距推导 */
  pageMainSize?: number;
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
  /** 外部事件总线（与 core 实例共享）；默认自建 */
  events?: EventBus<BibliotypeEventMap>;
}

/** 默认每页主轴尺寸（横排取内容区高，竖排取内容区宽） */
function defaultPageMainSize(layout: LayoutOptions): number {
  // 页边距与默认主题 page-margin（48px 56px）一致
  const box = resolveContentBox(layout.pageSize, 48, 56);
  return isVerticalMode(layout.writingMode) ? box.width : box.height;
}

/** 阅读器状态机 */
export class Reader {
  /** 事件总线（document:load / page:change / toc:ready） */
  readonly events: EventBus<BibliotypeEventMap>;

  private doc: BookDocument | undefined;
  private options: LayoutOptions;
  private pageMainSize: number;
  private readonly estimator: BlockSizeEstimator;
  private measure: BlockMeasureContext;
  /** 实测块尺寸映射（DOM 实测）；缺省回退估算 */
  private blockSizes: ReadonlyMap<string, number> | undefined;
  /** 块 → 每行起始字符偏移表（DOM 实测）；供 getPageFragments 按真实行切片 */
  private lineOffsets: ReadonlyMap<string, number[]> | undefined;
  /** 块 id → 真实行高（px，DOM 实测，不含块间距） */
  private lineSizes: ReadonlyMap<string, number> | undefined;

  private blocks: MeasurableBlock[] = [];
  private pages: PaginatedPage[] = [];
  private outlineItems: OutlineItem[] = [];
  private pageIndex = 0;
  private readonly pageByBlockId = new Map<string, number>();
  /** pageMainSize 是否由外部显式给定（否则随布局变化重算） */
  private pageMainSizeExplicit: boolean;

  constructor(options: ReaderOptions = {}) {
    this.options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, options.layout ?? {});
    this.pageMainSizeExplicit = options.pageMainSize !== undefined;
    this.pageMainSize = options.pageMainSize ?? defaultPageMainSize(this.options);
    this.measure = { ...DEFAULT_MEASURE_CONTEXT, ...options.measure };
    this.estimator = options.estimator ?? defaultEstimator;
    this.blockSizes = options.blockSizes;
    this.lineOffsets = options.lineOffsets;
    this.lineSizes = options.lineSizes;
    this.events = options.events ?? createEventBus();
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
        this.pageMainSize = defaultPageMainSize(this.options);
      }
    }
    if (overrides.pageMainSize !== undefined) {
      this.pageMainSize = overrides.pageMainSize;
      this.pageMainSizeExplicit = true;
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

    this.blocks = extractBlocks(this.doc, {
      estimator: this.estimator,
      context: this.measure,
      blockSizes: this.blockSizes,
      lineOffsets: this.lineOffsets,
      lineSizes: this.lineSizes,
    });
    const result = paginate(this.blocks, { pageMainSize: this.pageMainSize });
    this.pages = result.pages;

    this.pageByBlockId.clear();
    for (const page of result.pages) {
      for (const block of page.blocks) {
        this.pageByBlockId.set(block.id, page.index);
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

  /** 取某页的节点（块 id 经 findNodeById 还原；未载入或未命中时缺省） */
  getPageNodes(pageIndex: number): readonly BookNode[] {
    if (this.doc === undefined) return [];
    const nodes: BookNode[] = [];
    for (const block of this.getPageBlocks(pageIndex)) {
      const node = findNodeById(this.doc.root, block.id);
      if (node !== undefined) nodes.push(node);
    }
    return nodes;
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
      const node = findNodeById(this.doc.root, item.block.id);
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

  /**
   * 全文搜索（按块级文本，大小写敏感的字面子串匹配）
   *
   * 逐页扫描叶块文本，返回带页号与上下文摘录的结果；
   * nodeId 可直接传给 goToNode 完成跳转。
   */
  search(query: string, options: ReaderSearchOptions = {}): ReaderSearchResult[] {
    const keyword = query.trim();
    if (keyword === '' || this.doc === undefined) return [];
    const limit = options.limit ?? 50;
    const contextLength = options.contextLength ?? 12;

    const results: ReaderSearchResult[] = [];
    for (const page of this.pages) {
      for (const block of page.blocks) {
        const node = findNodeById(this.doc.root, block.id);
        if (node === undefined) continue;
        const text = collectNodeText(node);
        const first = text.indexOf(keyword);
        if (first === -1) continue;

        let matchCount = 0;
        for (
          let cursor = first;
          cursor !== -1;
          cursor = text.indexOf(keyword, cursor + keyword.length)
        ) {
          matchCount += 1;
        }

        results.push({
          nodeId: block.id,
          pageIndex: page.index,
          blockType: node.type,
          excerpt: buildExcerpt(text, first, keyword.length, contextLength),
          matchCount,
        });
        if (results.length >= limit) return results;
      }
    }
    return results;
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

      if (firstLeaf !== undefined && node.id !== undefined && !this.pageByBlockId.has(node.id)) {
        const page = this.pageByBlockId.get(firstLeaf);
        if (page !== undefined) {
          this.pageByBlockId.set(node.id, page);
        }
      }
      return firstLeaf;
    };

    firstLeafIn(this.doc.root, '');
  }
}
