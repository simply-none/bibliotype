/**
 * 页底溢出解析测试（resolveBottomSlack）
 *
 * 几何口径：换页线自版心底下移 slack，最深到「页码字形顶 − 3px」
 * （FOLIO_GAP_MIN：书排惯例末行与页码留一线空隙，页码带 40px 另加 3px）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  PAGE_SIZES,
  resolveBottomSlack,
  resolveCharsPerColumn,
  resolvePaginationGeometry,
  type LayoutOptions,
} from '../index.js';

const LINE = 30.4;

/** 覆写布局选项（避免各用例耦合默认值） */
function layout(patch: Partial<LayoutOptions>): LayoutOptions {
  return { ...DEFAULT_LAYOUT_OPTIONS, ...patch };
}

describe('resolveBottomSlack', () => {
  it('未配置 bottomSlack → 0（行为与引入该能力前一致）', () => {
    expect(resolveBottomSlack(layout({ bottomSlack: undefined }), DEFAULT_THEME, LINE)).toBe(0);
  });

  it('行高倍数口径：半行 = 0.5 × 行高（下边距留得下时全额生效）', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '60px 56px' };
    expect(resolveBottomSlack(layout({ bottomSlack: { lines: 0.5 } }), tokens, LINE)).toBe(15.2);
  });

  it('默认页边距 48 与页码带冲突 → 截断到 48 − 40 − 3 = 5px（距页码字形 ≥3px）', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '48px 56px' };
    expect(resolveBottomSlack(layout({ bottomSlack: { lines: 0.5 } }), tokens, LINE)).toBe(5);
    // 一行（30.4）与固定像素 40 同样被截断
    expect(resolveBottomSlack(layout({ bottomSlack: { lines: 1 } }), tokens, LINE)).toBe(5);
    expect(resolveBottomSlack(layout({ bottomSlack: { px: 40 } }), tokens, LINE)).toBe(5);
  });

  it('下边距足够时按请求量给（自定义 px 优先于行高倍数）', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '100px 56px' };
    expect(resolveBottomSlack(layout({ bottomSlack: { px: 57, lines: 0.5 } }), tokens, LINE)).toBe(
      57,
    );
    // 仍受「下边距 − 页码带 − 3px 间隙」约束：100 − 40 − 3 = 57
    expect(resolveBottomSlack(layout({ bottomSlack: { px: 200 } }), tokens, LINE)).toBe(57);
  });

  it('启用页脚占位（已从版心扣除）→ 溢出吃满下边距、留 3px 与页脚字形隔开', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '48px 56px' };
    const withFooter = layout({
      bottomSlack: { px: 60 },
      pageChrome: { header: 'none', footer: 'pageNumber', headerSize: 0, footerSize: 24 },
    });
    /* 请求 60 被预算截断：48 − 3 = 45 */
    expect(resolveBottomSlack(withFooter, tokens, LINE)).toBe(45);
  });

  it('页边距为 0 → 0（无侵入空间）；直排同预算公式（末列下沉向页码留 3px）', () => {
    const noMargin = { ...DEFAULT_THEME, 'page-margin': '0px 0px' };
    expect(
      resolveBottomSlack(layout({ bottomSlack: { lines: 1 } }), noMargin, LINE),
    ).toBe(0);
    /* 直排主轴 = 页宽，下沉吃排文末端侧边距：同一预算公式（48 − 40 − 3） */
    expect(
      resolveBottomSlack(
        layout({ bottomSlack: { lines: 1 }, writingMode: 'vertical-rl' }),
        DEFAULT_THEME,
        LINE,
      ),
    ).toBe(5);
  });

  it('非法 / 非正值一律归零', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '100px 56px' };
    expect(resolveBottomSlack(layout({ bottomSlack: { px: -10 } }), tokens, LINE)).toBe(0);
    expect(resolveBottomSlack(layout({ bottomSlack: {} }), tokens, LINE)).toBe(0);
    expect(
      resolveBottomSlack(
        layout({ bottomSlack: { lines: Number.NaN } }),
        tokens,
        LINE,
      ),
    ).toBe(0);
  });

  it('默认布局（A5 / 页边距 48）：页码带 40 + 3px 间隙 → 仅余 5px → 半行被截断', () => {
    expect(
      resolveBottomSlack(
        layout({ pageSize: PAGE_SIZES.A5, bottomSlack: { lines: 0.5 } }),
        DEFAULT_THEME,
        LINE,
      ),
    ).toBe(5);
  });
});

