/**
 * 分页可编辑选择桥（阶段三核心：DOM 片段字符 ⇄ ProseMirror 文档位置）
 *
 * 编辑态真相源是 BookEditor 的 ProseMirror 文档；分页把跨页段落按「行」切成渲染片段。
 * 用户在某页某片段内编辑时，需把「(块, 片段起始行, 片段内字符偏移)」映射回模型 PM 位置，
 * 才能把输入落成正确事务；反向亦然（重排后恢复光标）。本模块为纯函数，可脱离 DOM 单测。
 *
 * 关键口径：
 * - 叶块序与 extractBlocks 块序严格一致（与 collectPmLeafPositions 同源，按位置对齐，不依赖 id）；
 * - 文本块内容起始 PM 位置 = 节点前置位置(docStart) + 1；字符 i 落在 docStart + 1 + i；
 * - 行→块内字符偏移优先用 DOM 实测 lineOffsets，缺省回退 charsPerLine 估算（与切片同口径）。
 */
import type { MeasurableBlock } from '@bibliotype/layout';

/** 单块定位信息 */
export interface PagedBlockLoc {
  /** 块 id（IR，可能为路径 id） */
  blockId: string;
  /** 该叶块在 PM 文档中的「前置位置」（nodeBefore 坐标，descendants 给出的 pos） */
  docStart: number;
  /** 文本内容起始 PM 位置 = docStart + 1 */
  contentStart: number;
  /** 每行起始字符偏移（DOM 实测；缺省回退 charsPerLine） */
  lineOffsets?: number[];
}

/** 分页块索引（按 id 与按序两套访问） */
export interface PagedIndex {
  byId: Map<string, PagedBlockLoc>;
  ordered: PagedBlockLoc[];
}

/**
 * PM 叶块位置引用：容器前置位置 + 首个合法文本起始位置。
 *
 * `docStart` 为叶块（含容器型注文 / 双行注）的 nodeBefore 坐标；`contentStart`
 * 为该块**首个 inline 文本**的 PM 位置——纯文本块（段落 / 标题）即 `docStart + 1`，
 * 而 `content: 'block+'` 容器（脚注 / 尾注 / 边注 / 双行注…）须下钻到内层首个段落，
 * 否则光标 / 落模定位到「容器开 ↔ 子段落」之间（parent 为块容器、非 inline），
 * 使分页编辑态下注文 / 双行注无法落选区、打不进字、命令落空。
 */
export interface PmLeafPos {
  docStart: number;
  contentStart: number;
}

/** 叶块位置输入：兼容纯 `docStart` 数字（contentStart 回退 docStart + 1）与富引用 */
export type PmLeafInput = number | PmLeafPos;

/**
 * 构建块索引：blocks 与 leafPositions 同序对齐（第 i 叶块 ↔ 第 i 块）。
 * 数量不一致时取较小值（结构化容器场景 leafPositions 可能少于块数，映射降级，调用方回退）。
 */
export function buildPagedIndex(
  blocks: readonly MeasurableBlock[],
  leafPositions: readonly PmLeafInput[],
  lineOffsets: ReadonlyMap<string, number[]>,
): PagedIndex {
  const n = Math.min(blocks.length, leafPositions.length);
  const ordered: PagedBlockLoc[] = [];
  const byId = new Map<string, PagedBlockLoc>();
  for (let i = 0; i < n; i += 1) {
    const block = blocks[i] as MeasurableBlock;
    const leaf = leafPositions[i] as PmLeafInput;
    const docStart = typeof leaf === 'number' ? leaf : leaf.docStart;
    const contentStart = typeof leaf === 'number' ? leaf + 1 : leaf.contentStart;
    const loc: PagedBlockLoc = {
      blockId: block.id,
      docStart,
      contentStart,
      lineOffsets: lineOffsets.get(block.id),
    };
    ordered.push(loc);
    if (!byId.has(block.id)) byId.set(block.id, loc);
  }
  return { byId, ordered };
}

