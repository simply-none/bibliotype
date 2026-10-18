/**
 * 页底溢出解析测试（resolveBottomSlack）
 *
 * 几何口径：换页线自版心底下移 slack，但不得压到绝对定位的页码带
 * （`.bt-page-number`：bottom 16 + 字高 ≈ 29 → 预留 45px）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  PAGE_SIZES,
  resolveBottomSlack,
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

  it('默认页边距 48 与页码带冲突 → 截断到 48 − 40 = 8px（绝不压页码）', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '48px 56px' };
    expect(resolveBottomSlack(layout({ bottomSlack: { lines: 0.5 } }), tokens, LINE)).toBe(8);
    // 一行（30.4）与固定像素 40 同样被截断
    expect(resolveBottomSlack(layout({ bottomSlack: { lines: 1 } }), tokens, LINE)).toBe(8);
    expect(resolveBottomSlack(layout({ bottomSlack: { px: 40 } }), tokens, LINE)).toBe(8);
  });

  it('下边距足够时按请求量给（自定义 px 优先于行高倍数）', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '100px 56px' };
    expect(resolveBottomSlack(layout({ bottomSlack: { px: 60, lines: 0.5 } }), tokens, LINE)).toBe(
      60,
    );
    // 仍受「下边距 − 页码带」约束：100 − 40 = 60
    expect(resolveBottomSlack(layout({ bottomSlack: { px: 200 } }), tokens, LINE)).toBe(60);
  });

  it('启用页脚占位（已从版心扣除）→ 溢出可吃满整个下边距', () => {
    const tokens = { ...DEFAULT_THEME, 'page-margin': '48px 56px' };
    const withFooter = layout({
      bottomSlack: { px: 40 },
      pageChrome: { header: 'none', footer: 'pageNumber', headerSize: 0, footerSize: 24 },
    });
    expect(resolveBottomSlack(withFooter, tokens, LINE)).toBe(40);
  });

  it('页边距为 0 或直排 → 0（无侵入空间 / 主轴口径不同源）', () => {
    const noMargin = { ...DEFAULT_THEME, 'page-margin': '0px 0px' };
    expect(
      resolveBottomSlack(layout({ bottomSlack: { lines: 1 } }), noMargin, LINE),
    ).toBe(0);
    expect(
      resolveBottomSlack(
        layout({ bottomSlack: { lines: 1 }, writingMode: 'vertical-rl' }),
        DEFAULT_THEME,
        LINE,
      ),
    ).toBe(0);
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

  it('默认布局（A5 / 页边距 48）：页码带占 40，仅余 8px → 半行被截断', () => {
    expect(
      resolveBottomSlack(
        layout({ pageSize: PAGE_SIZES.A5, bottomSlack: { lines: 0.5 } }),
        DEFAULT_THEME,
        LINE,
      ),
    ).toBe(8);
  });
});
