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
 * 适用范围：单栏（横排 / 直排，量尺主轴口径随书写方向转置）。多栏 DOM 量不到 →
 * `usable=false`，调用方回退 overlay。
 */
import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { DEFAULT_THEME, type BookDocument, type BookNode } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  mergeLayoutOptions,
  lineRangeMainSize,
  paginate,
  resolvePageMainSize,
  resolveBottomSlack,
  sliceNodeByCharRange,
  type BlockAxis,
  type LayoutOptions,
  type MeasurableBlock,
  type PageItem,
  type PaginatedPage,
  type PaginateResume,
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
import { PERF_LAYOUT, perfNow, perfRecord } from '../perf.js';
import { buildPagedIndex, charOfLine, type PagedIndex, type PmLeafPos } from './selection-bridge.js';

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
   * 页底溢出（px）；缺省按「布局 + 令牌 + 行高」推导（不压页码带）
   *
   * 须与预览 / 导出传同一口径，否则编辑画布与阅读页的归属会不一致。
   */
  bottomSlack?: number;
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
  /** 是否可用（单栏且量到有效分页——横排 / 直排均可；多栏 / 无 DOM 时调用方回退 overlay） */
  usable: boolean;
  /** 排文主轴（直排 `'column'`；块上 `axis` 标注与本字段同源） */
  axis: BlockAxis;
  /** 生效的每页主轴尺寸（px） */
  pageMainSize: number;
  /** 生效的页底溢出（px，参与本轮装箱容量） */
  bottomSlack: number;
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
  /** 块 id → 逐行主轴尺寸 px（含注音行盒；增量重排时供下轮合并复用） */
  lineMainSizes: ReadonlyMap<string, number[]>;
  /** 块 id → 块体高 px（不含外边距；供 paginate 按体高判页，增量重排时供下轮合并复用） */
  bodySizes: ReadonlyMap<string, number>;
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
    // from 经 charOfLine 外推：行号超出实测行数时按平均行宽外推，绝不回退到
    // offsets[0] / 末项（会把续排切片起点塌回块首 → 整段内容在多处重复渲染）
    const from = charOfLine(fromLine, offsets, charsPerLine);
    const to = offsets[fromLine + lineCount] ?? Number.MAX_SAFE_INTEGER;
    return { from, to };
  }
  const cpl = Math.max(1, charsPerLine);
  return { from: fromLine * cpl, to: (fromLine + lineCount) * cpl };
}

/**
 * 计算增量分页的续排起点（仅「定点实测」路径可用）
 *
 * 思路：流式贪心下「某页只由它之前的块决定」，所以目标块所在页之前的页可以
 * 原样保留，从该页的页首块起重排即可。约束与回退：
 * - 页首块必须是「本页第一个 fromLine=0 的片段」；整页都是跨页续排的后续片段时
 *   继续向前找，直到找到真正的页首；
 * - 若页首块的前一块带 `keepWithNext`（标题 + 首段），它的换页判断依赖页首块尺寸，
 *   会随之变化 → 起点再向前退一页，避免标题孤悬页尾；
 * - 任何一环对不上（目标块 / 页首块不在新块序列里、起点就是第 0 页）→ 返回
 *   undefined，调用方退回整本重排（正确性优先）。
 *
 * @param previous 上一次构建结果
 * @param blocks 本轮块序列（新）
 * @param targetBlockId 定点编辑的块 id
 */
