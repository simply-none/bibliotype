/**
 * 「现代横排 / 古籍直排」零影响回归
 *
 * 古籍仿真直排是**并列**功能：未启用（`facsimile === undefined`）时，
 * 样式表、版心尺寸、度量签名都必须与改造前完全一致。本文件是这条红线的
 * 守护测试——任何新分支漏加闸门，这里先红。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS, DEFAULT_LAYOUT_OPTIONS } from '../layout-options.js';
import { computeMetricsSignature } from '../metrics-signature.js';
import {
  buildRootStyle,
  resolveBottomSlack,
  resolvePageCrossSize,
  resolvePageMainSize,
} from '../style-builder.js';
import { resolvePageMarginBox } from '../page-size.js';
import { buildBookCss } from '../html/book-css.js';
import { isFacsimileEnabled } from '../facsimile.js';
import {
  CLASSICAL_BASELINE_CONTAINER,
  CLASSICAL_BASELINE_FONT_TOKEN,
  CLASSICAL_BASELINE_TOKENS,
  CLASSICAL_BOTTOM_SLACK,
  CLASSICAL_CROSS_SIZE,
  CLASSICAL_CSS_FNV,
  CLASSICAL_MAIN_SIZE,
  CLASSICAL_SIGNATURE_FNV,
  fnv1a,
} from './fixtures/classical-baseline.js';

/** 古典主题的典型令牌（含 demo 里的版框令牌） */
const CLASSICAL_TOKENS = CLASSICAL_BASELINE_TOKENS;

describe('古籍直排：仿真能力缺省时零影响', () => {
  it('默认布局与古典布局都不带 facsimile 字段', () => {
    expect(DEFAULT_LAYOUT_OPTIONS.facsimile).toBeUndefined();
    expect(CLASSICAL_LAYOUT_OPTIONS.facsimile).toBeUndefined();
    expect(isFacsimileEnabled(DEFAULT_LAYOUT_OPTIONS)).toBe(false);
    expect(isFacsimileEnabled(CLASSICAL_LAYOUT_OPTIONS)).toBe(false);
  });

  it('古典样式表不含任何仿真变量与装饰类', () => {
    const css = buildBookCss({
      tokens: CLASSICAL_TOKENS,
      options: CLASSICAL_LAYOUT_OPTIONS,
      fontToken: 'font-family-classical-body',
      containerSelector: '.bt-reader-page',
    });
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('.bt-reader-page::before');
    expect(css).not.toContain('.bt-reader-page::after');
    expect(css).not.toContain('repeating-linear-gradient');
    expect(css).not.toContain('bt-page-gutter');
    /* 古典版框令牌仍按原语义输出（此令牌不因仿真能力而失效） */
    expect(css).toContain('border: 3px double #b09a76');
  });

  it('即便开启 pageDecoration，没有 facsimile 也不输出装饰（双闸门第二道）', () => {
    const css = buildBookCss({
      tokens: CLASSICAL_TOKENS,
      options: CLASSICAL_LAYOUT_OPTIONS,
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('.bt-reader-page::before');
    expect(css).not.toContain('bt-page-gutter');
  });

  it('古典根样式仍输出 page-border，且不新增内缩声明', () => {
    const style = buildRootStyle({
      tokens: CLASSICAL_TOKENS,
      options: CLASSICAL_LAYOUT_OPTIONS,
      fontToken: 'font-family-classical-body',
    });
    expect(style['border']).toBe('3px double #b09a76');
    expect(style['padding-left']).toBeUndefined();
    expect(style['padding-right']).toBeUndefined();
  });

  it('版心主轴 / 交叉轴尺寸仍按「页宽 − 边距 − 版框」计算', () => {
    const margins = resolvePageMarginBox(CLASSICAL_TOKENS);
    const border = 6; // 3px 版框 × 两侧
    expect(resolvePageMainSize(CLASSICAL_LAYOUT_OPTIONS, CLASSICAL_TOKENS)).toBe(
      CLASSICAL_LAYOUT_OPTIONS.pageSize.width - margins.left - margins.right - border,
    );
    expect(resolvePageCrossSize(CLASSICAL_LAYOUT_OPTIONS, CLASSICAL_TOKENS)).toBe(
      CLASSICAL_LAYOUT_OPTIONS.pageSize.height - margins.top - margins.bottom - border,
    );
  });

  it('基线快照：古典 CSS 全文 / 签名 / 版心尺寸与锁定值一致', () => {
    const css = buildBookCss({
      tokens: CLASSICAL_TOKENS,
      options: CLASSICAL_LAYOUT_OPTIONS,
      fontToken: CLASSICAL_BASELINE_FONT_TOKEN,
      containerSelector: CLASSICAL_BASELINE_CONTAINER,
    });
    expect(fnv1a(css), '古典样式表发生字符级变化').toBe(CLASSICAL_CSS_FNV);

    const signature = computeMetricsSignature({
      tokens: CLASSICAL_TOKENS,
      options: CLASSICAL_LAYOUT_OPTIONS,
    });
    expect(fnv1a(signature), '古典度量签名发生字符级变化').toBe(CLASSICAL_SIGNATURE_FNV);

    expect(resolvePageMainSize(CLASSICAL_LAYOUT_OPTIONS, CLASSICAL_TOKENS)).toBe(
      CLASSICAL_MAIN_SIZE,
    );
    expect(resolvePageCrossSize(CLASSICAL_LAYOUT_OPTIONS, CLASSICAL_TOKENS)).toBe(
      CLASSICAL_CROSS_SIZE,
    );
    expect(resolveBottomSlack(CLASSICAL_LAYOUT_OPTIONS, CLASSICAL_TOKENS, 30)).toBe(
      CLASSICAL_BOTTOM_SLACK,
    );
  });

  it('度量签名不追加任何仿真片段', () => {
    const signature = computeMetricsSignature({
      tokens: CLASSICAL_TOKENS,
      options: CLASSICAL_LAYOUT_OPTIONS,
    });
    expect(signature).not.toContain('|fs:');
  });

  it('现代横排同样不含仿真痕迹', () => {
    const css = buildBookCss({
      tokens: DEFAULT_THEME,
      options: DEFAULT_LAYOUT_OPTIONS,
      containerSelector: '.bt-reader-page',
      pageDecoration: true,
    });
    expect(css).not.toContain('--bt-fs-');
    expect(css).not.toContain('bt-page-gutter');
  });
});
