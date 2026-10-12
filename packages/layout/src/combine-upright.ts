/**
 * 数字 / 英文直排合并规则（D3 补充的具体落地）
 *
 * 背景：竖排文本中，阿拉伯数字与拉丁字母的排布需要专门策略：
 * - 短数字串（如「2026」）：用 CSS `text-combine-upright` 合并进一格；
 * - 超长数字串（超过合并上限）：不合并，字符侧转（sideways），沿行方向顺排；
 * - 拉丁词（如「Web」）：默认侧转 90°（text-orientation: sideways）；
 * - 全角字符与汉字：原样直排。
 *
 * 本模块为纯函数，产出「分段策略」，供样式构建器 / 渲染层消费。
 */

/** 分段类型 */
export const SEGMENT_KINDS = {
  /** 汉字/全角：原样直排 */
  NATIVE: 'native',
  /** 数字串：按位数决定合并或侧转 */
  DIGITS: 'digits',
  /** 拉丁/其他半角：按策略侧转或合并 */
  LATIN: 'latin',
  /** 空白与标点 */
  SPACE: 'space',
} as const;

/** 分段类型联合 */
export type SegmentKind = (typeof SEGMENT_KINDS)[keyof typeof SEGMENT_KINDS];

/** 数字/英文直排处理策略 */
export interface CombineUprightOptions {
  /** 数字合并位数上限（不超过此位数时合并为一格，默认 4） */
  maxDigits: number;
  /** 拉丁词策略：rotate 侧转（默认）/ combine 并入字格 */
  latinStrategy: 'rotate' | 'combine';
}

/** 默认合并选项 */
export const DEFAULT_COMBINE_OPTIONS: CombineUprightOptions = {
  maxDigits: 4,
  latinStrategy: 'rotate',
};

/** 文本分段结果 */
export interface TextSegment {
  kind: SegmentKind;
  text: string;
  /** 该段的直排处理方式 */
  upright: 'as-is' | 'combine' | 'sideways';
}

/** 半角数字序列 */
const DIGITS_RE = /[0-9]+/;
/** 拉丁字母序列（含常见西文标点组合的单词段） */
const LATIN_RE = /[A-Za-z][A-Za-z'’-]*/;
/** 半角空白 */
const SPACE_RE = /\s+/;

/**
 * 将一段文本切分为直排策略片段
 *
 * 切分优先级：数字串 > 拉丁词 > 空白 > 原生字符（逐字符归并）。
 */
export function segmentForVertical(
  text: string,
  options: CombineUprightOptions = DEFAULT_COMBINE_OPTIONS,
): TextSegment[] {
  if (text.length === 0) return [];

  const segments: TextSegment[] = [];
  let cursor = 0;
  let nativeBuffer = '';

  const flushNative = (): void => {
    if (nativeBuffer.length > 0) {
      segments.push({ kind: SEGMENT_KINDS.NATIVE, text: nativeBuffer, upright: 'as-is' });
      nativeBuffer = '';
    }
  };

  while (cursor < text.length) {
    const rest = text.slice(cursor);

    const digitsMatch = DIGITS_RE.exec(rest);
    if (digitsMatch && digitsMatch.index === 0) {
      flushNative();
      const digits = digitsMatch[0];
      segments.push({
        kind: SEGMENT_KINDS.DIGITS,
        text: digits,
        upright: digits.length <= options.maxDigits ? 'combine' : 'sideways',
      });
      cursor += digits.length;
      continue;
    }

    const latinMatch = LATIN_RE.exec(rest);
    if (latinMatch && latinMatch.index === 0) {
      flushNative();
      const word = latinMatch[0];
      segments.push({
        kind: SEGMENT_KINDS.LATIN,
        text: word,
        upright: options.latinStrategy === 'combine' ? 'combine' : 'sideways',
      });
      cursor += word.length;
      continue;
    }

    const spaceMatch = SPACE_RE.exec(rest);
    if (spaceMatch && spaceMatch.index === 0) {
      flushNative();
      segments.push({
        kind: SEGMENT_KINDS.SPACE,
        text: spaceMatch[0],
        upright: 'as-is',
      });
      cursor += spaceMatch[0].length;
      continue;
    }

    // 原生字符（汉字、全角标点等）：逐字符归并
    nativeBuffer += text[cursor];
    cursor += 1;
  }

  flushNative();
  return segments;
}

/**
 * 生成 `text-combine-upright` 的 CSS 值
 *
 * @returns 如 "digits 4"；当禁用合并（maxDigits <= 0）时返回 undefined。
 */
export function combineUprightCss(
  options: CombineUprightOptions = DEFAULT_COMBINE_OPTIONS,
): string | undefined {
  if (options.maxDigits <= 0) return undefined;
  if (options.latinStrategy === 'combine') return 'all';
  return `digits ${options.maxDigits}`;
}

/** 判断文本是否包含需要直排特殊处理的字符（数字/拉丁） */
export function needsCombineUpright(text: string): boolean {
  return DIGITS_RE.test(text) || LATIN_RE.test(text);
}
