/**
 * 编辑态分页内核（阶段一）
 *
 * 以 BookEditor(ProseMirror) 文档为唯一真相源，复用与预览 / 导出同源的三段管线：
 * - `measurePagination`：离屏量尺产出「块 → 主轴推进尺寸」「块 → 每行起始字符偏移」
 *   与「块 → 真实行高（不含块间距）」；
 * - `extractBlocks`：IR 树展开为线性块序列（正文段落自动标 `splittable`）；
 * - `paginate` + `sliceNodeByCharRange`：按行把跨页段落切成片段，逐页产出「片段节点序列」。
 *
 * 输出供 `PagedCanvas` 渲染真实书页盒（像素与预览一致、缝隙处天然无字），
 * 并附「PM 叶块起始位置索引」（与块序列同序），供阶段三把 DOM 光标映射回模型。
 *
 * 适用范围：单栏横排。直排 / 多栏 DOM 量不到 → `usable=false`，调用方回退 overlay。
 */
import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { DEFAULT_THEME, type BookDocument, type BookNode } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  mergeLayoutOptions,
  paginate,
  resolvePageMainSize,
  sliceNodeByCharRange,
  type LayoutOptions,
  type MeasurableBlock,
} from '@bibliotype/layout';
import {
  DEFAULT_MEASURE_CONTEXT,
  extractBlocks,
  findNodeById,
  isLeafBlockTypeName,
  type BlockMeasureContext,
} from '@bibliotype/reader';
import type { Node as PMNode } from 'prosemirror-model';
import type { BookEditor } from '@bibliotype/editor';
import { measurePagination } from '../pagination-measure.js';
import { buildPagedIndex, type PagedIndex } from './selection-bridge.js';

/** 页内一个片段：整块（lineCount=0）或跨页块的某段连续行 */
export interface PagedFragment {
  /** 源块 id */
  blockId: string;
  /** 渲染用节点（跨页块已按字符区间切片；整块为原引用） */
  node: BookNode;
  /** 片段起始行（块内相对，0 起；整块为 0） */
  fromLine: number;
  /** 片段行数（整块为 0） */
  lineCount: number;
}

/** 分页结果中的单页 */
export interface PagedPage {
  /** 页码（自 0 起） */
  index: number;
  /** 本页片段序列 */
  fragments: PagedFragment[];
  /** 本页首块 id（渲染锚点 / 调试） */
  firstBlockId: string;
}

/** buildPagedLayout 输入 */
export interface BuildPagedInput {
  /** 待分页文档（editor.getDocument() 快照） */
  doc: BookDocument;
  /** 布局选项（局部覆盖，基于 DEFAULT 合并） */
  options?: Partial<LayoutOptions>;
  /** 主题令牌值表 */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 正文字体族令牌键 */
  fontToken?: string;
  /** 估算上下文覆盖（charsPerLine 用于缺省行→字符回退） */
  measure?: Partial<BlockMeasureContext>;
  /** 每页可用主轴尺寸（px）；缺省按 pageSize 与 page-margin 推导 */
  pageMainSize?: number;
  /**
   * 增量重排起点块 id（阶段五）：仅 DOM 实测该块及之后，
   * 之前的块尺寸 / 行偏移沿用 previous 缓存。需与 previous 同用。
   */
  fromBlockId?: string;
  /** 上一次构建结果（增量复用：实测子集 + 未改块切片复用） */
  previous?: BuildPagedResult;
}

/** buildPagedLayout 结果 */
export interface BuildPagedResult {
  /** 是否可用（单栏横排且量到有效分页；否则调用方回退 overlay） */
  usable: boolean;
  /** 生效的每页主轴尺寸（px） */
  pageMainSize: number;
  /** 逐页片段序列 */
  pages: PagedPage[];
  /** 分页前的线性块（调试 / 阶段三映射） */
  blocks: MeasurableBlock[];
  /** 块 id → 每行起始字符偏移（阶段三选择映射复用） */
  lineOffsets: ReadonlyMap<string, number[]>;
  /** 块 id → 主轴推进尺寸（增量重排时供下轮合并复用） */
  sizes: ReadonlyMap<string, number>;
  /** 块 id → 真实行高 px（不含块间距；增量重排时供下轮合并复用） */
  lineSizes: ReadonlyMap<string, number>;
  /** 生效的每行字符估算（回退口径，供片段归属换算同源复用） */
  charsPerLine: number;
}

/** 行区间 [fromLine, fromLine+lineCount) → 字符半开区间（实测优先，回退 charsPerLine 估算） */
function charRangeFromLines(
  id: string,
  fromLine: number,
  lineCount: number,
  lineOffsets: ReadonlyMap<string, number[]>,
  charsPerLine: number,
): { from: number; to: number } {
  const offsets = lineOffsets.get(id);
  if (offsets !== undefined && offsets.length > 0) {
    const from = offsets[fromLine] ?? offsets[offsets.length - 1] ?? 0;
    const to = offsets[fromLine + lineCount] ?? Number.MAX_SAFE_INTEGER;
    return { from, to };
  }
  const cpl = Math.max(1, charsPerLine);
  return { from: fromLine * cpl, to: (fromLine + lineCount) * cpl };
}