function resolvePaginateResume(
  previous: BuildPagedResult,
  blocks: readonly MeasurableBlock[],
  targetBlockId: string,
): PaginateResume | undefined {
  const indexById = new Map<string, number>();
  const blockById = new Map<string, MeasurableBlock>();
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i] as MeasurableBlock;
    if (!indexById.has(block.id)) {
      indexById.set(block.id, i);
      blockById.set(block.id, block);
    }
  }
  if (!indexById.has(targetBlockId)) return undefined;

  /** 块 id → 首次出现的页号（按片段序列，跨页续排的块取首片所在页） */
  const pageOf = new Map<string, number>();
  previous.pages.forEach((page, pageIndex) => {
    for (const frag of page.fragments) {
      if (!pageOf.has(frag.blockId)) pageOf.set(frag.blockId, pageIndex);
    }
  });
  const targetPage = pageOf.get(targetBlockId);
  if (targetPage === undefined) return undefined;

  /** 某页的首个片段（`fromLine>0` 表示该块从更早的页续排过来） */
  const pageHeadFragment = (pageIndex: number) => previous.pages[pageIndex]?.fragments[0];

  // 从目标块所在页起步；若该页首片段是续排片段，则必须退到「该块的起始页」，
  // 否则会把本页上半段（上一块的续排部分）丢掉
  let startPage = targetPage;
  let startIndex: number | undefined;
  for (let guard = 0; guard < 4; guard += 1) {
    const head = pageHeadFragment(startPage);
    if (head === undefined) return undefined;
    const index = indexById.get(head.blockId);
    if (index === undefined) return undefined;
    if (head.fromLine > 0) {
      const ownerPage = pageOf.get(head.blockId);
      if (ownerPage === undefined || ownerPage >= startPage) return undefined;
      startPage = ownerPage;
      continue;
    }
    // 保守回退一页：前一页末块若 keepWithNext，它是否换页取决于本页首块尺寸
    if (index > 0 && blocks[index - 1]?.keepWithNext === true && startPage > 0) {
      startPage -= 1;
      continue;
    }
    startIndex = index;
    break;
  }
  if (startIndex === undefined) return undefined;

  // 起点在第 0 页时前缀为空，与整本重排等价，不必走续排
  if (startPage <= 0 || startIndex <= 0) return undefined;

  // 把前缀页转成 paginate 认识的页结构（尺寸取本轮实测块，供下游片段缓存命中）
  const prefix: PaginatedPage[] = [];
  for (let p = 0; p < startPage; p += 1) {
    const page = previous.pages[p];
    if (page === undefined) return undefined;
    const items: PageItem[] = [];
    let used = 0;
    for (const frag of page.fragments) {
      const block = blockById.get(frag.blockId);
      // 前缀页里出现本轮不存在的块（被删）→ 说明结构变了，放弃增量
      if (block === undefined) return undefined;
      // 片段尺寸按行累加（逐行行盒优先，缺省均高），与 paginate 结算口径一致
      const size =
        frag.lineCount > 0
          ? Math.min(
              block.mainSize,
              lineRangeMainSize(block, frag.fromLine, frag.lineCount),
            )
          : block.mainSize;
      // bodyMainSize 由本轮 extractBlocks 按块 id 携带，items 直接引用新块对象即继承
      items.push({ block, fromLine: frag.fromLine, lineCount: frag.lineCount, mainSize: size });
      used += size;
    }
    prefix.push({ index: p, items, blocks: items.map((item) => item.block), usedMainSize: used });
  }
  return { prefix, startIndex };
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
 *
 * 增量分页（P3）：定点路径下再用 `resolvePaginateResume` 把「目标块之前的页」
 * 原样接到 paginate 的 resume 上，分页成本从 O(全页) 降为 O(尾页)。
 */
