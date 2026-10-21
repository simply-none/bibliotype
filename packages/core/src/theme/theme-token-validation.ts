/**
 * 主题令牌值校验（D10）
 *
 * 主题包来自用户剪贴板 / 文件，是**不可信输入**：值最终会进入 CSS 变量，
 * 因此校验口径为「结构从严、语法从宽」——未知令牌键与坏版本必拒，
 * 取值只拦注入风险（`;` `{}` `<>` `url(`）与明显非法的格式，
 * 不追求穷举 CSS 语法（浏览器才是最终裁决者）。
 */
import {
  COLOR_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
  type ThemeToken,
} from './tokens.js';

/** 全部令牌键（规范顺序：字体 → 字号 → 版式 → 颜色，序列化按此排序） */
export const THEME_TOKEN_KEYS: readonly ThemeToken[] = [
  FONT_TOKENS.BODY,
  FONT_TOKENS.HEADING,
  FONT_TOKENS.CLASSICAL_BODY,
  FONT_TOKENS.MONO,
  FONT_SIZE_TOKENS.BODY,
  FONT_SIZE_TOKENS.NOTE,
  FONT_SIZE_TOKENS.HEADING,
  LAYOUT_TOKENS.LINE_HEIGHT,
  LAYOUT_TOKENS.LETTER_SPACING,
  LAYOUT_TOKENS.TEXT_INDENT,
  LAYOUT_TOKENS.PAGE_MARGIN,
  LAYOUT_TOKENS.COLUMN_GAP,
  COLOR_TOKENS.TEXT,
  COLOR_TOKENS.BACKGROUND,
  COLOR_TOKENS.NOTE_TEXT,
  COLOR_TOKENS.ACCENT,
];

/** 单条令牌问题 */
export interface ThemeTokenIssue {
  /** 令牌键（未知键时为原始键名） */
  token: string;
  /** 中文说明（面向用户，可直接展示） */
  message: string;
}

/** 校验结果：合法令牌 + 问题清单（有问题不代表整体失败，由调用方决定是否拒绝） */
export interface ThemeTokenValidationResult {
  /** 校验通过的令牌 */
  tokens: Partial<Record<ThemeToken, string>>;
  /** 问题清单（键未知 / 值非法） */
  issues: ThemeTokenIssue[];
}

const FONT_FAMILY_TOKENS: ReadonlySet<string> = new Set(Object.values(FONT_TOKENS));
const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(Object.values(COLOR_TOKENS));
const LAYOUT_TOKEN_SET: ReadonlySet<string> = new Set(Object.values(LAYOUT_TOKENS));
const FONT_SIZE_TOKEN_SET: ReadonlySet<string> = new Set(Object.values(FONT_SIZE_TOKENS));

