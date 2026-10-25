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

/**
 * 节点聚合文本（与 node-slice / 估算器同口径；layout 内联避免反向依赖）
 */
export function collectNodeTextOf(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).reduce((sum, child) => sum + collectNodeTextOf(child), '');
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
  const capacity = Math.max(1, Math.round(charsPerSmallLine));
  const chars = [...text];
  const pairs: NotePair[] = [];
  let index = 0;

  /* 首对右列留空一位：夹注起于行中（被注字之后），右列首字低一格 */
  if (options.indentFirstPair === true && chars.length > capacity - 1 && capacity > 1) {
    const right = chars.slice(0, capacity - 1).join('');
    index = capacity - 1;
    pairs.push([right, '']);
  }

  while (index < chars.length) {
    const right = chars.slice(index, index + capacity).join('');
    index += capacity;
    const left = chars.slice(index, index + capacity).join('');
    index += capacity;
    pairs.push([right, left]);
  }

  /* 空文本：一对空列（渲染为空盒，保持占位语义可预测） */
  if (pairs.length === 0) pairs.push(['', '']);
  return pairs;
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
