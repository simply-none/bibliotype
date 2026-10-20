/**
 * 中西文混排间距
 *
 * 汉字与拉丁字母 / 数字紧邻时（`中文abc`、`第3章`），纸书会插入 1/4 em 的视觉间隙。
 * 本模块只做**判定与分段**，不修改文本内容——插入真实空格会污染文本、破坏搜索与
 * 复制粘贴，渲染层应通过 CSS（`text-autospace`）或分段包裹实现。
 */
import { isCjkLetter, isCjkPunctuation, isLatinLike, isWhitespace } from './chars.js';

/** 缺省间距（em） */
export const DEFAULT_MIXED_GAP_EM = 0.25;

/** 字符的混排类别 */
export type SpacingClass = 'cjk' | 'latin' | 'other';

/** 分类判定（标点与空白视为 other，不参与间距） */
export function classifyChar(char: string): SpacingClass {
  if (isWhitespace(char) || isCjkPunctuation(char)) {
    return 'other';
  }
  if (isCjkLetter(char)) {
    return 'cjk';
  }
  if (isLatinLike(char)) {
    return 'latin';
  }
  return 'other';
}

/** 该对相邻字符之间是否需要间距 */
export function needsCjkLatinGap(prev: string, next: string): boolean {
  const left = classifyChar(prev);
  const right = classifyChar(next);
  return (
    (left === 'cjk' && right === 'latin') || (left === 'latin' && right === 'cjk')
  );
}

/** 混排分段（同类别连续字符合并为一段） */
export interface SpacingSegment {
  /** 段文本 */
  text: string;
  /** 段前需插入的间距（em，0 表示紧贴） */
  gapBeforeEm: number;
  /** 段类别 */
  class: SpacingClass;
}

/** 分段选项 */
export interface MixedSpacingOptions {
  /** 间距量（em，缺省 0.25） */
  gapEm?: number;
}

/**
 * 切分为带间距标注的段序列
 *
 * 相邻同类字符合并为一段；当类别在 cjk ↔ latin 之间切换时，新段标注 `gapBeforeEm`。
 * 返回值仅描述「哪里要留白」，文本内容原样保留（各段 text 拼接 === 原文本）。
 */
export function buildMixedSpacingSegments(
  text: string,
  options: MixedSpacingOptions = {},
): SpacingSegment[] {
  const gapEm = options.gapEm ?? DEFAULT_MIXED_GAP_EM;
  const segments: SpacingSegment[] = [];
  let current: SpacingSegment | undefined;
  let previousClass: SpacingClass | undefined;

  for (const char of text) {
    const charClass = classifyChar(char);
    if (current && current.class === charClass) {
      current.text += char;
      continue;
    }
    const gap =
      previousClass !== undefined &&
      ((previousClass === 'cjk' && charClass === 'latin') ||
        (previousClass === 'latin' && charClass === 'cjk'))
        ? gapEm
        : 0;
    current = { text: char, gapBeforeEm: gap, class: charClass };
    segments.push(current);
    previousClass = charClass;
  }

  return segments;
}

/** 统计需要插入间距的位置数量（用于评估渲染开销 / 生成测试断言） */
export function countMixedGaps(text: string): number {
  let count = 0;
  for (let index = 1; index < text.length; index += 1) {
    if (needsCjkLatinGap(text[index - 1] ?? '', text[index] ?? '')) {
      count += 1;
    }
  }
  return count;
}
