// @vitest-environment happy-dom
/**
 * 光栅 SVG 容器测试
 *
 * `buildSvgXml` 的 foreignObject 包装必须是 XHTML `<body>`：打印 CSS 的书册
 * 根规则与全部节点规则挂在 `body` 选择器（`buildBookCss` 缺省
 * containerSelector），包成普通 div 会使 `body {…}` 与 `body .bt-*` 选择器
 * 全部失配——字体 / 颜色 / writing-mode（直排变横排）/ 节点样式全丢。
 */
import { describe, expect, it } from 'vitest';
import { buildSvgXml } from '../raster-pdf.js';

describe('buildSvgXml（光栅容器）', () => {
  it('包装元素为 XHTML body：打印 CSS 的 body 选择器可命中', () => {
    const xml = buildSvgXml(
      '<section class="bt-page" data-page="1"><p class="bt-paragraph">子曰</p></section>',
      'body { margin: 0; writing-mode: vertical-rl; }',
      559,
      794,
    );
    expect(xml).toContain('<svg');
    expect(xml).toContain('<foreignObject');
    /* 包装元素是 body（XHTML 命名空间），不再是 div——body 根规则与
       body .bt-* 作用域规则才能命中（body 的 UA 外边距由 margin: 0 覆盖） */
    expect(xml).toContain('<body');
    expect(xml).not.toMatch(/<div xmlns=/);
    /* 样式与页片段都在 body 内（顺序：style 在前，页片段在后） */
    const bodyStart = xml.indexOf('<body');
    expect(xml.indexOf('<style')).toBeGreaterThan(bodyStart);
    expect(xml.indexOf('class="bt-page"')).toBeGreaterThan(bodyStart);
  });
});
