/**
 * 样式构建器测试
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
} from '../layout-options.js';
import { PAGE_SIZES } from '../page-size.js';
import {
  buildCssVariables,
  buildPageStyle,
  buildRootStyle,
  resolvePageBorderWidth,
  resolvePageMainSize,
  resolvePageMargins,
} from '../style-builder.js';

describe('buildRootStyle', () => {
  it('横排：产出字体/颜色/书写方向，不含字符合并声明', () => {
    const style = buildRootStyle({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(style['font-family']).toContain('Noto Serif SC');
    expect(style['color']).toBe('#2c2c2c');
    expect(style['background-color']).toBe('#faf8f4');
    expect(style['writing-mode']).toBe('horizontal-tb');
    expect(style['text-combine-upright']).toBeUndefined();
    expect(style['column-count']).toBeUndefined();
  });

  it('直排：产出 text-orientation 与数字合并声明（D3）', () => {
    const style = buildRootStyle({
      tokens: { ...DEFAULT_THEME, 'text-orientation': 'mixed' },
      options: CLASSICAL_LAYOUT_OPTIONS,
      fontToken: 'font-family-classical-body',
    });
    expect(style['writing-mode']).toBe('vertical-rl');
    expect(style['text-orientation']).toBe('mixed');
    expect(style['text-combine-upright']).toBe('digits 4');
    expect(style['font-family']).toContain('Source Han Serif SC');
  });

  it('多栏：产出 column-count 与 column-gap', () => {
    const style = buildRootStyle({
      tokens: DEFAULT_THEME,
      options: { ...DEFAULT_LAYOUT_OPTIONS, columns: 2 },
    });
    expect(style['column-count']).toBe('2');
    expect(style['column-gap']).toBe('2.5em');
  });

  it('禁用数字合并时不产出 text-combine-upright', () => {
    const style = buildRootStyle({
      tokens: DEFAULT_THEME,
      options: {
        ...CLASSICAL_LAYOUT_OPTIONS,
        combineUpright: { maxDigits: 0, latinStrategy: 'rotate' },
      },
    });
    expect(style['text-combine-upright']).toBeUndefined();
  });

  it('page-border 扩展令牌输出版框边框，缺省不输出', () => {
    const withBorder = buildRootStyle({
      tokens: { ...DEFAULT_THEME, 'page-border': '1px solid #8c5a2b' },
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(withBorder['border']).toBe('1px solid #8c5a2b');

    const without = buildRootStyle({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
    });
    expect(without['border']).toBeUndefined();
  });
});

describe('buildPageStyle', () => {
  it('页面尺寸与内边距', () => {
    const style = buildPageStyle(PAGE_SIZES.A5, DEFAULT_THEME);
    expect(style['width']).toBe('559px');
    expect(style['height']).toBe('794px');
    expect(style['padding']).toBe('48px 56px');
    expect(style['box-sizing']).toBe('border-box');
    expect(style['overflow']).toBe('hidden');
  });

  it('缺失页边距令牌时省略 padding', () => {
    const style = buildPageStyle(PAGE_SIZES.A4, {});
    expect(style['padding']).toBeUndefined();
  });
});

describe('buildCssVariables', () => {
  it('令牌键映射为 --bt-* 变量', () => {
    const vars = buildCssVariables({ 'font-family-body': 'serif', 'color-text': '#000' });
    expect(vars['--bt-font-family-body']).toBe('serif');
    expect(vars['--bt-color-text']).toBe('#000');
  });

  it('忽略空值与 undefined', () => {
    const vars = buildCssVariables({ a: '', b: undefined, c: 'ok' });
    expect(vars).toEqual({ '--bt-c': 'ok' });
  });
});

describe('PAGE_SIZES 预设', () => {
  it('覆盖国际 ISO 与中国出版常用开本', () => {
    expect(Object.keys(PAGE_SIZES)).toEqual(
      expect.arrayContaining(['A4', 'A5', 'B5', 'DACHU_16', 'FOLIO_16', 'DACHU_32', 'FOLIO_32']),
    );
  });

  it('各预设尺寸为正且命名带规格标注', () => {
    for (const size of Object.values(PAGE_SIZES)) {
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(size.name).toMatch(/\d+×\d+/);
    }
  });
});

describe('resolvePageMainSize', () => {
  it('横排取内容区高度（页高扣上下页边距）', () => {
    // A5 794 高 - 48×2 = 698
    const main = resolvePageMainSize(DEFAULT_LAYOUT_OPTIONS, DEFAULT_THEME);
    expect(main).toBe(PAGE_SIZES.A5.height - 48 * 2);
  });

  it('直排取内容区宽度（页宽扣左右页边距）', () => {
    // A5 559 宽 - 56×2 = 447
    const main = resolvePageMainSize(CLASSICAL_LAYOUT_OPTIONS, DEFAULT_THEME);
    expect(main).toBe(CLASSICAL_LAYOUT_OPTIONS.pageSize.width - 56 * 2);
  });

  it('随页面尺寸开本切换而变化', () => {
    const a5 = resolvePageMainSize(DEFAULT_LAYOUT_OPTIONS, DEFAULT_THEME);
    const a4 = resolvePageMainSize(
      { ...DEFAULT_LAYOUT_OPTIONS, pageSize: PAGE_SIZES.A4 },
      DEFAULT_THEME,
    );
    expect(a4).toBeGreaterThan(a5);
  });

  it('页边距缺省时回退为整页主轴尺寸', () => {
    const main = resolvePageMainSize(DEFAULT_LAYOUT_OPTIONS, {});
    expect(main).toBe(DEFAULT_LAYOUT_OPTIONS.pageSize.height);
  });

  it('版框边框侵占 border-box 内容区：主轴尺寸同步扣除两侧边框宽', () => {
    const noBorder = resolvePageMainSize(DEFAULT_LAYOUT_OPTIONS, DEFAULT_THEME);
    const bordered = resolvePageMainSize(DEFAULT_LAYOUT_OPTIONS, {
      ...DEFAULT_THEME,
      'page-border': '3px double #b09a76',
    });
    expect(noBorder - bordered).toBe(6);
  });

  it('resolvePageBorderWidth 仅解析 px 前缀值，缺省 / 非 px 归 0', () => {
    expect(resolvePageBorderWidth({ 'page-border': '3px double #b09a76' })).toBe(3);
    expect(resolvePageBorderWidth({ 'page-border': '1.5px solid black' })).toBe(1.5);
    expect(resolvePageBorderWidth({ 'page-border': '2em solid black' })).toBe(0);
    expect(resolvePageBorderWidth({})).toBe(0);
  });
});

describe('resolvePageMargins', () => {
  it('解析 "48px 56px" 为 [上下, 左右]', () => {
    expect(resolvePageMargins({ 'page-margin': '48px 56px' })).toEqual([48, 56]);
  });

  it('单值时横向取纵向同值；缺省令牌回退 [0, 0]', () => {
    expect(resolvePageMargins({ 'page-margin': '40px' })).toEqual([40, 40]);
    expect(resolvePageMargins({})).toEqual([0, 0]);
  });

  it('非 px 单位显式拒绝（避免分页主轴与 CSS 版心静默错位）', () => {
    expect(() => resolvePageMargins({ 'page-margin': '3em 4em' })).toThrow(RangeError);
    expect(() => resolvePageMargins({ 'page-margin': '48px 10%' })).toThrow(RangeError);
  });
});