/**
 * 行号 → 块内字符偏移（实测优先，越界按平均行宽外推，缺省回退 charsPerLine）。
 *
 * 越界（line ≥ lineOffsets.length）时**绝不**回退到 offsets[0] / 末项：行号虚高
 * 往往源于陈旧多行 lineOffsets 与真实收缩文本不一致，回退末项会把续排切片起点
 * 塌回块首 → 整段内容在多处重复渲染、光标映射同步错位。改为按实测平均行宽向前
 * 外推（`last + (line - lastIdx) * avg`），使起点落在块尾之后，续排片段自然为空。
 */
export function charOfLine(
  line: number,
  lineOffsets: readonly number[] | undefined,
  charsPerLine: number,
): number {
  if (lineOffsets !== undefined && lineOffsets.length > 0) {
    const exact = lineOffsets[line];
    if (exact !== undefined) return exact;
    const lastIdx = lineOffsets.length - 1;
    const last = lineOffsets[lastIdx] ?? 0;
    // 仅有单点（无行距可推）时退化用 charsPerLine 外推
    const avg = lastIdx > 0 ? last / lastIdx : Math.max(1, charsPerLine);
    return Math.round(last + (line - lastIdx) * avg);
  }
  return line * Math.max(1, charsPerLine);
}

/** 块内字符偏移 → PM 位置 */
export function blockCharToPm(contentStart: number, blockChar: number): number {
  return contentStart + blockChar;
}

/** PM 位置 → 块内字符偏移 */
export function pmToBlockChar(contentStart: number, pmPos: number): number {
  return pmPos - contentStart;
}

/** 片段内字符偏移（相对片段首行行首）→ 块内字符偏移（可为负：回删越到上一行末尾） */
export function fragmentCharToBlockChar(
  fromLine: number,
  localChar: number,
  lineOffsets: readonly number[] | undefined,
  charsPerLine: number,
): number {
  return charOfLine(fromLine, lineOffsets, charsPerLine) + localChar;
}

/**
 * 片段单点（块, 起始行, 片段内偏移）→ PM 位置。
 *
 * @returns 命中块且落在 [0, doc.content.size] 内返回 PM 位置；否则 null（调用方按跨块处理）。
 */
export function resolveFragmentPoint(
  index: PagedIndex,
  blockId: string,
  fromLine: number,
  localChar: number,
  charsPerLine: number,
  docContentSize?: number,
): number | null {
  const loc = index.byId.get(blockId);
  if (loc === undefined) return null;
  const blockChar = fragmentCharToBlockChar(fromLine, localChar, loc.lineOffsets, charsPerLine);
  if (blockChar < 0) return null;
  const pmPos = blockCharToPm(loc.contentStart, blockChar);
  if (docContentSize !== undefined && pmPos > docContentSize) return null;
  return pmPos;
}

/**
 * 片段选区 [fromLocal, toLocal]（相对片段首行行首的字符偏移）→ PM 位置区间。
 *
 * @returns 命中块则返回 { from, to }（PM 文档坐标）；未命中返回 null（调用方回退）。
 */
export function resolveFragmentRange(
  index: PagedIndex,
  blockId: string,
  fromLine: number,
  fromLocal: number,
  toLocal: number,
  charsPerLine: number,
): { from: number; to: number } | null {
  const loc = index.byId.get(blockId);
  if (loc === undefined) return null;
  const fromChar = fragmentCharToBlockChar(fromLine, fromLocal, loc.lineOffsets, charsPerLine);
  const toChar = fragmentCharToBlockChar(fromLine, toLocal, loc.lineOffsets, charsPerLine);
  // 负偏移 = 越出块首（跨块边界），映射失败交调用方处理
  if (fromChar < 0 || toChar < 0) return null;
  return {
    from: blockCharToPm(loc.contentStart, fromChar),
    to: blockCharToPm(loc.contentStart, toChar),
  };
}

/**
 * PM 位置 → 所属块与块内字符偏移（重排后恢复光标用）。
 *
 * @returns ordered 中满足 contentStart <= pmPos 的最后一块；无则 null。
 */
export function locatePmPosition(
  index: PagedIndex,
  pmPos: number,
): { loc: PagedBlockLoc; blockChar: number } | null {
  let found: PagedBlockLoc | undefined;
  for (const loc of index.ordered) {
    if (loc.contentStart <= pmPos) found = loc;
    else break;
  }
  if (found === undefined) return null;
  return { loc: found, blockChar: pmPos - found.contentStart };
}
