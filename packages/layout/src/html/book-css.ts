/**
 * 书册样式表生成（@bibliotype/layout/html）
 *
 * 将「主题令牌 + 布局选项」编译为可直接使用的 CSS 文本，
 * 供 EPUB（style.css）与 PDF（打印稿内联 <style>）共用：
 * - :root 输出 --bt-* 变量（令牌的 CSS Variables 层）；
 * - 根容器规则（默认 body，可经 containerSelector 替换）通过 var() 引用变量，
 *   书写方向 / 直排策略 / 分栏由布局选项决定；
 * - .bt-* 节点类与 html-serializer 的 class 输出配套，开箱即有基础排版；
 *   节点 / 角色选择器同样限定在根容器内，避免样式泄漏到容器之外
 *   （如同一页面中使用同名 bt-* 类的编辑画布）。
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
  /** 根容器选择器（默认 'body'；阅读器视图可传自身容器，如 '.bt-reader-page'） */
  containerSelector?: string;
}

/** 生成书册基础样式表（变量层 + 根容器规则 + 节点类样式） */
export function buildBookCss(input: BuildBookCssOptions): string {
  const { tokens, options } = input;
  const fontToken = input.fontToken ?? FONT_TOKENS.BODY;
  const containerSelector = input.containerSelector ?? 'body';
  const vertical = isVerticalMode(options.writingMode);

  const rules: string[] = [];

  /* ---------- 1. 变量层：--bt-* ---------- */
  const variables = buildCssVariables(tokens);
  const variableLines = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  rules.push(`:root {\n${variableLines}\n}`);

  /* ---------- 2. 根容器基础规则 ---------- */
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
  rules.push(`${containerSelector} {\n${declarationToCss(body)}\n}`);

  /*
   * ---------- 3. 节点类样式（与 bt-* class 配套；经 scoped() 限定容器） ----------
   *
   * 另含「版式角色」选择器（data-role）约定，供书籍结构页与卷端题署标注：
   * - 结构页：cover-title / cover-subtitle / cover-creator / cover-publisher、
   *   title-page-title / title-page-creator / title-page-publisher、
   *   copyright-title / copyright-line、back-cover-line；
   * - 目录页：toc-title / toc-entry / toc-subentry；
   * - 卷端题署：volume-title / volume-creator。
   *
   * 全部节点 / 角色规则经 scoped() 前缀根容器选择器：样式只作用于容器内，
   * 避免泄漏到容器之外（如同一页面中同名 bt-* 类的编辑画布）。
   */
  const scoped = (selector: string): string => `${containerSelector} ${selector}`;

  rules.push(`${scoped('.bt-paragraph')} {
  margin: 0;
  text-indent: var(--bt-${LAYOUT_TOKENS.TEXT_INDENT});
}
${scoped('.bt-heading')} {
  font-family: var(--bt-${FONT_TOKENS.HEADING});
  font-size: var(--bt-${FONT_SIZE_TOKENS.HEADING});
  line-height: 1.4;
}
${scoped('.bt-quote')} {
  margin: 1em 2em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-list')} {
  margin: 0.5em 0;
  padding-inline-start: 1.6em;
}
${scoped('.bt-code-block')} {
  font-family: var(--bt-${FONT_TOKENS.MONO});
  font-size: 0.85em;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
${scoped('.bt-caption')},
${scoped('.bt-footnote')},
${scoped('.bt-endnote')},
${scoped('.bt-margin-note')} {
  font-size: var(--bt-${FONT_SIZE_TOKENS.NOTE});
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-footnote')},
${scoped('.bt-endnote')},
${scoped('.bt-margin-note')} {
  display: block;
  margin: 0.5em 0;
}
${scoped('.bt-table')} {
  border-collapse: collapse;
  margin: 1em 0;
}
${scoped('.bt-table-cell')} {
  border: 1px solid var(--bt-${COLOR_TOKENS.TEXT});
  padding: 0.25em 0.6em;
}
${scoped('.bt-image')} {
  max-width: 100%;
}
${scoped('.bt-break')} {
  border: 0;
  border-block-start: 1px solid var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  margin: 1em 0;
}
${scoped('.bt-mark-underline')} {
  text-decoration: underline;
}
${scoped('.bt-mark-strikethrough')} {
  text-decoration: line-through;
}
${scoped('.bt-mark-highlight')} {
  background-color: rgba(255, 235, 130, 0.45);
}
${scoped('.bt-mark-link')} {
  color: var(--bt-${COLOR_TOKENS.ACCENT});
}
${scoped('.bt-math-block')} {
  margin: 1em 0;
  text-align: center;
}
${scoped('ruby > rt')} {
  font-size: 0.5em;
}

/* ---------- 4. 书籍结构页（封面/书名页/版权页/目录/卷端/封底） ---------- */
${scoped("[data-role='cover-title']")} {
  margin: 2.6em 0 0;
  text-align: center;
  font-size: 2.8em;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
}
${scoped("[data-role='cover-subtitle']")},
${scoped("[data-role='title-page-subtitle']")} {
  margin: 1.4em 0 0;
  text-align: center;
  font-size: 1.1em;
  letter-spacing: 0.25em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='cover-creator']")} {
  margin: 3.5em 0 0;
  text-align: center;
  font-size: 0.95em;
  letter-spacing: 0.15em;
}
${scoped("[data-role='cover-publisher']")} {
  margin: 4em 0 0;
  text-align: center;
  font-size: 0.85em;
  letter-spacing: 0.2em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='title-page-title']")} {
  margin: 4em 0 0;
  text-align: center;
  font-size: 1.9em;
  letter-spacing: 0.3em;
}
${scoped("[data-role='title-page-creator']")} {
  margin: 1.8em 0 0;
  text-align: center;
  font-size: 0.95em;
  letter-spacing: 0.1em;
}
${scoped("[data-role='title-page-publisher']")} {
  margin: 6em 0 0;
  text-align: center;
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='copyright-title']")} {
  margin: 2em 0 1.4em;
  text-align: center;
  font-size: 1em;
  letter-spacing: 0.25em;
}
${scoped("[data-role='copyright-line']")} {
  margin: 0.35em 0;
  font-size: 0.78em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='toc-title']")} {
  margin: 1.2em 0 1em;
  text-align: center;
  font-size: 1.2em;
  letter-spacing: 0.4em;
  text-indent: 0.4em;
}
${scoped("[data-role='toc-entry']")} {
  margin: 0.55em 0;
  text-align: center;
  letter-spacing: 0.12em;
}
${scoped("[data-role='toc-subentry']")} {
  margin: 0.3em 0;
  text-align: center;
  font-size: 0.85em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='volume-title']")} {
  margin: 0.4em 0 0.2em;
  text-align: center;
  font-size: 1.3em;
  letter-spacing: 0.25em;
}
${scoped("[data-role='volume-creator']")} {
  margin: 0 0 1.2em;
  text-align: center;
  font-size: 0.82em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped("[data-role='back-cover-line']")} {
  margin: 0.5em 0;
  text-align: center;
  font-size: 0.8em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}

/* ---------- 5. 古籍注文与标注 ---------- */
/*
 * 序列化器对无元素子节点的古典型容器（double-note / head-note /
 * collation-note / imprint / colophon）以 span 兜底，块级语义在此
 * 经 display: block 修正；行内载体（collation-mark / variant-char）保持行内。
 * 编辑保存后容器内直挂文本会规范化为「容器 + 段落」，故另以规则让
 * 容器内段落显式继承（text-indent 为继承属性）：直挂文本形态直接继承
 * 根容器的计算值（如 2em@16px＝32px），而段落形态若走基础 .bt-paragraph
 * 规则会按注文自身较小字号重算 em（2em@11.5px≈23px），故用 inherit
 * 锁定容器继承链上的同一计算值，保证两种形态首行缩进与换行一致
 * （reader 分块规则同步：见 @bibliotype/reader 的 TEXT_CONTAINER_TYPES）。
 */
${scoped('.bt-double-note')} {
  display: block;
  margin: 0.35em 0 0.45em 1.2em;
  font-size: 0.72em;
  line-height: 1.65;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  column-count: 2;
  column-gap: 1.6em;
}
${scoped('.bt-head-note')} {
  display: block;
  margin: 0.45em 1.6em;
  padding: 0.25em 0.7em;
  font-size: 0.72em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  border: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 40%, transparent);
  border-radius: 2px;
}
${scoped('.bt-collation-note')} {
  display: block;
  margin: 0.5em 0;
  padding-inline-start: 0.75em;
  font-size: 0.7em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
  border-inline-start: 2px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 55%, transparent);
}
${scoped('.bt-imprint')} {
  display: block;
  width: fit-content;
  margin: 1.2em auto;
  padding: 0.5em 1em;
  border: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 45%, transparent);
  font-size: 0.78em;
  text-align: center;
  letter-spacing: 0.1em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-colophon')} {
  display: block;
  margin: 1.4em 0 0.6em;
  padding-block-start: 0.6em;
  border-block-start: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 35%, transparent);
  font-size: 0.78em;
  text-align: center;
  letter-spacing: 0.05em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}
${scoped('.bt-double-note .bt-paragraph')},
${scoped('.bt-head-note .bt-paragraph')},
${scoped('.bt-tail-note .bt-paragraph')},
${scoped('.bt-collation-note .bt-paragraph')},
${scoped('.bt-imprint .bt-paragraph')},
${scoped('.bt-colophon .bt-paragraph')},
${scoped('.bt-footnote .bt-paragraph')},
${scoped('.bt-endnote .bt-paragraph')},
${scoped('.bt-margin-note .bt-paragraph')} {
  text-indent: inherit;
}
${scoped('.bt-collation-mark')} {
  margin-inline: 0.15em;
}
${scoped('.bt-collation-mark::after')} {
  content: attr(data-symbol);
}
${scoped('.bt-taboo-char')},
${scoped('.bt-mark-taboo')} {
  text-decoration: underline dashed;
  text-underline-offset: 3px;
}
${scoped('.bt-mark-variant')} {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
${scoped('.bt-mark-book-title')} {
  text-decoration: underline wavy;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}
${scoped('.bt-mark-circle-emphasis')} {
  text-emphasis: filled circle;
  text-emphasis-position: under right;
}
${scoped('.bt-mark-note-ref')} {
  font-size: 0.72em;
  vertical-align: super;
}

/* ---------- 6. 脚注（注线：与相邻注文相连时仅首条保留） ---------- */
${scoped('.bt-footnote')} {
  margin: 0.55em 0;
  padding-block-start: 0.4em;
  border-block-start: 1px solid color-mix(in srgb, var(--bt-${COLOR_TOKENS.NOTE_TEXT}) 45%, transparent);
}
${scoped('.bt-footnote + .bt-footnote')} {
  border-block-start: 0;
  padding-block-start: 0;
}

/* ---------- 7. 页脚页码（固定横排显示，居中于页面物理底部） ---------- */
${scoped('.bt-page-number')} {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  writing-mode: horizontal-tb;
  text-align: center;
  font-size: 0.75em;
  letter-spacing: 0.15em;
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}`);

  /* ---------- 8. 专名号：横排标于字下 / 直排标于字左（GB 古籍整理规范） ---------- */
  rules.push(
    vertical
      ? `${scoped('.bt-mark-proper-name')} {\n  border-left: 1px solid currentColor;\n  padding-left: 1px;\n}`
      : `${scoped('.bt-mark-proper-name')} {\n  border-bottom: 1px solid currentColor;\n}`,
  );

  return `${rules.join('\n\n')}\n`;
}