export function buildPagedLayout(input: BuildPagedInput): BuildPagedResult {
  const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, input.options ?? {});
  const tokens = input.tokens ?? DEFAULT_THEME;
  const context: BlockMeasureContext = { ...DEFAULT_MEASURE_CONTEXT, ...input.measure };
  const pageMainSize = input.pageMainSize ?? resolvePageMainSize(options, tokens);
  const bottomSlack =
    input.bottomSlack ?? resolveBottomSlack(options, tokens, context.lineSize);
  // 主轴口径随书写方向（直排按列推进）；块上的 axis 标注与量尺 / 分页同源
  const axis: BlockAxis = isVerticalMode(options.writingMode) ? 'column' : 'row';
  const empty: BuildPagedResult = {
    usable: false,
    axis,
    pageMainSize,
    bottomSlack,
    pages: [],
    blocks: [],
    lineOffsets: new Map(),
    sizes: new Map(),
    lineSizes: new Map(),
    lineMainSizes: new Map(),
    bodySizes: new Map(),
    charsPerLine: context.charsPerLine,
  };

  // 分页编辑画布仍限单栏（P1-A 的多栏先落地在阅读侧）；多栏 / 无 DOM → 回退 overlay
  if ((options.columns ?? 1) > 1) return empty;
  if (typeof document === 'undefined') return empty;
  if (pageMainSize <= 0) return empty;

  const doc = input.doc;
  const prev = input.previous;
  const incremental = prev !== undefined && input.fromBlockId !== undefined;

  // 单次结构抽取（块序列 + 节点索引）：块序列与块 id 只由 IR 结构决定（尺寸映射仅
  // 影响尺寸字段），故探针判定、量尺渲染、最终建索引共用同一份结果 —— 每轮由三次
  // 全树遍历降为两次（大文档省约 6 ms/轮）。
  //
  // 增量轮把上一轮实测尺寸表喂进来：命中块跳过 estimator（大文档 78 万字全文档
  // 字符估算是最贵的一段），只有新增块才回退估算；量尺会重新实测目标块并在
  // 第二遍抽取时用新尺寸覆盖。
  const structural = extractBlocksIndexed(doc, {
    context,
    blockSizes: incremental ? prev.sizes : undefined,
    lineOffsets: incremental ? prev.lineOffsets : undefined,
    lineSizes: incremental ? prev.lineSizes : undefined,
    bodySizes: incremental ? prev.bodySizes : undefined,
    axis,
  });

  // 定点判定探针：新块序列全部命中旧尺寸缓存 = 无结构性变化（纯文本编辑）
  let targetBlockId: string | undefined;
  if (incremental && input.targetBlockId !== undefined && input.targetBlockId !== '') {
    const candidate = input.targetBlockId;
    if (
      structural.blocks.some((block) => block.id === candidate) &&
      structural.blocks.every((block) => prev.sizes.has(block.id))
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
    extracted: structural,
  });
  // 增量：起点块之前合并旧缓存（本轮未实测）；非增量时基空表 = 全量结果
  const sizes = new Map<string, number>(incremental ? prev.sizes : []);
  for (const [id, v] of fresh.sizes) sizes.set(id, v);
  const lineOffsets = new Map<string, number[]>(incremental ? prev.lineOffsets : []);
  for (const [id, v] of fresh.lineOffsets) lineOffsets.set(id, v);
  const lineSizes = new Map<string, number>(incremental ? prev.lineSizes : []);
  for (const [id, v] of fresh.lineSizes) lineSizes.set(id, v);
  const lineMainSizes = new Map<string, number[]>(incremental ? prev.lineMainSizes : []);
  for (const [id, v] of fresh.lineMainSizes) lineMainSizes.set(id, v);
  const bodySizes = new Map<string, number>(incremental ? prev.bodySizes : []);
  for (const [id, v] of fresh.bodySizes) bodySizes.set(id, v);
  // 陈旧行偏移清理：本轮实测过的块若未产出多行 lineOffsets（文本收缩到单行 / 量不到），
  // 必须删除其上一轮的旧 lineOffsets / lineSizes 项。否则 extractBlocks 会以陈旧多行
  // offsets 给定 lineCount（≠ 真实行数），paginate 造出幽灵续排片段，且片段切片与光标映射
  // 的「行→字符」换算同时错位 → 续页片段从块首重切，整段内容在多处重复渲染。
  if (incremental) {
    for (const id of fresh.sizes.keys()) {
      if (!fresh.lineOffsets.has(id)) {
        lineOffsets.delete(id);
        lineSizes.delete(id);
        lineMainSizes.delete(id);
      }
      // 重测后不再产出块体高（量不到 / 高度为 0）时清陈旧项
      if (!fresh.bodySizes.has(id)) bodySizes.delete(id);
    }
  }
  const indexed = extractBlocksIndexed(doc, {
    context,
    blockSizes: sizes,
    lineOffsets,
    lineSizes,
    lineMainSizes,
    bodySizes,
    axis,
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
    for (const id of [...lineMainSizes.keys()]) {
      if (!live.has(id)) lineMainSizes.delete(id);
    }
    for (const id of [...bodySizes.keys()]) {
      if (!live.has(id)) bodySizes.delete(id);
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
  // 增量分页：定点实测（无增删块、只改一块）时，目标块之前的页原样复用，
  // 只从目标块所在页的页首重排——大文档下把 paginate 的 O(页数) 降为 O(尾页数)
  const resume =
    targetBlockId !== undefined && prev !== undefined
      ? resolvePaginateResume(prev, blocks, targetBlockId)
      : undefined;
  const result = paginate(blocks, { pageMainSize, bottomSlack, resume });
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
    axis,
    pageMainSize,
    bottomSlack,
    pages,
    blocks,
    lineOffsets,
    lineSizes,
    lineMainSizes,
    bodySizes,
    sizes,
    charsPerLine: context.charsPerLine,
  };
}

/**
 * 由叶块前置位置求其**首个合法 inline 文本位置**（供容器型注文 / 双行注正确落光标）。
 *
 * 纯文本块（isTextblock：段落 / 标题 / 直挂 inline 的容器）文本从 `docStart + 1` 起；
 * `content: 'block+'` 容器（脚注 / 尾注 / 边注 / 双行注…）须沿首个子节点下钻，直到
 * 命中一个 textblock，其文本从该 textblock 前置位置 + 1 起。空容器无文本，回退 `docStart + 1`。
 */
function firstTextPos(doc: PMNode, docStart: number): number {
  const root: PMNode | null = doc.nodeAt(docStart);
  if (root === null) return docStart + 1;
  let node: PMNode = root;
  let pos = docStart;
  // 非 textblock 且有子节点 → 下钻首个子节点（进入父节点使前置位置 +1）
  while (!node.isTextblock && node.childCount > 0) {
    const child: PMNode | null = node.firstChild;
    if (child === null) break;
    pos += 1;
    node = child;
  }
  return pos + 1;
}

/**
 * 收集 PM 文档「叶块」位置（容器前置 + 首个文本起始），与 extractBlocks 块序列严格同序。
 *
 * 叶块口径与 reader.isLeafBlock 对齐：版式文本容器整体成块不下钻；无块级子节点的块为叶块；
 * 含块级子节点的结构容器下钻。与 `collectLeafEls`（DOM 侧）判定一致。
 */
export function collectPmLeafPositions(doc: PMNode): PmLeafPos[] {
  const out: PmLeafPos[] = [];
  doc.descendants((node: PMNode, pos: number) => {
    if (isLeafBlockTypeName(node.type.name)) {
      out.push({ docStart: pos, contentStart: firstTextPos(doc, pos) });
      return false;
    }
    let hasBlockChild = false;
    node.forEach((child: PMNode) => {
      if (child.isBlock) hasBlockChild = true;
    });
    if (!hasBlockChild) {
      out.push({ docStart: pos, contentStart: firstTextPos(doc, pos) });
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
  /** 页底溢出覆盖（px）；未给时由 buildPagedLayout 按布局 + 令牌推导 */
  bottomSlack?: Ref<number | undefined>;
  /**
   * 排版度量签名（可选）
   *
   * 给出时，**代替** `tokens` 作为重排触发源：只有签名变化（字号 / 行距 / 缩进 /
   * 页边距 / 分栏 / 版框 / 功能样式里的度量类声明）才重排；改颜色、线型等
   * 纯绘制参数不再触发全量重排。未给出时维持原行为（tokens 变化即重排）。
   */
  metricsSignature?: Ref<string>;
  /**
   * IME 组合态（可选）
   *
   * 为 true（中文等输入法组合进行中）时**冻结重排**：把这一轮重排请求暂存，
   * 待组合结束（转 false）再统一补排。避免去抖重排在组合期间落地——v-html 会重建
   * 正在输入的片段 DOM、`restoreCaretFromModel` 抢走光标，使未落模的组合文本在跨页
   * 段落的页边界两处重复。未给出时维持原行为（组合期间照常重排）。
   */
  composing?: Ref<boolean>;
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
/** 连续键入期的去抖间隔（合流快速键入，量尺成本摊薄）
 *
 * 400ms 而非 250ms：一轮定点重排在大文档上仍有 10~20ms 的固定开销（两次结构
 * 遍历 + 增量分页 + 索引重建），把合流窗口拉长能把「打字期间的重排次数」再降
 * 三分之一；停手 400ms 内必然出结果，视觉上仍等同即时。
 */
const TYPING_DELAY = 400;
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
  /** 组合期间被冻结的最新一次重排请求（组合结束时补排） */
  let deferredWhileComposing: { hints: string[]; force: boolean; allowTargeted: boolean } | null = null;

  const runLayout = (hints: readonly string[], force: boolean, allowTargeted: boolean): void => {
    const pmDoc = opts.editor.editorState.doc;
    if (!force && lastResult.value !== null && pmDoc === lastPmDoc) return;
    // IME 组合进行中：冻结本轮重排（只保留最新一次请求），待组合结束补排。
    // 否则上一笔编辑的去抖重排会在下一次组合期间落地，v-html 重建输入中的片段 + 抢光标，
    // 导致跨页段落在页边界重复渲染未落模的组合文本。
    if (opts.composing?.value === true) {
      deferredWhileComposing = { hints: [...hints], force, allowTargeted };
      return;
    }
    const started = Date.now();
    const perfStart = perfNow();
    const fromBlockId = hints.length > 0 ? hints[0] : undefined;
    const result = buildPagedLayout({
      doc: opts.editor.getSharedDocument(),
      options: opts.options.value,
      tokens: opts.tokens.value,
      fontToken: opts.fontToken.value,
      measure: opts.measure?.value,
      pageMainSize: opts.pageMainSize?.value,
      bottomSlack: opts.bottomSlack?.value,
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
    // 埋点：一轮重排（结构抽取 + 量尺 + 分页 + 索引）的真实耗时
    perfRecord(PERF_LAYOUT, perfStart);
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

  watch(opts.options, () => scheduleForced());
  /*
   * 重排触发源：
   * - 给了 metricsSignature → 只按签名变化重排（改颜色 / 线型等纯视觉参数不重排）；
   * - 否则维持原行为（tokens / fontToken 变化即重排，兼容既有调用方）。
   */
  if (opts.metricsSignature !== undefined) {
    watch(opts.metricsSignature, () => scheduleForced());
  } else {
    watch([opts.tokens, opts.fontToken], () => scheduleForced());
  }
  if (opts.measure !== undefined) watch(opts.measure, () => scheduleForced());
  if (opts.pageMainSize !== undefined) watch(opts.pageMainSize, () => scheduleForced());
  if (opts.bottomSlack !== undefined) watch(opts.bottomSlack, () => scheduleForced());
  watch(opts.version, () => scheduleRelayout());
  // 组合结束（true → false）：补排被冻结的那一轮（读当前模型 = 已含刚落模的组合文本）。
  // 若同时有 compositionend 的 edited 提示另起了去抖重排，二者均读同一当前模型，
  // 后到的一轮会被「文档未变」守卫自动跳过，不会重复重建。
  if (opts.composing !== undefined) {
    watch(
      opts.composing,
      (active) => {
        if (active || deferredWhileComposing === null) return;
        const req = deferredWhileComposing;
        deferredWhileComposing = null;
        runLayout(req.hints, req.force, req.allowTargeted);
      },
      { flush: 'sync' },
    );
  }

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
