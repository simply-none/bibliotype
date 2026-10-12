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
