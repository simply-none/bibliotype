/**
 * 书册样式表生成（@bibliotype/layout/html）
 *
 * 将「主题令牌 + 布局选项」编译为可直接使用的 CSS 文本，
 * 供 EPUB（style.css）与 PDF（打印稿内联 <style>）共用：
 * - :root 输出 --bt-* 变量（令牌的 CSS Variables 层）；
 * - body 规则通过 var() 引用变量，书写方向 / 直排策略 / 分栏由布局选项决定；
 * - .bt-* 节点类与 html-serializer 的 class 输出配套，开箱即有基础排版。
 */
import {
  COLOR_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
} from '@bibliotype/core';
import { combineUprightCss } from '../combine-upright.js';
import type { LayoutOptions } from '../layout-options.js';
import { buildCssVariables, type StyleDeclaration } from '../style-builder.js';
import { isVerticalMode } from '../writing-mode.js';

/** CSS 声明对象 → CSS 文本（每条声明一行，缩进两格） */
export function declarationToCss(declaration: StyleDeclaration): string {
  return Object.entries(declaration)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
}

/** 书册样式生成输入 */
export interface BuildBookCssOptions {
  /** 主题令牌值表（来自 ThemeAccessor.all() 或 DEFAULT_THEME，允许扩展键） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 布局选项 */
  options: LayoutOptions;
  /** 正文字体族令牌键（默认 FONT_TOKENS.BODY，古籍可传 CLASSICAL_BODY） */
  fontToken?: string;
}

/** 生成书册基础样式表（变量层 + body 规则 + 节点类样式） */
export function buildBookCss(input: BuildBookCssOptions): string {
  const { tokens, options } = input;
  const fontToken = input.fontToken ?? FONT_TOKENS.BODY;
  const vertical = isVerticalMode(options.writingMode);

  const rules: string[] = [];

  /* ---------- 1. 变量层：--bt-* ---------- */
  const variables = buildCssVariables(tokens);
  const variableLines = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  rules.push(`:root {\n${variableLines}\n}`);

  /* ---------- 2. body 基础规则 ---------- */
  const body: StyleDeclaration = {
    margin: '0',
    'font-family': `var(--bt-${fontToken})`,
    'font-size': `var(--bt-${FONT_SIZE_TOKENS.BODY})`,
    'line-height': `var(--bt-${LAYOUT_TOKENS.LINE_HEIGHT})`,
    'letter-spacing': `var(--bt-${LAYOUT_TOKENS.LETTER_SPACING})`,
    color: `var(--bt-${COLOR_TOKENS.TEXT})`,
    'background-color': `var(--bt-${COLOR_TOKENS.BACKGROUND})`,
    'writing-mode': options.writingMode,
  };
  if (vertical) {
    body['text-orientation'] = tokens['text-orientation'] ?? 'mixed';
    const combine = combineUprightCss(options.combineUpright);
    if (combine !== undefined) {
      body['text-combine-upright'] = combine;
    }
  }
  if (options.columns > 1) {
    body['column-count'] = String(options.columns);
    body['column-gap'] = `var(--bt-${LAYOUT_TOKENS.COLUMN_GAP})`;
  }
  rules.push(`body {\n${declarationToCss(body)}\n}`);

  /* ---------- 3. 节点类样式（与 bt-* class 配套） ---------- */
  rules.push(`.bt-paragraph {
  margin: 0;
  text-indent: var(--bt-${LAYOUT_TOKENS.TEXT_INDENT});
}
.bt-heading {
  font-family: var(--bt-${FONT_TOKENS.HEADING});
  font-size: var(--bt-${FONT_SIZE_TOKENS.HEADING});
  line-height: 1.4;
}
.bt-quote {
  margin: 1em 2em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
.bt-list {
  margin: 0.5em 0;
  padding-inline-start: 1.6em;
}
.bt-code-block {
  font-family: var(--bt-${FONT_TOKENS.MONO});
  font-size: 0.85em;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.bt-caption,
.bt-footnote,
.bt-endnote,
.bt-margin-note {
  font-size: var(--bt-${FONT_SIZE_TOKENS.NOTE});
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
.bt-footnote,
.bt-endnote,
.bt-margin-note {
  display: block;
  margin: 0.5em 0;
}
.bt-table {
  border-collapse: collapse;
  margin: 1em 0;
}
.bt-table-cell {
  border: 1px solid var(--bt-${COLOR_TOKENS.TEXT});
  padding: 0.25em 0.6em;
}
.bt-image {
  max-width: 100%;
}
.bt-break {
  border: 0;
  border-block-start: 1px solid var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  margin: 1em 0;
}
.bt-mark-underline {
  text-decoration: underline;
}
.bt-mark-strikethrough {
  text-decoration: line-through;
}
.bt-mark-highlight {
  background-color: rgba(255, 235, 130, 0.45);
}
.bt-mark-link {
  color: var(--bt-${COLOR_TOKENS.ACCENT});
}
.bt-math-block {
  margin: 1em 0;
  text-align: center;
}
ruby > rt {
  font-size: 0.5em;
}`);

  return `${rules.join('\n\n')}\n`;
}