/** 注入风险字符：进入 CSS 变量后不得包含声明分隔符与标签尖括号 */
const UNSAFE_CHARS = /[;{}<>]/;
/** CSS 远程引用（主题包不允许外链资源） */
const URL_FUNCTION = /url\s*\(/i;
/** 允许的函数式取值前缀（calc / var / clamp / min / max） */
const FUNCTIONAL_VALUE = /^(?:calc|var|clamp|min|max)\(/i;
/** 纯长度：数字 + 可选单位 */
const PLAIN_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|pt|pc|ex|ch|vh|vw|vmin|vmax|cm|mm|in|q)?$/i;
/** 十六进制颜色 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** 颜色函数与色名 */
const COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i;
const COLOR_KEYWORD = /^(?:transparent|currentcolor|[a-z]+)$/i;

/** 是否为已注册令牌键 */
export function isThemeToken(value: string): value is ThemeToken {
  return THEME_TOKEN_KEYS.includes(value as ThemeToken);
}

/** 是否包含危险字符（分号 / 花括号 / 尖括号 / url()） */
function hasUnsafeChars(value: string): boolean {
  return UNSAFE_CHARS.test(value) || URL_FUNCTION.test(value);
}

/** 括号是否成对（函数式取值的最小完整性检查） */
function hasBalancedParens(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** 单个长度值是否合法（允许 calc/var 等函数式取值） */
function isLengthValue(value: string): boolean {
  if (PLAIN_LENGTH.test(value)) return true;
  return FUNCTIONAL_VALUE.test(value) && hasBalancedParens(value);
}

/** 按顶层空格切分（`calc(1rem + 4px)` 内部的空格不切） */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (depth === 0 && /\s/.test(char)) {
      if (current !== '') parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current !== '') parts.push(current);
  return parts;
}

/** 字体族：非空、不含危险字符、长度合理（声明顺序交给 CSS） */
function validateFontFamily(value: string): string | undefined {
  if (value.trim() === '') return '字体族不能为空';
  if (value.length > 200) return '字体族过长（最多 200 个字符）';
  if (hasUnsafeChars(value)) return '字体族包含非法字符（; { } < > 或 url()）';
  return undefined;
}

/** 颜色：十六进制 / 颜色函数 / 关键字 / var() */
function validateColor(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return '颜色不能为空';
  if (hasUnsafeChars(trimmed)) return '颜色包含非法字符（; { } < > 或 url()）';
  if (HEX_COLOR.test(trimmed) || COLOR_FUNCTION.test(trimmed) || COLOR_KEYWORD.test(trimmed)) {
    return undefined;
  }
  if (FUNCTIONAL_VALUE.test(trimmed) && hasBalancedParens(trimmed)) return undefined;
  return `颜色格式无法识别：${trimmed}`;
}

/** 版式取值：page-margin 允许 1~4 个长度，其余单值；line-height / letter-spacing 允许 normal */
function validateLayoutValue(token: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return '取值不能为空';
  if (hasUnsafeChars(trimmed)) return '取值包含非法字符（; { } < > 或 url()）';
  if (token === LAYOUT_TOKENS.LINE_HEIGHT || token === LAYOUT_TOKENS.LETTER_SPACING) {
    if (trimmed.toLowerCase() === 'normal') return undefined;
  }
  if (token === LAYOUT_TOKENS.PAGE_MARGIN) {
    const parts = splitTopLevel(trimmed);
    if (parts.length === 0 || parts.length > 4) return '页边距需为 1~4 个长度值';
    const invalid = parts.find((part) => !isLengthValue(part));
    return invalid === undefined ? undefined : `页边距取值无法识别：${invalid}`;
  }
  if (!isLengthValue(trimmed)) return `取值需为长度（数字 + 单位）：${trimmed}`;
  return undefined;
}

/**
 * 校验单个令牌值
 *
 * @param token 令牌键
 * @param value 待校验值（非字符串一律判非法）
 * @returns 非法时返回中文说明；合法返回 `undefined`
 */
export function validateThemeTokenValue(token: ThemeToken, value: unknown): string | undefined {
  if (typeof value !== 'string') return '取值需为字符串';
  if (value.trim() === '') return '取值不能为空';
  if (value.length > 400) return '取值过长（最多 400 个字符）';
  if (FONT_FAMILY_TOKENS.has(token)) return validateFontFamily(value);
  if (FONT_SIZE_TOKEN_SET.has(token)) return validateLayoutValue(token, value);
  if (LAYOUT_TOKEN_SET.has(token)) return validateLayoutValue(token, value);
  if (COLOR_TOKEN_SET.has(token)) return validateColor(value);
  return '未知的主题令牌';
}

/**
 * 校验令牌集合
 *
 * @param raw 不可信输入（通常来自 JSON）
 * @returns 合法令牌与问题清单
 */
export function validateThemeTokens(raw: unknown): ThemeTokenValidationResult {
  const tokens: Partial<Record<ThemeToken, string>> = {};
  const issues: ThemeTokenIssue[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push({ token: '', message: 'tokens 需为对象（键为令牌名，值为字符串）' });
    return { tokens, issues };
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isThemeToken(key)) {
      issues.push({ token: key, message: `未知的主题令牌：${key}` });
      continue;
    }
    const problem = validateThemeTokenValue(key, value);
    if (problem !== undefined) {
      issues.push({ token: key, message: `${key}：${problem}` });
      continue;
    }
    tokens[key] = (value as string).trim();
  }
  return { tokens, issues };
}
