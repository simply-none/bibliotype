/**
 * 主题令牌定义
 *
 * 设计为 CSS Variables 风格（kebab-case），双层结构（对应调研清单 § 九）：
 * - Token 层：语义令牌（本文件），描述"是什么"（如 font-family-body）；
 * - CSS Variables 层：由渲染层将令牌映射为 --bt-* 变量。
 *
 * 命名约定：`--bt-<group>-<name>`，bt 为 bibliotype 缩写。
 */

/** 字体族令牌 */
export const FONT_TOKENS = {
  /** 正文字体族（含 CJK/拉丁回退链，对应 D3 补充） */
  BODY: 'font-family-body',
  /** 标题字体族 */
  HEADING: 'font-family-heading',
  /** 古籍正文字体族（宋体/楷体等） */
  CLASSICAL_BODY: 'font-family-classical-body',
  /** 等宽字体族（代码） */
  MONO: 'font-family-mono',
} as const;

/** 字号令牌 */
export const FONT_SIZE_TOKENS = {
  /** 正文基准字号 */
  BODY: 'font-size-body',
  /** 注释字号（脚注/夹注） */
  NOTE: 'font-size-note',
  /** 标题字号（h1 基准，逐级缩放由渲染层计算） */
  HEADING: 'font-size-heading',
} as const;

/** 空间与版式令牌 */
export const LAYOUT_TOKENS = {
  /** 正文行高 */
  LINE_HEIGHT: 'line-height-body',
  /** 字距（letter-spacing） */
  LETTER_SPACING: 'letter-spacing-body',
  /** 首行缩进（现代书 2em / 古籍 0） */
  TEXT_INDENT: 'text-indent-body',
  /** 页边距 */
  PAGE_MARGIN: 'page-margin',
  /** 栏间距 */
  COLUMN_GAP: 'column-gap',
} as const;

/** 颜色令牌 */
export const COLOR_TOKENS = {
  /** 正文文字色 */
  TEXT: 'color-text',
  /** 背景色 */
  BACKGROUND: 'color-background',
  /** 注释文字色 */
  NOTE_TEXT: 'color-note-text',
  /** 强调色（链接、交互） */
  ACCENT: 'color-accent',
} as const;

/** 全部令牌键联合类型 */
export type ThemeToken =
  | (typeof FONT_TOKENS)[keyof typeof FONT_TOKENS]
  | (typeof FONT_SIZE_TOKENS)[keyof typeof FONT_SIZE_TOKENS]
  | (typeof LAYOUT_TOKENS)[keyof typeof LAYOUT_TOKENS]
  | (typeof COLOR_TOKENS)[keyof typeof COLOR_TOKENS];
