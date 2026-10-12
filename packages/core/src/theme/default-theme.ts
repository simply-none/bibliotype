/**
 * 默认主题值
 *
 * 提供"现代书籍"基准样式；古籍主题由 @bibliotype/classical 覆盖。
 * 字体回退链体现 D3 补充：CJK 主体 → 拉丁主体 → 数字 → 系统兜底。
 */
import {
  FONT_TOKENS,
  FONT_SIZE_TOKENS,
  LAYOUT_TOKENS,
  COLOR_TOKENS,
  type ThemeToken,
} from './tokens.js';

/** 系统字体兜底链（跨平台） */
const SYSTEM_FALLBACK =
  "-apple-system, 'Segoe UI', 'Noto Sans', 'Microsoft YaHei', sans-serif";

/** 西文衬线回退（保证拉丁与数字字形美观，D3 补充） */
const LATIN_SERIF = "'Source Serif 4', 'EB Garamond', Georgia, serif";

/** 默认主题令牌值 */
export const DEFAULT_THEME: Readonly<Record<ThemeToken, string>> = {
  /* 字体族：CJK 主体在前，西文衬线负责拉丁/数字字形 */
  [FONT_TOKENS.BODY]: `'Noto Serif SC', 'Source Han Serif SC', ${LATIN_SERIF}, ${SYSTEM_FALLBACK}`,
  [FONT_TOKENS.HEADING]: `'Noto Sans SC', 'Source Han Sans SC', ${SYSTEM_FALLBACK}`,
  [FONT_TOKENS.CLASSICAL_BODY]: `'Noto Serif SC', 'Source Han Serif SC', ${LATIN_SERIF}, serif`,
  [FONT_TOKENS.MONO]: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",

  /* 字号 */
  [FONT_SIZE_TOKENS.BODY]: '16px',
  [FONT_SIZE_TOKENS.NOTE]: '0.75em',
  [FONT_SIZE_TOKENS.HEADING]: '1.75em',

  /* 版式 */
  [LAYOUT_TOKENS.LINE_HEIGHT]: '1.9',
  [LAYOUT_TOKENS.LETTER_SPACING]: '0.02em',
  [LAYOUT_TOKENS.TEXT_INDENT]: '2em',
  [LAYOUT_TOKENS.PAGE_MARGIN]: '48px 56px',
  [LAYOUT_TOKENS.COLUMN_GAP]: '2.5em',

  /* 颜色 */
  [COLOR_TOKENS.TEXT]: '#2c2c2c',
  [COLOR_TOKENS.BACKGROUND]: '#faf8f4',
  [COLOR_TOKENS.NOTE_TEXT]: '#6b6b6b',
  [COLOR_TOKENS.ACCENT]: '#8c5a2b',
};
