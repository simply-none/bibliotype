/**
 * 页码格式化
 *
 * 对应 layout 的 PAGE_NUMBER_STYLES：
 * - decimal：阿拉伯数字；
 * - chinese：中文数字（古籍页码，如「一百零五」）；
 * - roman：罗马数字（前言/序常用）。
 */

/** 中文数字（0~9） */
const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/**
 * 数字 → 中文数字（支持 1~999，页码场景足够）
 */
export function toChineseNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    throw new RangeError(`中文数字仅支持 0~999 的整数页码：${value}`);
  }
  if (value < 10) return CHINESE_DIGITS[value] as string;

  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;

  let result = '';
  if (hundreds > 0) {
    result += `${CHINESE_DIGITS[hundreds]}百`;
    if (tens === 0 && ones > 0) {
      result += '零';
    }
  }
  if (tens > 0) {
    // 十位为 1 且为最高位时不写「一十」（如 11 → 十一）
    if (!(hundreds === 0 && tens === 1)) {
      result += CHINESE_DIGITS[tens] as string;
    }
    result += '十';
  }
  if (ones > 0) {
    result += CHINESE_DIGITS[ones];
  }
  return result;
}

/** 罗马数字表（千/百/十位） */
const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/**
 * 数字 → 罗马数字（支持 1~3999）
 *
 * @param uppercase 是否大写（默认小写）
 */
export function toRomanNumeral(value: number, uppercase = false): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) {
    throw new RangeError(`罗马数字仅支持 1~3999 的整数页码：${value}`);
  }
  let remaining = value;
  let result = '';
  for (const [amount, symbol] of ROMAN_TABLE) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return uppercase ? result.toUpperCase() : result;
}

/** 支持的页码样式 */
export type PageNumberStyle = 'decimal' | 'chinese' | 'roman';

/**
 * 按样式格式化页码
 *
 * @param pageNumber 页码（自 1 起）
 * @param style 页码样式（未知样式回退为 decimal）
 */
export function formatPageNumber(pageNumber: number, style: PageNumberStyle): string {
  switch (style) {
    case 'chinese':
      return toChineseNumeral(pageNumber);
    case 'roman':
      return toRomanNumeral(pageNumber);
    default:
      return String(pageNumber);
  }
}
