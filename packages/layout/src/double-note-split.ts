/**
 * 双行夹注拆分（古籍直排 v2 批 2）
 *
 * 古籍口径（考证）：夹注小字 ≈ 正文之半，n 字占 n/2 字位；注文以**双行小字**
 * 随文连排——右子列自上读到底，余文续左子列；长注按「每子列容量」切成
 * 多个**子列对**（每对占 1 个大字位宽），对与对在行内流中相续（下一对在
 * 左侧接排），超过列高自动换列。
 *
 * 本模块纯函数拆分：给定注文文本与「每子列可容纳的小字数」，产出
 * `[右列, 左列][]` 子列对序列；`indentFirstPair` 实现回行缩格（首对
 * 右列留空——夹注起于行中、回行段对齐注首的古籍规格）。
 */
import { isTextNode, type BookNode } from '@bibliotype/core';

/** 双行夹注拆分选项 */
export interface SplitDoubleNoteOptions {
  /**
   * 回行缩格：首对右列留空一位（夹注起于行中被注字之后、注首低一格）
   *
   * 缺省 false（整段独立夹注的常规形态：首对即两列俱全）。
   */
  indentFirstPair?: boolean;
}

/** 一对子列：[右列文本, 左列文本]（右列先读；空串 = 该列留白） */
export type NotePair = readonly [string, string];

/** 子列窗口：注文源文本的 UTF-16 码元半开区间 [start, end) */
export interface NoteColumnSpan {
  start: number;
  end: number;
}

/** 一对子列的切分计划（文本与窗口同源，供切片 / 纯文本两类消费方共用） */
export interface NotePairPlan {
  /** 右 / 左子列文本（已代理对防劈） */
  pair: NotePair;
  /** 右列码元窗口（与 sliceNodeByCharRange / collectNodeText / DOM Range 同轴） */
  right: NoteColumnSpan;
  /** 左列码元窗口（留白列为零宽区间） */
  left: NoteColumnSpan;
  /** 本对右列是否缩格（仅首对可真：渲染侧在右列首补 1 字位空位盒） */
  indented?: boolean;
}

/**
 * 节点聚合文本（与 node-slice / 估算器同口径；layout 内联避免反向依赖）
 */
export function collectNodeTextOf(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).reduce((sum, child) => sum + collectNodeTextOf(child), '');
}

/**
 * 码元边界防劈代理对：边界落在高低代理之间时回退一位（整对归前段）
 *
 * 文本轴统一为 UTF-16 码元（与 `nodeTextLength` / `collectNodeText` / DOM
 * Range 一致），astral 字符（扩展 B–F 区汉字、emoji）的列边界可能落在
 * 代理对中间——回退一位宁可该列少排一字，也不产出孤代理（孤代理经序列化
 * 即非法 XML，EPUB 整本拒开）。
 */
function snapBoundary(text: string, pos: number): number {
  const prev = text.charCodeAt(pos - 1);
  const next = text.charCodeAt(pos);
  if (
    pos > 0 &&
    pos < text.length &&
    prev >= 0xd800 &&
    prev <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  ) {
    return pos - 1;
  }
  return pos;
}

/**
 * 拆分双行夹注为「子列对 + 码元窗口」计划（切分的唯一事实源）
 *
 * 文本轴为 UTF-16 码元：窗口直接喂 {@link sliceNodeByCharRange}（行内标记
 * 随子列保留），文本窗口互为镜像，二者不可能漂移。代理对按
 * {@link snapBoundary} 防劈。
 *
 * @param text 注文全文（`collectNodeTextOf` 产物）
 * @param charsPerSmallLine 每子列可容纳的小字数（= 每行大字数 × 2）
 * @param options 见 {@link SplitDoubleNoteOptions}
 */
export function planDoubleNoteColumns(
  text: string,
  charsPerSmallLine: number,
  options: SplitDoubleNoteOptions = {},
): NotePairPlan[] {
  const capacity = Math.max(1, Math.round(charsPerSmallLine));
  const plans: NotePairPlan[] = [];
  const total = text.length;

  /** 按窗口取列文本（已防劈，边界即安全码元位） */
  const columnText = (span: NoteColumnSpan): string =>
    text.slice(span.start, span.end);

  let index = 0;
  /* 首对右列少排一位（窗口 [0, cap-1)）并标记 indented：渲染侧在右列首补
   * 1 字位空位盒，实现「夹注起于行中、注首低一格」；短注（≤ cap-1 字）
   * 不做缩格——空位盒与缩窗必须同时发生，否则该列多占 / 少占一格 */
  if (options.indentFirstPair === true && total > capacity - 1 && capacity > 1) {
    const end = snapBoundary(text, capacity - 1);
    const right: NoteColumnSpan = { start: 0, end };
    plans.push({ pair: [columnText(right), ''], right, left: { start: end, end }, indented: true });
    index = end;
  }

  while (index < total) {
    const rightEnd = snapBoundary(text, Math.min(index + capacity, total));
    const right: NoteColumnSpan = { start: index, end: rightEnd };
    let left: NoteColumnSpan = { start: rightEnd, end: rightEnd };
    if (rightEnd < total) {
      const leftEnd = snapBoundary(text, Math.min(rightEnd + capacity, total));
      left = { start: rightEnd, end: leftEnd };
      index = leftEnd;
    } else {
      index = rightEnd;
    }
    plans.push({ pair: [columnText(right), columnText(left)], right, left });
  }

  /* 空文本：一对空列（渲染为空盒，保持占位语义可预测） */
  if (plans.length === 0) {
    plans.push({ pair: ['', ''], right: { start: 0, end: 0 }, left: { start: 0, end: 0 } });
  }
  return plans;
}

/**
 * 拆分双行夹注文本为子列对序列
 *
 * @param text 注文全文（纯文本；标记已在序列化时随子内容处理，此处按
 *   字符长度切分）
 * @param charsPerSmallLine 每子列可容纳的小字数（= 每行大字数 × 2，
 *   由调用方按版心高与小字号折算）
 * @param options 见 {@link SplitDoubleNoteOptions}
 * @returns 子列对序列：`[['子曰学而时习', '之不亦说乎'], …]`——每对渲染为
 *   1 个大字位宽的双列小字盒，对序即阅读序（右对先读）
 */
export function splitDoubleNoteLines(
  text: string,
  charsPerSmallLine: number,
  options: SplitDoubleNoteOptions = {},
): NotePair[] {
  return planDoubleNoteColumns(text, charsPerSmallLine, options).map((plan) => plan.pair);
}

/**
 * 双行夹注的占位字位数（估算口径）
 *
 * n 字 → ceil(n / 2) 字位（每子列容量足额时两列并行）；供无 DOM 导出
 * 路径的行容量折算，与渲染侧浏览器实测（inline-block 盒高 / 列距）同义。
 */
export function doubleNotePlaceholderChars(textLength: number): number {
  return Math.max(1, Math.ceil(textLength / 2));
}