/**
 * 纯函数：由文档快照构建分页片段（可单测，无副作用之外的响应式）。
 *
 * 增量（阶段五）：传 fromBlockId + previous 时，DOM 实测只覆盖该块及之后，
 * 之前块的尺寸 / 行偏移沿用缓存；切片节点按 (块, 起始行, 行数) 键复用，
 * 未受影响块不重新 sliceNodeByCharRange。
 */
export function buildPagedLayout(input: BuildPagedInput): BuildPagedResult {
  const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, input.options ?? {});
  const tokens = input.tokens ?? DEFAULT_THEME;
  const context: BlockMeasureContext = { ...DEFAULT_MEASURE_CONTEXT, ...input.measure };
  const pageMainSize = input.pageMainSize ?? resolvePageMainSize(options, tokens);
  const empty: BuildPagedResult = {
    usable: false,
    pageMainSize,
    pages: [],
    blocks: [],
    lineOffsets: new Map(),
    sizes: new Map(),
    lineSizes: new Map(),
    charsPerLine: context.charsPerLine,
  };

  // paged 依赖单栏横排 DOM 实测；直排 / 多栏 / 无 DOM → 不可用（调用方回退 overlay）
  if (isVerticalMode(options.writingMode) || (options.columns ?? 1) > 1) return empty;
  if (typeof document === 'undefined') return empty;
  if (pageMainSize <= 0) return empty;

  const doc = input.doc;
  const incremental = input.previous !== undefined && input.fromBlockId !== undefined;
  const fresh = measurePagination({
    doc,
    options,
    tokens,
    fontToken: input.fontToken,
    measure: input.measure,
    fromBlockId: incremental ? input.fromBlockId : undefined,
  });
  // 增量：起点块之前合并旧缓存（本轮未实测）；非增量时基空表 = 全量结果
  const sizes = new Map<string, number>(incremental ? input.previous!.sizes : []);
  for (const [id, v] of fresh.sizes) sizes.set(id, v);
  const lineOffsets = new Map<string, number[]>(incremental ? input.previous!.lineOffsets : []);
  for (const [id, v] of fresh.lineOffsets) lineOffsets.set(id, v);
  const lineSizes = new Map<string, number>(incremental ? input.previous!.lineSizes : []);
  for (const [id, v] of fresh.lineSizes) lineSizes.set(id, v);
  const blocks = extractBlocks(doc, { context, blockSizes: sizes, lineOffsets, lineSizes });
  if (blocks.length === 0) return empty;

  // 未变块切片复用：(块id|起始行|行数) → 已切节点（整块引用木身廉价，不入缓存）
  const sliceCache = new Map<string, BookNode>();
  if (incremental) {
    for (const page of input.previous!.pages) {
      for (const frag of page.fragments) {
        if (frag.lineCount > 0) {
          sliceCache.set(`${frag.blockId}|${frag.fromLine}|${frag.lineCount}`, frag.node);
        }
      }
    }
  }

  const result = paginate(blocks, { pageMainSize });
  const pages: PagedPage[] = result.pages.map((page) => {
    const fragments: PagedFragment[] = [];
    for (const item of page.items) {
      const node = findNodeById(doc.root, item.block.id);
      if (node === undefined) continue;
      let rendered: BookNode = node;
      if (item.lineCount > 0) {
        const cacheKey = `${item.block.id}|${item.fromLine}|${item.lineCount}`;
        const cached = sliceCache.get(cacheKey);
        if (cached !== undefined) {
          rendered = cached;
        } else {
          const { from, to } = charRangeFromLines(
            item.block.id,
            item.fromLine,
            item.lineCount,
            lineOffsets,
            context.charsPerLine,
          );
          rendered = sliceNodeByCharRange(node, from, to);
          sliceCache.set(cacheKey, rendered);
        }
      }
      fragments.push({ blockId: item.block.id, node: rendered, fromLine: item.fromLine, lineCount: item.lineCount });
    }
    return { index: page.index, fragments, firstBlockId: page.items[0]?.block.id ?? '' };
  });

  return {
    usable: pages.length > 0,
    pageMainSize,
    pages,
    blocks,
    lineOffsets,
    lineSizes,
    sizes,
    charsPerLine: context.charsPerLine,
  };
}

/**
 * 收集 PM 文档「叶块」起始位置，与 extractBlocks 块序列严格同序（供编辑态光标 ⇄ 位置映射）。
 *
 * 叶块口径与 reader.isLeafBlock 对齐：版式文本容器整体成块不下钻；无块级子节点的块为叶块；
 * 含块级子节点的结构容器下钻。与 `collectLeafEls`（DOM 侧）判定一致。
 */
export function collectPmLeafPositions(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node: PMNode, pos: number) => {
    if (isLeafBlockTypeName(node.type.name)) {
      out.push(pos);
      return false;
    }
    let hasBlockChild = false;
    node.forEach((child: PMNode) => {
      if (child.isBlock) hasBlockChild = true;
    });
    if (!hasBlockChild) {
      out.push(pos);
      return false;
    }
    return true;
  });
  return out;
}

