/**
 * 古籍仿真版式：几何 / 样式构建 / 度量签名测试
 *
 * 关注点：
 * - 版框线宽只影响绘制，界行节距 = 字号 × 行距，版心带宽是唯一进主轴的量；
 * - `buildRootStyle` 的版心内缩与 `resolvePageMainSize` 的扣减严格同源；
 * - 度量签名：改颜色不变、改版心带宽必变，且非仿真配置不追加任何片段；
 * - `buildBookCss` 的装饰图层受「pageDecoration + facsimile + 直排」三重约束。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import { FACSIMILE_PRESETS } from '../facsimile-presets.js';
import {
  FACSIMILE_FRAMES,
  FACSIMILE_RULES,
  GUTTER_FISH_TAILS,
  GUTTER_MOUTHS,
  GUTTER_SIDES,
  isFacsimileEnabled,
  type FacsimileOptions,
} from '../facsimile.js';
import {
  resolveFacsimileFrameThickness,
  resolveFacsimileGrid,
  resolveFacsimileGutterSize,
  resolveFrameInsets,
  resolveLinePitch,
  resolveRuleInsets,
} from '../facsimile-geometry.js';
import { buildRootStyle, resolvePageCrossSize, resolvePageMainSize } from '../style-builder.js';
import { buildBookCss } from '../html/book-css.js';
import { computeMetricsSignature } from '../metrics-signature.js';
import type { LayoutOptions } from '../layout-options.js';

/** 宋刻浙本（默认模板）作为仿真样本 */
const PRESET = FACSIMILE_PRESETS[0] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;
const FAC_LAYOUT = PRESET.layout;
const FAC_TOKENS = { ...DEFAULT_THEME, ...PRESET.tokens };

/** 构造带指定 facsimile 的布局 */
function layoutWith(facsimile: FacsimileOptions): LayoutOptions {
  return { ...FAC_LAYOUT, facsimile };
}

describe('仿真几何', () => {
  it('列距 = 字号 × 行距（与 PDF 打印同口径）', () => {
    expect(resolveLinePitch(FAC_TOKENS)).toBe(42.9);
    expect(resolveLinePitch({ ...FAC_TOKENS, 'font-size-body': '20px', 'line-height-body': '1.5' })).toBe(30);
  });

  it('行距令牌非法时回落到默认倍数，不产生 NaN', () => {
    const pitch = resolveLinePitch({ ...FAC_TOKENS, 'line-height-body': 'normal' });
    expect(Number.isFinite(pitch)).toBe(true);
    expect(pitch).toBeGreaterThan(0);
  });

  it('版框线宽：单边 / 双边 / 左右双边各按形态给出方向厚度', () => {
    const thickness = (frame: FacsimileOptions['frame']) =>
      resolveFacsimileFrameThickness(layoutWith({ ...PRESET.layout.facsimile!, frame }), FAC_TOKENS);
    expect(thickness(FACSIMILE_FRAMES.NONE)).toEqual({ x: 0, y: 0 });
    expect(thickness(FACSIMILE_FRAMES.SINGLE)).toEqual({ x: 2, y: 2 });
    expect(thickness(FACSIMILE_FRAMES.DOUBLE)).toEqual({ x: 6, y: 6 });
    expect(thickness(FACSIMILE_FRAMES.LEFT_RIGHT)).toEqual({ x: 6, y: 2 });
  });

  it('版框内缩 = 页边距 − 线宽（外扩到页边距内，不吃版心）', () => {
    expect(resolveFrameInsets(FAC_LAYOUT, FAC_TOKENS)).toEqual({
      top: 194,
      right: 114,
      bottom: 167,
      left: 84,
    });
  });

  it('界行区域三边取页边距、版心侧再加带宽', () => {
    expect(resolveRuleInsets(FAC_LAYOUT, FAC_TOKENS)).toEqual({
      top: 200,
      right: 120,
      bottom: 173,
      left: 124,
    });
    const rightSide = layoutWith({
      ...PRESET.layout.facsimile!,
      gutter: { ...PRESET.layout.facsimile!.gutter!, side: GUTTER_SIDES.RIGHT },
    });
    expect(resolveRuleInsets(rightSide, FAC_TOKENS).right).toBe(154);
  });

  it('版心带宽：未配置 / 非法值都收敛为 0', () => {
    expect(resolveFacsimileGutterSize(layoutWith({ preset: 'custom', frame: 'none', rule: 'none' }))).toBe(0);
    const zero = layoutWith({
      ...PRESET.layout.facsimile!,
      gutter: {
        side: GUTTER_SIDES.LEFT,
        size: 0,
        mouth: GUTTER_MOUTHS.WHITE,
        fishTail: GUTTER_FISH_TAILS.NONE,
        fields: [],
      },
    });
    expect(resolveFacsimileGutterSize(zero)).toBe(0);
  });

  it('行款口径：文本区宽 = 版心宽 − 带宽', () => {
    const grid = resolveFacsimileGrid(FAC_LAYOUT, FAC_TOKENS);
    expect(grid.contentWidth).toBe(489);
    expect(grid.gutterSize).toBe(34);
    expect(grid.textWidth).toBe(455);
    expect(grid.linesPerHalfLeaf).toBe(10);
    expect(grid.charsPerColumn).toBe(27);
  });
});

