/**
 * 书册样式表生成测试
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, FONT_TOKENS } from '@bibliotype/core';
import { buildBookCss, declarationToCss } from '../html/book-css.js';
import { CLASSICAL_LAYOUT_OPTIONS, DEFAULT_LAYOUT_OPTIONS } from '../layout-options.js';

describe('buildBookCss', () => {
  it('输出 --bt-* 变量层（含扩展令牌）', () => {
    const css = buildBookCss({
      tokens: { ...DEFAULT_THEME, 'custom-token': 'x' },
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(css).toContain(':root {');
    expect(css).toContain('--bt-font-family-body:');
    expect(css).toContain('--bt-custom-token: x;');
  });

  it('body 以 var() 引用变量，书写方向取 options', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(css).toContain('writing-mode: horizontal-tb;');
    expect(css).toContain('font-family: var(--bt-font-family-body);');
    expect(css).toContain('line-height: var(--bt-line-height-body);');
    expect(css).not.toContain('text-combine-upright');
  });

  it('containerSelector 替换根容器（默认 body）', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
      containerSelector: '.bt-reader-page',
    });
    expect(css).toContain('.bt-reader-page {\n');
    expect(css).not.toContain('body {\n');
  });

  it('containerSelector 同时限定节点 / 角色规则（防泄漏到容器外，如编辑画布）', () => {
    const readerCss = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
      containerSelector: '.bt-reader-page',
    });
    expect(readerCss).toContain('.bt-reader-page .bt-double-note {');
    expect(readerCss).toContain(".bt-reader-page [data-role='cover-title'] {");
    expect(readerCss).toContain('.bt-reader-page .bt-mark-proper-name {');
    expect(readerCss).not.toContain('\n.bt-double-note {');

    const bodyCss = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(bodyCss).toContain('body .bt-double-note {');
  });

  it('直排：text-orientation 与 text-combine-upright 生效（D3）', () => {
    const css = buildBookCss({
      tokens: { ...DEFAULT_THEME, 'text-orientation': 'upright' },
      options: CLASSICAL_LAYOUT_OPTIONS,
    });
    expect(css).toContain('writing-mode: vertical-rl;');
    expect(css).toContain('text-orientation: upright;');
    expect(css).toContain('text-combine-upright: digits 4;');
  });

  it('分栏：columns > 1 输出 column-count 与 column-gap', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: { ...DEFAULT_LAYOUT_OPTIONS, columns: 2 },
    });
    expect(css).toContain('column-count: 2;');
    expect(css).toContain('column-gap: var(--bt-column-gap);');
  });

  it('fontToken 可切换古籍字体令牌', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
      fontToken: FONT_TOKENS.CLASSICAL_BODY,
    });
    expect(css).toContain('font-family: var(--bt-font-family-classical-body);');
  });

  it('节点类样式与序列化器 class 配套', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(css).toContain('.bt-paragraph');
    expect(css).toContain('.bt-heading');
    expect(css).toContain('.bt-math-block');
    expect(css).toContain('ruby > rt');
  });

  it('古籍装饰 / 载体节点基样式（R4 修复：此前缺规则导致插入不可见 / 无区别）', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    // 行内载体 / 装饰
    expect(css).toContain('.bt-inline-note');
    expect(css).toContain('.bt-variant-char');
    expect(css).toContain('.bt-seal');
    expect(css).toContain('.bt-seal::after');
    expect(css).toContain('content: attr(data-text);');
    expect(css).toContain('.bt-fish-tail');
    expect(css).toContain('.bt-fish-tail::after');
    // 块级容器
    expect(css).toContain('.bt-border-frame');
    expect(css).toContain('.bt-tail-note');
  });

  it('书籍要素类样式：结构页角色/双行小注/眉批/脚注/校勘/页码', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(css).toContain("[data-role='cover-title']");
    expect(css).toContain("[data-role='copyright-line']");
    expect(css).toContain("[data-role='volume-title']");
    expect(css).toContain('.bt-double-note');
    expect(css).toContain('column-count: 2;');
    expect(css).toContain('.bt-head-note');
    expect(css).toContain('.bt-collation-note');
    expect(css).toContain('.bt-collation-mark::after');
    expect(css).toContain('content: attr(data-symbol);');
    expect(css).toContain('.bt-footnote + .bt-footnote');
    expect(css).toContain('.bt-page-number');
    expect(css).toContain('.bt-imprint {');
    expect(css).toContain('.bt-colophon {');
    expect(css).toMatch(/\.bt-double-note \{[^}]*display: block;/);
  });

  it('版式文本容器内的段落（编辑保存规范形态）继承容器缩进，与直挂文本形态一致', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
      containerSelector: '.bt-reader-page',
    });
    expect(css).toContain('.bt-reader-page .bt-double-note .bt-paragraph,');
    expect(css).toContain('.bt-reader-page .bt-footnote .bt-paragraph,');
    expect(css).toMatch(/\n\.bt-reader-page \.bt-margin-note \.bt-paragraph \{\n  text-indent: inherit;\n\}/);
  });

  it('专名号：横排标于字下、直排标于字左', () => {
    const horizontal = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(horizontal).toContain('.bt-mark-proper-name {\n  border-bottom: 1px solid currentColor;');

    const vertical = buildBookCss({
      tokens: DEFAULT_THEME,
      options: CLASSICAL_LAYOUT_OPTIONS,
    });
    expect(vertical).toContain('.bt-mark-proper-name {\n  border-left: 1px solid currentColor;');
  });

  it('缺省令牌（undefined）不输出对应变量定义（类样式引用保留）', () => {
    const css = buildBookCss({
      tokens: { ...DEFAULT_THEME, 'color-accent': undefined },
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(css).not.toContain('--bt-color-accent: ');
    expect(css).toContain('var(--bt-color-accent)');
  });
});

describe('declarationToCss', () => {
  it('序列化声明对象为 CSS 文本（每条一行、缩进两格）', () => {
    expect(declarationToCss({ width: '559px', color: 'red' })).toBe(
      '  width: 559px;\n  color: red;',
    );
  });
});
