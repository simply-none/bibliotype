/**
 * 行款网格对齐层测试（facsimile-grid-css）
 *
 * 覆盖：显式行高归格（标题 / 代码块 / 注区）、双行小注「一格双行」的
 * 恰好占满、大字号按 k 格倍数行高（宋刻浙本封面题名 2 格 / 汲古阁本标题
 * 2 格）、块轴装饰归零清单；以及 book-css 三重闸门与 buildRootStyle 根
 * 行高绝对化的端到端口径。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import { DEFAULT_LAYOUT_OPTIONS } from '../layout-options.js';
import { FACSIMILE_PRESETS } from '../facsimile-presets.js';
import { buildRootStyle } from '../style-builder.js';
import { buildBookCss } from '../html/book-css.js';
import { buildFacsimileGridCss } from '../html/facsimile-grid-css.js';

/** 宋刻浙本（pitch = 22 × 1.95 = 42.9px）与汲古阁本（pitch = 20 × 1.7 = 34px） */
const SONG = FACSIMILE_PRESETS[0] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;
const JIGE = FACSIMILE_PRESETS[3] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;

function tokensOf(preset: NonNullable<(typeof FACSIMILE_PRESETS)[0]>, extra: Record<string, string> = {}) {
  return { ...DEFAULT_THEME, ...preset.tokens, ...extra };
}

describe('buildFacsimileGridCss（网格对齐层）', () => {
  it('宋刻浙本：显式行高归格 + 双行小注一格双行', () => {
    const css = buildFacsimileGridCss({
      options: SONG.layout,
      tokens: tokensOf(SONG),
      containerSelector: '.bt-reader-page',
    });
    /* 标题 1.75em × 22 = 38.5 < 42.9 → 一格；块轴外距归零（UA 0.83em 漂移源） */
    expect(css).toContain('.bt-reader-page .bt-heading {\n  line-height: 42.9px;\n  margin-block: 0;\n}');
    /* 各级标题字号均未超格 → 不额外输出分级规则 */
    expect(css).not.toContain('h1.bt-heading');
    expect(css).toContain('.bt-reader-page .bt-code-block {\n  line-height: 42.9px;\n}');
    /* 双行小注「一格双行」：不用 CSS 多栏（Chromium 直排 balancing 拦腰
       分段、fill: auto 被忽略致列高塌缩，均实测不可依赖），改为子列行高 =
       列距 / 2 = 21.45 的自然换列——读序（右列读到底再续左列）与子列满高
       由换行引擎保证；显式重置基础样式的 column-count / gap；min-width
       兜底短注占满一格；左边距（块轴）去掉 */
    expect(css).toContain(
      '.bt-reader-page .bt-double-note {\n  line-height: 21.45px;\n  column-count: initial;\n  column-gap: initial;\n  min-width: 42.9px;\n  margin: 0.35em 0 0.45em;\n}',
    );
  });

  it('宋刻浙本：结构页大字按 k 格行高（封面题名 2.8em = 61.6px → 2 格 85.8px）', () => {
    const css = buildFacsimileGridCss({
      options: SONG.layout,
      tokens: tokensOf(SONG),
      containerSelector: 'body',
    });
    expect(css).toContain("body [data-role='cover-title'] {\n  line-height: 85.8px;\n}");
    /* 书名页题名 1.9em × 22 = 41.8 < 42.9 → 一格，不额外输出 */
    expect(css).not.toContain("data-role='title-page-title'");
  });

  it('汲古阁本：标题字号超过列距（35 > 34）自动落 2 格', () => {
    const css = buildFacsimileGridCss({
      options: JIGE.layout,
      tokens: tokensOf(JIGE),
      containerSelector: 'body',
    });
    expect(css).toContain('.bt-heading {\n  line-height: 68px;\n}');
    /* h1 = 标题基准字号（35px）也超格 → 分级规则补 2 格；h2 起（0.82×35）不超 */
    expect(css).toContain('h1.bt-heading {\n  line-height: 68px;\n}');
    expect(css).not.toContain('h2.bt-heading');
    /* 书名页题名 1.9em × 20 = 38 > 34 → 2 格 */
    expect(css).toContain("data-role='title-page-title'] {\n  line-height: 68px;\n}");
  });

  it('块轴装饰归零清单（引文 / 眉批 / 牌记 / 题跋 / 版框节 / 注区 / 分隔线）', () => {
    const css = buildFacsimileGridCss({
      options: SONG.layout,
      tokens: tokensOf(SONG),
      containerSelector: '.bt-reader-page',
    });
    expect(css).toContain('.bt-quote {\n  margin: 1em 0;\n}');
    expect(css).toContain('border: 0;');
    expect(css).toContain('.bt-page-notes {\n  margin-block-start: 0;\n  padding-block-start: 0;\n  border-block-start: 0;\n  line-height: 42.9px;\n}');
    /* 分隔线各变体的右缘线宽一并归零（变体选择器特异性更高） */
    expect(css).toContain("data-variant='dashed']");
    expect(css).toContain('border-block-start: 0;');
    /* 注音注记行高收进字距空隙 */
    expect(css).toContain('ruby > rt {\n  line-height: 1;\n}');
  });
});

describe('book-css / buildRootStyle 的网格口径（三重闸门）', () => {
  it('buildBookCss：仿真直排根行高绝对化并输出网格对齐层', () => {
    const css = buildBookCss({
      tokens: tokensOf(SONG),
      options: SONG.layout,
      pageDecoration: true,
    });
    /* body 根规则：line-height 从 var 倍数变为列距 px */
    expect(css).toMatch(/body \{[^}]*line-height: 42\.9px;/s);
    expect(css).toContain('行款网格对齐');
    expect(css).toContain('.bt-double-note {\n  line-height: 21.45px;');
  });

  it('buildBookCss：未开 pageDecoration（EPUB / auto）不输出网格层，根行高保持倍数', () => {
    const css = buildBookCss({ tokens: tokensOf(SONG), options: SONG.layout });
    expect(css).not.toContain('行款网格对齐');
    expect(css).not.toMatch(/body \{[^}]*line-height: 42\.9px;/s);
  });

  it('buildBookCss：古籍直排（非仿真）与横排产物不含网格层', () => {
    const verticalPlain = buildBookCss({
      tokens: { ...DEFAULT_THEME, 'writing-mode': 'vertical-rl' },
      options: { ...DEFAULT_LAYOUT_OPTIONS, writingMode: 'vertical-rl' },
      pageDecoration: true,
    });
    expect(verticalPlain).not.toContain('行款网格对齐');
  });

  it('buildRootStyle：仿真直排行高绝对化；古籍直排（非仿真）保持令牌倍数', () => {
    const facsimile = buildRootStyle({ tokens: tokensOf(SONG), options: SONG.layout });
    expect(facsimile['line-height']).toBe('42.9px');

    const classical = buildRootStyle({
      tokens: { ...DEFAULT_THEME, 'line-height-body': '1.9' },
      options: { ...DEFAULT_LAYOUT_OPTIONS, writingMode: 'vertical-rl' },
    });
    expect(classical['line-height']).toBe('1.9');
  });
});