describe('resolvePaginationGeometry（行网格量化）', () => {
  it('容量向下取整到整行：均匀行高的页排满时内容底缘恒在同一高度', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '48px 56px' };
    const geo = resolvePaginationGeometry(layout({ pageSize: PAGE_SIZES.A5 }), tokens);
    /* rawMain(A5) + slack(5) 的容量按行步进 30.4 向下取整；余量回到 bottomSlack */
    const step = 30.4;
    /* 判整用除法取模（JS % 对 23×30.4 这类积会回退 30.4−ε，不可靠） */
    expect(geo.pageMainSize / step % 1).toBeCloseTo(0, 6);
    expect(geo.pageMainSize + geo.bottomSlack).toBeCloseTo(geo.rawMainSize + 5, 6);
    expect(geo.pageMainSize).toBeLessThanOrEqual(geo.rawMainSize + 5);
    expect(geo.pageMainSize).toBeGreaterThan(geo.rawMainSize + 5 - step);
  });

  it('直排：主轴按列距取整（列数与界行网格一致），不放开页底溢出', () => {
    const geo = resolvePaginationGeometry(
      layout({ writingMode: 'vertical-rl', pageSize: PAGE_SIZES.A5, }),
      DEFAULT_THEME,
    );
    const pitch = 30.4;
    /* 直排的末行是一整列：列宽是硬边，版心宽 ÷ 列距 的余量（< 1 列）排不进
     * 任何字，放行它只会让末列探进左边距被页框裁掉 → bottomSlack 恒 0。
     * 容量仍按「raw + 预算」再按列距向下取整。 */
    expect((geo.pageMainSize / pitch) % 1).toBeCloseTo(0, 6);
    expect(geo.bottomSlack).toBe(0);
    expect(geo.pageMainSize).toBeLessThanOrEqual(geo.rawMainSize + 5);
    expect(geo.pageMainSize).toBeGreaterThan(geo.rawMainSize + 5 - pitch);
  });
});

describe('resolveCharsPerColumn（直排每列字数统一口径）', () => {
  it('交叉轴 ÷ 字位步进（字号×(1+字距)）向下取整', () => {
    const tokens = {
      ...DEFAULT_THEME,
      'font-size-body': '16px',
      'letter-spacing-body': '0.02em',
      'page-margin': '48px 56px',
    };
    const geo = resolvePaginationGeometry;
    void geo;
    const result = resolveCharsPerColumn(
      layout({ writingMode: 'vertical-rl', pageSize: PAGE_SIZES.A5, }),
      tokens,
    );
    /* A5 交叉轴 698（扣边距），字位步进 16 × 1.02 = 16.32 → floor(698 / 16.32) = 42 */
    expect(result).toBe(42);
  });

  it('与仿真几何层同式（floor ÷ 字距步进），列底不再空出字位', () => {
    const tokens = { ...DEFAULT_THEME, 'font-size-body': '16px', 'letter-spacing-body': '0px', 'page-margin': '48px 56px' };
    const result = resolveCharsPerColumn(
      layout({ writingMode: 'vertical-rl', pageSize: PAGE_SIZES.A5, }),
      tokens,
    );
    /* 无字距：步进 16 → floor(698/16) = 43（曾 round(698/16) = 44 → 多出 1 字位） */
    expect(result).toBe(43);
  });
});
