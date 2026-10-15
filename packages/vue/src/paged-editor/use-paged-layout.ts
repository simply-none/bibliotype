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
  extractBlocksIndexed,
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
  /**
   * 定点实测候选（S1）：仅当与 previous 同用且探针判定「无增删块（纯文本编辑）」时，
   * 量尺只实测该块（其余块沿用缓存）；否则自动回退 fromBlockId 尾测。
   * 调用方须保证本轮只有该块被编辑（多块编辑请只传 fromBlockId）。
   */
  targetBlockId?: string;
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
 * 之前的块尺寸 / 行偏移沿用缓存；未实测块的切片按 (块, 起始行, 行数) 整体
 * 复用旧片段对象（同引用 → 视图 v-html 不重建），实测过的块一律重建。
 *
 * 定点（S1）：再传 targetBlockId 时先探针判定「无增删块」（全部块 id 命中
 * 旧尺寸缓存）：单栏定宽流块高彼此独立，纯文本编辑只实测该块（另渲染其后
 * 一块保折叠口径），其余块沿用缓存；探针未过自动回退 fromBlockId 尾测。
 * 切片节点惰性产出（首次访问 `node` 才 sliceNodeByCharRange），成本摊到视口页。
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
  const prev = input.previous;
  const incremental = prev !== undefined && input.fromBlockId !== undefined;

  // 定点判定探针：新块序列全部命中旧尺寸缓存 = 无结构性变化（纯文本编辑）
  let targetBlockId: string | undefined;
  if (incremental && input.targetBlockId !== undefined && input.targetBlockId !== '') {
    const candidate = input.targetBlockId;
    const probe = extractBlocksIndexed(doc, {
      context,
      blockSizes: prev.sizes,
      lineOffsets: prev.lineOffsets,
      lineSizes: prev.lineSizes,
    });
    if (
      probe.blocks.some((block) => block.id === candidate) &&
      probe.blocks.every((block) => prev.sizes.has(block.id))
    ) {
      targetBlockId = candidate;
    }
  }

  const fresh = measurePagination({
    doc,
    options,
    tokens,
    fontToken: input.fontToken,
    measure: input.measure,
    fromBlockId: incremental ? input.fromBlockId : undefined,
    targetBlockId,
  });
  // 增量：起点块之前合并旧缓存（本轮未实测）；非增量时基空表 = 全量结果
  const sizes = new Map<string, number>(incremental ? prev.sizes : []);
  for (const [id, v] of fresh.sizes) sizes.set(id, v);
  const lineOffsets = new Map<string, number[]>(incremental ? prev.lineOffsets : []);
  for (const [id, v] of fresh.lineOffsets) lineOffsets.set(id, v);
  const lineSizes = new Map<string, number>(incremental ? prev.lineSizes : []);
  for (const [id, v] of fresh.lineSizes) lineSizes.set(id, v);
  const indexed = extractBlocksIndexed(doc, {
    context,
    blockSizes: sizes,
    lineOffsets,
    lineSizes,
  });
  const blocks = indexed.blocks;
  if (blocks.length === 0) return empty;

  // 按最终块序列裁剪三表：剔除已删块（回删并段）的陈旧项，防缓存无限累积
  if (incremental) {
    const live = new Set(blocks.map((block) => block.id));
    for (const id of [...sizes.keys()]) {
      if (!live.has(id)) sizes.delete(id);
    }
    for (const id of [...lineOffsets.keys()]) {
      if (!live.has(id)) lineOffsets.delete(id);
    }
    for (const id of [...lineSizes.keys()]) {
      if (!live.has(id)) lineSizes.delete(id);
    }
  }

  // 切片复用：仅「本轮未实测」的块可整体复用旧片段对象（内容必然一致）；
  // 实测过的块一律惰性重建，杜绝旧切片复用的陈旧渲染
  const measuredIds = new Set<string>(fresh.sizes.keys());
  const prevFragByKey = new Map<string, PagedFragment>();
  if (incremental) {
    for (const page of prev.pages) {
      for (const frag of page.fragments) {
        prevFragByKey.set(`${frag.blockId}|${frag.fromLine}|${frag.lineCount}`, frag);
      }
    }
  }

  const nodeById = indexed.nodeById;
  const result = paginate(blocks, { pageMainSize });
  const pages: PagedPage[] = result.pages.map((page) => {
    const fragments: PagedFragment[] = [];
    for (const item of page.items) {
      const blockId = item.block.id;
      if (!measuredIds.has(blockId)) {
        const reused = prevFragByKey.get(`${blockId}|${item.fromLine}|${item.lineCount}`);
        if (reused !== undefined) {
          fragments.push(reused);
          continue;
        }
      }
      // 新片段：惰性切片（首次访问 node 才查表 / 切片，成本摊到实际渲染的视口页）
      const fromLine = item.fromLine;
      const lineCount = item.lineCount;
      let cachedNode: BookNode | undefined;
      fragments.push({
        blockId,
        get node(): BookNode {
          if (cachedNode === undefined) {
            const src = nodeById.get(blockId);
            if (src === undefined) {
              cachedNode = { type: 'text', text: '' };
            } else if (lineCount > 0) {
              const { from, to } = charRangeFromLines(
                blockId,
                fromLine,
                lineCount,
                lineOffsets,
                context.charsPerLine,
              );
              cachedNode = sliceNodeByCharRange(src, from, to);
            } else {
              cachedNode = src;
            }
          }
          return cachedNode;
        },
        fromLine,
        lineCount,
      });
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

/** 输入活跃窗口：距最近一次编辑提示小于该值视为连续键入 */
const TYPING_ACTIVE_MS = 800;
/** 连续键入期的去抖间隔（合流快速键入，量尺成本摊薄） */
const TYPING_DELAY = 250;
/** 分帧兜底间隔：rAF 不触发（后台标签 / fake timers）时保证量尺仍在去抖窗口内起跑 */
const FRAME_FALLBACK_MS = 16;

/**
 * 响应式分页：监听 version / 布局变化，去抖重建 pages。
 *
 * 守卫：纯选区事务（doc 引用不变且非 force）不重排 —— 选区同步高频触发时
 * 避免无谓重建与光标闪烁；布局 / 令牌 / 尺寸变化一律 force。
 *
 * 性能（大文件编辑优化落地）：
 * - 定点实测：单块编辑提示 + 探针无增删块 → 量尺只测该块（buildPagedLayout targetBlockId）；
 * - 双档去抖：连续键入（800ms 活跃窗）250ms 合流，空闲期沿用预算自适应档（120/300ms）；
 * - 分帧执行：去抖到期后经 requestAnimationFrame 让出一帧再跑量尺（16ms 兜底保证触发）；
 * - 增量 IR：文档快照改走 getSharedDocument()（PM→IR 结构共享，未变子树直接复用）。
 */
export function usePagedLayout(opts: UsePagedLayoutOptions): UsePagedLayoutReturn {
  const pages = shallowRef<PagedPage[]>([]);
  const usable = ref(false);
  const pagedIndex = shallowRef<PagedIndex | null>(null);
  const charsPerLine = ref(DEFAULT_MEASURE_CONTEXT.charsPerLine);
  const lastResult = shallowRef<BuildPagedResult | null>(null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let frameRaf = 0;
  let frameFallback: ReturnType<typeof setTimeout> | undefined;
  let pendingHints: string[] = [];
  let lastHintAt = 0;
  let hintPmDoc: PMNode | null = null;
  let lastPmDoc: PMNode | null = null;
  let delay = 120;

  const runLayout = (hints: readonly string[], force: boolean, allowTargeted: boolean): void => {
    const pmDoc = opts.editor.editorState.doc;
    if (!force && lastResult.value !== null && pmDoc === lastPmDoc) return;
    const started = Date.now();
    const fromBlockId = hints.length > 0 ? hints[0] : undefined;
    const result = buildPagedLayout({
      doc: opts.editor.getSharedDocument(),
      options: opts.options.value,
      tokens: opts.tokens.value,
      fontToken: opts.fontToken.value,
      measure: opts.measure?.value,
      pageMainSize: opts.pageMainSize?.value,
      fromBlockId,
      // 定点只信任「单块提示 + 提示后 PM 文档未再变」（提示后有外部事务则退回尾测）
      targetBlockId: allowTargeted && hints.length === 1 ? hints[0] : undefined,
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

  const relayout = (fromBlockId?: string, force = false): void => {
    runLayout(fromBlockId !== undefined ? [fromBlockId] : [], force, false);
  };

  function clearFrame(): void {
    if (frameRaf !== 0) cancelAnimationFrame(frameRaf);
    frameRaf = 0;
    if (frameFallback !== undefined) clearTimeout(frameFallback);
    frameFallback = undefined;
  }

  /** 分帧执行：让出一帧再跑量尺，避免长任务阻塞当帧输入 / 绘制；rAF 不可用时立即执行 */
  function fireInFrame(task: () => void): void {
    clearFrame();
    let fired = false;
    const fire = (): void => {
      if (fired) return;
      fired = true;
      const fallback = frameFallback;
      frameRaf = 0;
      frameFallback = undefined;
      if (fallback !== undefined) clearTimeout(fallback);
      task();
    };
    if (typeof requestAnimationFrame === 'function') {
      frameRaf = requestAnimationFrame(fire);
      // 兜底：fake timers / 后台标签下 rAF 可能不触发，≤16ms 保证仍在去抖窗口内起跑
      frameFallback = setTimeout(fire, FRAME_FALLBACK_MS);
    } else {
      frameFallback = setTimeout(fire, 0);
    }
  }

  /** 下一档去抖：输入活跃窗内用合流档（250ms），空闲期用预算自适应档（120/300ms） */
  function nextDelay(): number {
    return Date.now() - lastHintAt < TYPING_ACTIVE_MS ? TYPING_DELAY : delay;
  }

  const scheduleRelayout = (fromBlockId?: string): void => {
    if (fromBlockId !== undefined && fromBlockId !== '') {
      if (pendingHints[pendingHints.length - 1] !== fromBlockId) pendingHints.push(fromBlockId);
      lastHintAt = Date.now();
      hintPmDoc = opts.editor.editorState.doc;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const hints = pendingHints;
      pendingHints = [];
      const targeted = hints.length === 1 && hintPmDoc === opts.editor.editorState.doc;
      hintPmDoc = null;
      fireInFrame(() => runLayout(hints, false, targeted));
    }, nextDelay());
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
      pendingHints = [];
      hintPmDoc = null;
      fireInFrame(() => runLayout([], true, false));
    }, nextDelay());
  }

  onScopeDispose(() => {
    if (timer !== undefined) clearTimeout(timer);
    clearFrame();
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
