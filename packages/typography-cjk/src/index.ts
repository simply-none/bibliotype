/**
 * @bibliotype/typography-cjk 统一导出入口
 *
 * 中文排印三条规则，全部为纯函数（浏览器 / Node / SSR 通用）：
 * - 禁则避头尾：`findBreakOpportunities` / `resolveLineBreak` / `splitLines`；
 * - 标点挤压：`buildCompressionAdjustments`；
 * - 中西文混排间距：`needsCjkLatinGap` / `buildMixedSpacingSegments`；
 * - 声明输出：`buildCjkTypographyCss`（供书册样式表拼接）。
 */

/* ---------- 字符分类 ---------- */
export {
  isCjkPunctuation,
  isCjkLetter,
  isLatinLetter,
  isDigit,
  isLatinLike,
  isWhitespace,
  isHighSurrogate,
  isLowSurrogate,
} from './chars.js';

/* ---------- 禁则 ---------- */
export {
  KINSOKU_PROFILES,
  DEFAULT_KINSOKU_PROFILE,
  resolveKinsokuProfile,
  isForbiddenAtLineStart,
  isForbiddenAtLineEnd,
  findBreakOpportunities,
  resolveLineBreak,
  splitLines,
} from './kinsoku.js';
export type { KinsokuProfile, KinsokuProfileName, BreakOptions } from './kinsoku.js';

/* ---------- 标点挤压 ---------- */
export {
  DEFAULT_SQUEEZE_CHARS,
  findPunctuationRuns,
  buildCompressionAdjustments,
  totalSqueezeEm,
} from './compression.js';
export type {
  CompressionOptions,
  PunctuationRun,
  PunctuationAdjustment,
} from './compression.js';

/* ---------- 中西文混排 ---------- */
export {
  DEFAULT_MIXED_GAP_EM,
  classifyChar,
  needsCjkLatinGap,
  buildMixedSpacingSegments,
  countMixedGaps,
} from './mixed-spacing.js';
export type { SpacingClass, SpacingSegment, MixedSpacingOptions } from './mixed-spacing.js';

/* ---------- CSS ---------- */
export {
  LINE_BREAK_VALUES,
  buildCjkTypographyCss,
  cjkTypographyDeclarations,
} from './css.js';
export type { LineBreakValue, CjkTypographyCssOptions } from './css.js';
