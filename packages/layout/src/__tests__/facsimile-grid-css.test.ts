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

/** 宋刻浙本（pitch = 29 × 1.55 = 44.95px）与汲古阁本（pitch = 25 × 1.66 = 41.5px） */
const SONG = FACSIMILE_PRESETS[0] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;
const JIGE = FACSIMILE_PRESETS.find((p) => p.id === 'jiguge') as NonNullable<
  (typeof FACSIMILE_PRESETS)[0]
>;

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
    /* 标题 1.75em × 29 = 50.75 > 44.95 → 落 2 格（89.9px）；块轴外距归零
       （UA 0.83em 漂移源） */
    expect(css).toContain('.bt-reader-page .bt-heading {\n  line-height: 89.9px;\n  margin-block: 0;\n}');
    /* h1 与基准同字号（2 格）；h2 起（0.82 × 50.75）不超格 → 不额外输出 */
    expect(css).toContain('h1.bt-heading {\n  line-height: 89.9px;\n}');
    expect(css).not.toContain('h2.bt-heading');
    expect(css).toContain('.bt-reader-page .bt-code-block {\n  line-height: 44.95px;\n}');
    /* 双行夹注已行内化（v2 批 1）：网格层不再输出块级夹注规则（列内双行
       属批 2 列盒渲染器）；行内夹注继承根行高（44.95px 列距）天然落格 */
    expect(css).not.toContain('.bt-double-note');
  });

  it('宋刻浙本：结构页大字按 k 格行高（封面题名 2.8em = 81.2px → 2 格 89.9px）', () => {
    const css = buildFacsimileGridCss({
      options: SONG.layout,
      tokens: tokensOf(SONG),
      containerSelector: 'body',
    });
    expect(css).toContain("body [data-role='cover-title'] {\n  line-height: 89.9px;\n}");
    /* 书名页题名 1.9em × 29 = 55.1 > 44.95 → 也落 2 格 */
    expect(css).toContain("data-role='title-page-title'] {\n  line-height: 89.9px;\n}");
  });

  it('汲古阁本：标题字号超过列距（43.75 > 41.5）自动落 2 格', () => {
    const css = buildFacsimileGridCss({
      options: JIGE.layout,
      tokens: tokensOf(JIGE),
      containerSelector: 'body',
    });
    expect(css).toContain('.bt-heading {\n  line-height: 83px;\n}');
    /* h1 = 标题基准字号（43.75px）也超格 → 分级规则补 2 格；h2 起（0.82×43.75）不超 */
    expect(css).toContain('h1.bt-heading {\n  line-height: 83px;\n}');
    expect(css).not.toContain('h2.bt-heading');
    /* 书名页题名 1.9em × 25 = 47.5 > 41.5 → 2 格 */
    expect(css).toContain("data-role='title-page-title'] {\n  line-height: 83px;\n}");
  });

  it('块轴装饰归零清单（引文 / 眉批 / 牌记 / 题跋 / 版框节 / 注区 / 分隔线）', () => {
    const css = buildFacsimileGridCss({
      options: SONG.layout,
      tokens: tokensOf(SONG),
      containerSelector: '.bt-reader-page',
    });
    expect(css).toContain('.bt-quote {\n  margin: 1em 0;\n}');
    expect(css).toContain('border: 0;');
    expect(css).toContain('.bt-page-notes {\n  margin-block-start: 0;\n  padding-block-start: 0;\n  border-block-start: 0;\n  line-height: 44.95px;\n}');
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
    expect(css).toMatch(/body \{[^}]*line-height: 44\.95px;/s);
    expect(css).toContain('行款网格对齐');
    /* 夹注行内化：网格层无块级夹注规则（行内夹注继承根行高落格） */
    expect(css).not.toContain('column-count: initial');
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
    expect(facsimile['line-height']).toBe('44.95px');

    const classical = buildRootStyle({
      tokens: { ...DEFAULT_THEME, 'line-height-body': '1.9' },
      options: { ...DEFAULT_LAYOUT_OPTIONS, writingMode: 'vertical-rl' },
    });
    expect(classical['line-height']).toBe('1.9');
  });
});
