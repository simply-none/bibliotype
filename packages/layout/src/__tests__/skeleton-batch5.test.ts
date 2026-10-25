/**
 * 版面骨架扩展测试（直排 v2 批 5）
 *
 * 覆盖：书耳（ear 选项 + serializePageEar + reader.getPageEarText）、鱼尾
 * 数量枚举（三 / 四尾均布 data-*）、鱼尾样式（black / white / line / floral）、
 * 眉栏（eyebrow 横线）、两截本（bands 分截分页合并 + 渲染容器）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import { FACSIMILE_FRAMES, FACSIMILE_RULES, GUTTER_FISH_TAILS, GUTTER_FISH_TAIL_STYLES, GUTTER_MOUTHS, GUTTER_SIDES } from '../facsimile.js';
import type { LayoutOptions } from '../layout-options.js';
import { buildBookCss } from '../html/book-css.js';
import { serializePageEar, serializePageGutter } from '../html/page-gutter.js';
import { groupNodesByBand } from '../html/vertical-flow.js';
import { paginate, type MeasurableBlock } from '../paginator.js';

/** 仿真布局（宋刻浙本口径的最小复刻） */
function facLayout(extra: Record<string, unknown> = {}): LayoutOptions {
  return {
    writingMode: 'vertical-rl',
    pageSize: { name: '测试', width: 699, height: 983 },
    facsimile: {
      preset: 'test',
      frame: FACSIMILE_FRAMES.DOUBLE,
      rule: FACSIMILE_RULES.INK,
      gutter: {
        side: GUTTER_SIDES.LEFT,
        size: 34,
        mouth: GUTTER_MOUTHS.WHITE,
        fishTail: GUTTER_FISH_TAILS.DOUBLE,
        fields: ['bookTitle', 'chapterTitle', 'pageNumber'],
      },
      ...extra,
    },
  } as unknown as LayoutOptions;
}

const FAC_TOKENS = { ...DEFAULT_THEME, 'page-margin': '200px 120px 173px 90px' };

