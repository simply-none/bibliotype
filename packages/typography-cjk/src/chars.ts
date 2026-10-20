/**
 * 字符分类（CJK 排印的判定基础）
 *
 * 全部基于 Unicode 码位区间判断，不依赖 Intl / 正则 Unicode 属性转义
 * （target ES2020 下 `\p{Script=Han}` 在部分构建链不可靠），保证浏览器与 Node 一致。
 */

/** 全角 / 中文标点区间 */
const CJK_PUNCTUATION_RANGES: readonly (readonly [number, number])[] = [
  [0x3000, 0x303f], // CJK 符号和标点
  [0xfe10, 0xfe1f], // 竖排标点
  [0xfe30, 0xfe4f], // CJK 兼容形式
  [0xff01, 0xff0f], // 全角 ASCII 标点（！＂＃…）
  [0xff1a, 0xff20], // 全角 ：；＜＝＞？＠
  [0xff3b, 0xff40], // 全角 ［＼］＾＿｀
  [0xff5b, 0xff65], // 全角 ｛｜｝～ 等
];

/** 汉字 / 假名 / 谚文区间 */
const CJK_LETTER_RANGES: readonly (readonly [number, number])[] = [
  [0x3040, 0x30ff], // 平假名 / 片假名
  [0x3400, 0x4dbf], // 扩展 A
  [0x4e00, 0x9fff], // 基本区
  [0xf900, 0xfaff], // 兼容汉字
  [0xac00, 0xd7af], // 谚文音节
  [0x20000, 0x2fa1f], // 扩展 B~F / 兼容补充
];

function inRanges(code: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const range of ranges) {
    if (code >= range[0] && code <= range[1]) {
      return true;
    }
  }
  return false;
}

/** 是否 CJK 标点（全角标点、竖排标点） */
export function isCjkPunctuation(char: string): boolean {
  if (!char) {
    return false;
  }
  return inRanges(char.charCodeAt(0), CJK_PUNCTUATION_RANGES);
}

/** 是否汉字 / 假名 / 谚文（广义 CJK 文字） */
export function isCjkLetter(char: string): boolean {
  if (!char) {
    return false;
  }
  return inRanges(char.charCodeAt(0), CJK_LETTER_RANGES);
}

/** 是否 ASCII 拉丁字母 */
export function isLatinLetter(char: string): boolean {
  return /^[A-Za-z]$/.test(char);
}

/** 是否 ASCII 数字 */
export function isDigit(char: string): boolean {
  return char.length === 1 && char >= '0' && char <= '9';
}

/** 是否拉丁文或数字（混排间距的一侧） */
export function isLatinLike(char: string): boolean {
  return isLatinLetter(char) || isDigit(char);
}

/** 是否空白（空格 / 制表 / 全角空格 / 换行） */
export function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\u3000';
}

/**
 * 是否代理对的高位（用于避免把 emoji / 扩展区汉字从中间截断）
 *
 * 注意：本包其余接口以「UTF-16 码元下标」为坐标轴，与 JS 字符串一致；
 * 断行只拦「高位 + 低位之间」这一种非法切分。
 */
export function isHighSurrogate(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdbff;
}

/** 是否低位代理 */
export function isLowSurrogate(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
}