/** usePagedLayout 选项（响应式输入） */
export interface UsePagedLayoutOptions {
  /** 编辑器实例（真相源） */
  editor: BookEditor;
  /** 布局选项 */
  options: Ref<LayoutOptions>;
  /** 主题令牌 */
  tokens: Ref<Readonly<Record<string, string | undefined>>>;
  /** 正文字体族令牌键 */
  fontToken: Ref<string | undefined>;
  /** 估算上下文 */
  measure?: Ref<BlockMeasureContext | undefined>;
  /** 每页主轴尺寸覆盖 */
  pageMainSize?: Ref<number | undefined>;
  /** 驱动重排的版本号（编辑事务自增） */
  version: Ref<number>;
}

/** usePagedLayout 返回 */
export interface UsePagedLayoutReturn {
  /** 逐页片段（响应式） */
  pages: Ref<PagedPage[]>;
  /** 是否可用（false 时调用方应回退 overlay） */
  usable: Ref<boolean>;
  /** 块 ⇄ PM 位置索引（响应式，随重排更新；供编辑桥映射） */
  pagedIndex: Ref<PagedIndex | null>;
  /** 生效的每行字符估算（回退口径，与切片同源） */
  charsPerLine: Ref<number>;
  /** 上一次构建结果（增量重排缓存；测试 / 调试用） */
  lastResult: Ref<BuildPagedResult | null>;
  /** 立即重排；fromBlockId 给出时走增量（仅实测该块及之后） */
  relayout: (fromBlockId?: string, force?: boolean) => void;
  /** 去抖重排（编辑 / 尺寸变化后调用；块 id 提示启用增量） */
  scheduleRelayout: (fromBlockId?: string) => void;
}

/**
 * 响应式分页：监听 version / 布局变化，去抖重建 pages。
 *
 * 守卫：纯选区事务（doc 引用不变且非 force）不重排 —— 选区同步高频触发时
 * 避免无谓重建与光标闪烁；布局 / 令牌 / 尺寸变化一律 force。
 * 增量：传入 fromBlockId 时携带上次结果作缓存（阶段五）。重排耗时超预算
 * （>33ms）自动加大去抖间隔节流。
 */
export function usePagedLayout(opts: UsePagedLayoutOptions): UsePagedLayoutReturn {
  const pages = shallowRef<PagedPage[]>([]);
  const usable = ref(false);
  const pagedIndex = shallowRef<PagedIndex | null>(null);
  const charsPerLine = ref(DEFAULT_MEASURE_CONTEXT.charsPerLine);
  const lastResult = shallowRef<BuildPagedResult | null>(null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingFromBlockId: string | undefined;
  let lastPmDoc: PMNode | null = null;
  let delay = 120;

  const relayout = (fromBlockId?: string, force = false): void => {
    const pmDoc = opts.editor.editorState.doc;
    if (!force && lastResult.value !== null && pmDoc === lastPmDoc) return;
    const started = Date.now();
    const result = buildPagedLayout({
      doc: opts.editor.getDocument(),
      options: opts.options.value,
      tokens: opts.tokens.value,
      fontToken: opts.fontToken.value,
      measure: opts.measure?.value,
      pageMainSize: opts.pageMainSize?.value,
      fromBlockId,
      previous: fromBlockId !== undefined ? lastResult.value ?? undefined : undefined,
    });
    lastPmDoc = pmDoc;
    usable.value = result.usable;
    pages.value = result.pages;
    lastResult.value = result;
    charsPerLine.value = result.charsPerLine;
    pagedIndex.value = result.usable
      ? buildPagedIndex(result.blocks, collectPmLeafPositions(pmDoc), result.lineOffsets)
      : null;
    // 预算反馈：单次重排超 33ms → 去抖加大到 300ms（阶段五节流）
    delay = Date.now() - started > 33 ? 300 : 120;
  };

  const scheduleRelayout = (fromBlockId?: string): void => {
    if (fromBlockId !== undefined) pendingFromBlockId = fromBlockId;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const hint = pendingFromBlockId;
      pendingFromBlockId = undefined;
      relayout(hint);
    }, delay);
  };

  watch([opts.options, opts.tokens, opts.fontToken], () => scheduleForced());
  if (opts.measure !== undefined) watch(opts.measure, () => scheduleForced());
  if (opts.pageMainSize !== undefined) watch(opts.pageMainSize, () => scheduleForced());
  watch(opts.version, () => scheduleRelayout());

  /** 布局参数变化：跳过分页不变守卫（尺寸可能影响量尺/归属） */
  function scheduleForced(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      relayout(undefined, true);
    }, delay);
  }

  onScopeDispose(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  // 暴露响应式 pages / usable
  return {
    pages: pages as Ref<PagedPage[]>,
    usable,
    pagedIndex,
    charsPerLine,
    lastResult,
    relayout,
    scheduleRelayout,
  };
}