describe('仿真样式构建', () => {
  it('版心开启时 padding 内缩 = 页边距 + 带宽，且不再输出 page-border', () => {
    const style = buildRootStyle({
      tokens: { ...FAC_TOKENS, 'page-border': '3px double #000' },
      options: FAC_LAYOUT,
      fontToken: PRESET.fontToken,
    });
    expect(style['padding-left']).toBe('124px');
    expect(style['padding-right']).toBeUndefined();
    /* 仿真版框画在页边距内，page-border 与其扣减成对失效 */
    expect(style['border']).toBeUndefined();
  });

  it('版心在右侧时镜像内缩', () => {
    const right = layoutWith({
      ...PRESET.layout.facsimile!,
      gutter: { ...PRESET.layout.facsimile!.gutter!, side: GUTTER_SIDES.RIGHT },
    });
    const style = buildRootStyle({ tokens: FAC_TOKENS, options: right, fontToken: PRESET.fontToken });
    expect(style['padding-right']).toBe('154px');
    expect(style['padding-left']).toBeUndefined();
  });

  it('主轴扣掉版心带宽，交叉轴不受影响（交叉轴也不再扣 page-border）', () => {
    expect(resolvePageMainSize(FAC_LAYOUT, FAC_TOKENS)).toBe(455);
    expect(resolvePageCrossSize(FAC_LAYOUT, FAC_TOKENS)).toBe(610);
  });
});

describe('仿真度量签名', () => {
  it('改颜色不改变签名（装饰不重排）', () => {
    const base = computeMetricsSignature({ tokens: FAC_TOKENS, options: FAC_LAYOUT });
    const recolored = computeMetricsSignature({
      tokens: { ...FAC_TOKENS, 'page-frame-color': '#a33a2a', 'page-rule-color': '#a33a2a' },
      options: FAC_LAYOUT,
    });
    expect(recolored).toBe(base);
  });

  it('改版心带宽必变（参与主轴扣减）', () => {
    const base = computeMetricsSignature({ tokens: FAC_TOKENS, options: FAC_LAYOUT });
    const wider = computeMetricsSignature({
      tokens: FAC_TOKENS,
      options: layoutWith({
        ...PRESET.layout.facsimile!,
        gutter: { ...PRESET.layout.facsimile!.gutter!, size: 60 },
      }),
    });
    expect(wider).not.toBe(base);
  });

  it('仿真片段只追加在尾部，前缀与古典口径一致', () => {
    const signature = computeMetricsSignature({ tokens: FAC_TOKENS, options: FAC_LAYOUT });
    expect(signature).toContain('|fs:double/ink/g34/ft');
    expect(signature.indexOf('|fs:')).toBeGreaterThan(signature.indexOf('line-height'));
  });

  it('isFacsimileEnabled 只认 facsimile 字段本身', () => {
    expect(isFacsimileEnabled({})).toBe(false);
    expect(isFacsimileEnabled({ facsimile: undefined })).toBe(false);
    expect(isFacsimileEnabled(FAC_LAYOUT)).toBe(true);
  });
});

describe('装饰图层样式（buildBookCss）', () => {
  it('pageDecoration + facsimile + 直排：输出带容器前缀的版框 / 界行 / 版心规则', () => {
    const css = buildBookCss({
      tokens: FAC_TOKENS,
      options: FAC_LAYOUT,
      fontToken: PRESET.fontToken,
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).toContain('--bt-fs-line-pitch: 42.9px');
    expect(css).toContain('--bt-fs-frame-inset: 194px 114px 167px 84px');
    expect(css).toContain('--bt-fs-rule-inset: 200px 120px 173px 124px');
    expect(css).toContain('.bt-reader-page::before');
    expect(css).toContain('border: 6px double');
    expect(css).toContain('.bt-reader-page::after');
    expect(css).toContain('repeating-linear-gradient');
    expect(css).toContain('.bt-reader-page .bt-page-gutter');
    expect(css).toContain('.bt-reader-page .bt-page-gutter__fish');
    /* 版心已承载叶次 → 页脚页码隐藏 */
    expect(css).toContain('.bt-reader-page .bt-page-number');
  });

  it('界行可关闭：rule=none 时不输出 ::after 图层', () => {
    const css = buildBookCss({
      tokens: FAC_TOKENS,
      options: layoutWith({ ...PRESET.layout.facsimile!, rule: FACSIMILE_RULES.NONE }),
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).toContain('.bt-reader-page::before');
    expect(css).not.toContain('.bt-reader-page::after');
  });

  it('朱丝栏使用朱红界行色', () => {
    const css = buildBookCss({
      tokens: { ...FAC_TOKENS, 'page-rule-color': '#a33a2a' },
      options: layoutWith({ ...PRESET.layout.facsimile!, rule: FACSIMILE_RULES.VERMILION }),
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).toContain('#a33a2a');
  });

  it('横排下即便带 facsimile 也不输出装饰与仿真变量', () => {
    const css = buildBookCss({
      tokens: FAC_TOKENS,
      options: { ...FAC_LAYOUT, writingMode: 'horizontal-tb' },
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('.bt-reader-page::before');
  });

  it('未开启 pageDecoration 时不输出装饰（EPUB / 连续编辑画布路径）', () => {
    const css = buildBookCss({
      tokens: FAC_TOKENS,
      options: FAC_LAYOUT,
      containerSelector: '.bt-reader-page',
    });
    expect(css).not.toContain('.bt-reader-page::before');
    expect(css).not.toContain('.bt-page-gutter');
    /* 变量层同样不输出：EPUB / 连续编辑画布的产物保持纯净 */
    expect(css).not.toContain('--bt-fs-');
  });
});
