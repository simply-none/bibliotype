/**
 * CJK 排印的 CSS 声明生成
 *
 * 与书册样式同源：返回 kebab-case 声明对象，交由 `buildBookCss` / 打印样式 /
 * 站点样式统一拼接（禁止在组件里写全局选择器）。
 */
import { DEFAULT_KINSOKU_PROFILE } from './kinsoku.js';
import type { KinsokuProfileName } from './kinsoku.js';

/** CSS `line-break` 取值 */
export const LINE_BREAK_VALUES = ['strict', 'normal', 'loose', 'anywhere'] as const;

/** CSS `line-break` 取值联合 */
export type LineBreakValue = (typeof LINE_BREAK_VALUES)[number];

/** 排印 CSS 选项 */
export interface CjkTypographyCssOptions {
  /** 禁则配置名（仅用于取值决策：ja 用 normal，中文用 strict） */
  profile?: KinsokuProfileName;
  /** 是否启用标点挤压（`text-spacing-trim`） */
  punctuationCompression?: boolean;
  /** 是否启用中西文混排间距（`text-autospace`） */
  mixedSpacing?: boolean;
  /** 是否启用行首行尾标点悬挂（`hanging-punctuation`） */
  hangingPunctuation?: boolean;
  /** 显式指定 `line-break`（缺省按配置推导） */
  lineBreak?: LineBreakValue;
}

/**
 * 生成 CJK 排印声明
 *
 * 说明：`text-spacing-trim` / `text-autospace` 属 CSS Text 4，Chromium 已支持
 * `text-autospace`，`text-spacing-trim` 支持度较低。不支持的环境不会报错，
 * 仅退化为「不挤压 / 不插距」——文本层因此另提供 `buildCompressionAdjustments`
 * 与 `buildMixedSpacingSegments` 作为确定性兜底。
 */
export function buildCjkTypographyCss(
  options: CjkTypographyCssOptions = {},
): Record<string, string> {
  const profile = options.profile ?? DEFAULT_KINSOKU_PROFILE;
  const lineBreak = options.lineBreak ?? (profile === 'ja' ? 'normal' : 'strict');
  const declarations: Record<string, string> = {
    'line-break': lineBreak,
    'word-break': 'normal',
    'overflow-wrap': 'break-word',
  };
  if (options.punctuationCompression) {
    declarations['text-spacing-trim'] = 'space-first';
  }
  if (options.mixedSpacing) {
    declarations['text-autospace'] = 'normal';
  }
  if (options.hangingPunctuation) {
    declarations['hanging-punctuation'] = 'first last';
  }
  return declarations;
}

/** 把声明对象序列化为 CSS 声明串（不含选择器与花括号） */
export function cjkTypographyDeclarations(options: CjkTypographyCssOptions = {}): string {
  return Object.entries(buildCjkTypographyCss(options))
    .map(([property, value]) => `${property}: ${value};`)
    .join(' ');
}