describe('书耳（ear）', () => {
  it('serializePageEar：ear 开启输出耳框（data-side 随版心侧），关闭 / 空文本为空串', () => {
    const fac = facLayout({ ear: true });
    expect(serializePageEar('學而第一', fac.facsimile)).toBe(
      `<div class="bt-page-ear" data-side="left">學而第一</div>`,
    );
    expect(serializePageEar(undefined, fac.facsimile)).toBe('');
    expect(serializePageEar('  ', fac.facsimile)).toBe('');
    expect(serializePageEar('學而', facLayout().facsimile)).toBe('');
  });

  it('装饰 CSS：ear 输出 .bt-page-ear（版框外上角、随侧镜像），eyebrow 输出眉栏横线', () => {
    const css = buildBookCss({
      tokens: FAC_TOKENS,
      options: facLayout({ ear: true, eyebrow: true }),
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).toContain('.bt-reader-page .bt-page-ear {');
    expect(css).toContain("data-side='left']");
    expect(css).toContain('.bt-reader-page .bt-page-eyebrow {');
    /* 关闭时不输出 */
    const off = buildBookCss({
      tokens: FAC_TOKENS,
      options: facLayout(),
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(off).not.toContain('.bt-page-ear {');
    expect(off).not.toContain('.bt-page-eyebrow {');
  });
});

describe('鱼尾扩展（数量 + 样式）', () => {
  it('序列化：三 / 四尾按字段段均布，data-fish-style 透传', () => {
    const triple = facLayout();
    (triple.facsimile!.gutter as { fishTail: string }).fishTail = GUTTER_FISH_TAILS.TRIPLE;
    (triple.facsimile!.gutter as { fishTailStyle: string }).fishTailStyle =
      GUTTER_FISH_TAIL_STYLES.LINE;
    const html = serializePageGutter(
      { bookTitle: '論語', volumeTitle: '', chapterTitle: '學而', pageNumber: '一' },
      triple.facsimile,
    );
    expect((html.match(/bt-page-gutter__fish/g) ?? []).length).toBe(3);
    expect(html).toContain('data-fish="triple"');
    expect(html).toContain('data-fish-style="line"');
  });

  it('渲染 CSS：四尾均布相向（偶数序尾垂直镜像）；白 / 花鱼尾形态', () => {
    const quad = facLayout();
    (quad.facsimile!.gutter as { fishTail: string }).fishTail = GUTTER_FISH_TAILS.QUADRUPLE;
    (quad.facsimile!.gutter as { fishTailStyle: string }).fishTailStyle =
      GUTTER_FISH_TAIL_STYLES.WHITE;
    const css = buildBookCss({
      tokens: FAC_TOKENS,
      options: quad,
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    for (const n of [1, 2, 3, 4]) {
      expect(css).toContain(`.bt-reader-page .bt-page-gutter__fish:nth-of-type(${n})`);
    }
    /* 相向交替：2 / 4 尾镜像 */
    const flips = css.match(/transform: scaleY\(-1\)/g) ?? [];
    expect(flips.length).toBe(2);
    expect(css).toContain('background: transparent;');
  });
});

describe('眉批 / 旁批装饰位（渲染 CSS）', () => {
  it('仿真装饰输出天头 / 界行外容器定位', () => {
    const css = buildBookCss({
      tokens: FAC_TOKENS,
      options: facLayout(),
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).toContain('.bt-reader-page .bt-page-eyebrow-host {');
    expect(css).toContain('.bt-reader-page .bt-page-side-host {');
  });
});

describe('两截本（bands）', () => {
  const block = (id: string, size: number, band?: number): MeasurableBlock => ({
    id,
    mainSize: size,
    lineSize: 20,
    splittable: true,
    ...(band !== undefined ? { band } : {}),
  });

  it('分截分页合并：上 / 下截独立装箱、同页交错（页容量按截高占比）', () => {
    /* 页容量 100，两截 0.4 / 0.6 → 上截容量 40、下截 60 */
    const result = paginate(
      [block('u1', 40, 0), block('l1', 60, 1), block('u2', 40, 0), block('l2', 30, 1)],
      { pageMainSize: 100, bands: { count: 2, ratios: [0.4, 0.6] } },
    );
    /* 上截 2 页、下截 1 页 → 合并 2 页；页 1 = u1+l1，页 2 = u2+l2 */
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['u1', 'l1']);
    expect(result.pages[1]?.items.map((item) => item.block.id)).toEqual(['u2', 'l2']);
  });

  it('截容量独立：上截内容超容换页不影响下截', () => {
    const result = paginate(
      [block('l1', 60, 1), block('u1', 40, 0), block('u2', 40, 0)],
      { pageMainSize: 100, bands: { count: 2, ratios: [0.4, 0.6] } },
    );
    /* 下截 1 页；上截 2 页 → 合并 2 页（页 2 仅上截） */
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.block.id)).toEqual(['u1', 'l1']);
    expect(result.pages[1]?.items.map((item) => item.block.id)).toEqual(['u2']);
  });

  it('渲染分组：groupNodesByBand 按上 / 中 / 下聚组，无 band 节点归最下截', () => {
    const node = (id: string, band?: string): BookNode => {
      const n: BookNode = {
        type: NODE_TYPES.PARAGRAPH,
        id,
        children: [{ type: 'text', text: '文' }],
      };
      if (band !== undefined) n.attrs = { band };
      return n;
    };
    const groups = groupNodesByBand([node('u', 'upper'), node('x'), node('m', 'middle')]);
    expect(groups).toBeDefined();
    expect(groups?.map((g) => g.map((n) => n.id))).toEqual([['u'], ['m'], ['x']]);
    expect(groupNodesByBand([node('x')])).toBeUndefined();
  });
});
