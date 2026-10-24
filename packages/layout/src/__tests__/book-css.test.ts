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

  it('字图恒不旋转：直排与横排产物均无 rotate 规则（直排汉字直立，字图同理）', () => {
    const vertical = buildBookCss({ tokens: DEFAULT_THEME, options: CLASSICAL_LAYOUT_OPTIONS });
    expect(vertical).toContain('writing-mode: vertical-rl;');
    expect(vertical).toContain('.bt-glyph-image {');
    expect(vertical).not.toContain('rotate(90deg)');
    const horizontal = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(horizontal).not.toContain('rotate(90deg)');
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

  it('表格样式：书写方向继承 + 空单元格最小尺寸（直排不塌陷）', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: CLASSICAL_LAYOUT_OPTIONS });
    expect(css).toContain('.bt-table {');
    expect(css).toContain('writing-mode: inherit;');
    expect(css).toContain('.bt-table-cell {');
    expect(css).toContain('padding-block: 0.25em;');
    expect(css).toContain('min-inline-size: 2em;');
    expect(css).toContain('min-block-size: 1.6em;');
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
    expect(css).toContain('.bt-seal:empty::after');
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

  it('flatten：变量层删除、var() 替换为字面值（导出 EPUB 老引擎兼容）', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
      flatten: true,
    });
    expect(css).not.toContain(':root {');
    expect(css).not.toContain('var(--bt-');
    /* 字面值直写：body 规则含 font-size / color 声明 */
    expect(css).toMatch(/body \{\n  margin: 0;\n  font-family: [^v]/);
    expect(css).toContain('font-size: ');
    expect(css).toContain('color: ');
  });

  it('flatten：直排 + 分栏的老引擎前缀输出', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: { ...CLASSICAL_LAYOUT_OPTIONS, columns: 2 },
      flatten: true,
    });
    expect(css).toContain('-webkit-writing-mode: vertical-rl;');
    expect(css).toContain('-webkit-column-count: 2;');
    expect(css).not.toContain('var(--bt-');
  });

  it('直排默认输出 -webkit-writing-mode 前缀（P1-7 老 WebKit 兼容）', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: CLASSICAL_LAYOUT_OPTIONS,
    });
    expect(css).toContain('-webkit-writing-mode: vertical-rl;');
  });

  it('标题分级：h1~h6 各自一条规则（只用 .bt-heading 无法分级）', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(css).toContain(`h${level}.bt-heading {`);
    }
    // H1 以令牌值为兜底、calc 倍率为 1；H6 最小（0.54 倍）
    expect(css).toContain(
      'h1.bt-heading {\n  font-size: 1.75em;\n  font-size: calc(var(--bt-font-size-heading) * 1);',
    );
    expect(css).toContain('calc(var(--bt-font-size-heading) * 0.54)');
  });

  it('圈点样式变体：data-style 属性驱动 text-emphasis（此前写死 filled circle）', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(css).toContain(".bt-mark-circle-emphasis[data-style='open-circle'] {");
    expect(css).toContain('text-emphasis: open circle;');
    expect(css).toContain(".bt-mark-circle-emphasis[data-style='double-circle'] {");
    expect(css).toContain(".bt-mark-circle-emphasis[data-style='sesame'] {");
  });

  it('分隔变体：data-variant 输出虚线 / 点线 / 双线 / 分页', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(css).toContain(".bt-break[data-variant='dashed'] {");
    expect(css).toContain(".bt-break[data-variant='page'] {");
  });

  it('页眉 / 页脚规则存在，且占位高度取 CSS 变量（与分页扣减同源）', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    expect(css).toContain('.bt-page-header {');
    expect(css).toContain('.bt-page-footer {');
    expect(css).toContain('height: var(--bt-page-header-size, 24px);');
    expect(css).toContain('height: var(--bt-page-footer-size, 24px);');
  });

  it('功能样式与命名样式追加在末尾（同优先级靠层叠顺序覆盖）', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
      features: { 'block.paragraph': { color: '#123456' } },
      namedStyles: {
        version: 1,
        styles: [
          {
            id: 'bt-style-1',
            name: '题解',
            featureId: 'block.paragraph',
            declarations: { 'font-weight': '600' },
          },
        ],
      },
    });
    expect(css).toContain('body .bt-paragraph {\n  color: #123456;\n}');
    expect(css).toContain('body [data-style-id="bt-style-1"]');
    // 尾部覆盖段在专名号规则之后
    expect(css.indexOf('用户样式覆盖')).toBeGreaterThan(css.indexOf('.bt-mark-proper-name {'));
  });

  it('color-mix 声明带物理色兜底（老引擎整条丢弃的规避）', () => {
    const css = buildBookCss({ tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS });
    const block = /\.bt-footnote \{[\s\S]*?\}/.exec(css)?.[0] ?? '';
    expect(block).toMatch(/border-block-start: 1px solid #\w{3,8};\n\s*border-block-start: 1px solid color-mix/);
  });
});

describe('declarationToCss', () => {
  it('序列化声明对象为 CSS 文本（每条一行、缩进两格）', () => {
    expect(declarationToCss({ width: '559px', color: 'red' })).toBe(
      '  width: 559px;\n  color: red;',
    );
  });
});
