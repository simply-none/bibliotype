/**
 * 度量签名测试
 *
 * 这条约束是性能红线：纯视觉参数（颜色 / 线型 / 底色）不得改变签名，
 * 否则拖动颜色滑块会让 78 万字文档全量重排；而任何影响字形占位的参数
 * 必须改变签名，否则会出现「改了字号但页面不重排」的错页。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import { computeMetricsSignature } from '../metrics-signature.js';
import { CLASSICAL_LAYOUT_OPTIONS, DEFAULT_LAYOUT_OPTIONS } from '../layout-options.js';

const base = { tokens: DEFAULT_THEME, options: DEFAULT_LAYOUT_OPTIONS };

describe('computeMetricsSignature', () => {
  it('同配置得到同签名（可跨轮比较）', () => {
    expect(computeMetricsSignature({ ...base })).toBe(computeMetricsSignature({ ...base }));
  });

  it('颜色 / 底色等纯视觉令牌不改变签名', () => {
    const colored = {
      ...base,
      tokens: { ...DEFAULT_THEME, 'color-text': '#ff0000', 'color-background': '#000000' },
    };
    expect(computeMetricsSignature(colored)).toBe(computeMetricsSignature({ ...base }));
  });

  it('字号 / 行距 / 字距 / 缩进 / 页边距改变签名', () => {
    const before = computeMetricsSignature({ ...base });
    for (const key of [
      FONT_SIZE_TOKENS.BODY,
      LAYOUT_TOKENS.LINE_HEIGHT,
      LAYOUT_TOKENS.LETTER_SPACING,
      LAYOUT_TOKENS.TEXT_INDENT,
      LAYOUT_TOKENS.PAGE_MARGIN,
    ]) {
      const changed = { ...base, tokens: { ...DEFAULT_THEME, [key]: '999px' } };
      expect(computeMetricsSignature(changed)).not.toBe(before);
    }
  });

  it('页面尺寸 / 书写方向 / 分栏改变签名', () => {
    const before = computeMetricsSignature({ ...base });
    expect(
      computeMetricsSignature({
        ...base,
        options: {
          ...DEFAULT_LAYOUT_OPTIONS,
          pageSize: { name: '定制', width: 500, height: 800 },
        },
      }),
    ).not.toBe(before);
    expect(
      computeMetricsSignature({ ...base, options: CLASSICAL_LAYOUT_OPTIONS }),
    ).not.toBe(before);
    expect(
      computeMetricsSignature({ ...base, options: { ...DEFAULT_LAYOUT_OPTIONS, columns: 2 } }),
    ).not.toBe(before);
  });

  it('功能样式：纯视觉声明不改变签名，度量声明改变签名', () => {
    const visual = computeMetricsSignature({
      ...base,
      features: { 'block.paragraph': { color: '#123456', 'border-radius': '2px' } },
    });
    expect(visual).toBe(computeMetricsSignature({ ...base }));

    const metric = computeMetricsSignature({
      ...base,
      features: { 'block.paragraph': { 'font-size': '20px' } },
    });
    expect(metric).not.toBe(computeMetricsSignature({ ...base }));

    // 行高 / 外边距 / 内边距 / 字距都属度量类
    for (const property of ['line-height', 'margin-top', 'padding-block-start', 'letter-spacing']) {
      expect(
        computeMetricsSignature({
          ...base,
          features: { 'block.paragraph': { [property]: '3px' } },
        }),
      ).not.toBe(computeMetricsSignature({ ...base }));
    }
  });

  it('页眉 / 页脚启用或改占位高度改变签名（版心随之变化）', () => {
    const before = computeMetricsSignature({ ...base });
    const withHeader = computeMetricsSignature({
      ...base,
      options: {
        ...DEFAULT_LAYOUT_OPTIONS,
        pageChrome: { header: 'bookTitle', footer: 'none', headerSize: 26, footerSize: 0 },
      },
    });
    expect(withHeader).not.toBe(before);

    const taller = computeMetricsSignature({
      ...base,
      options: {
        ...DEFAULT_LAYOUT_OPTIONS,
        pageChrome: { header: 'bookTitle', footer: 'none', headerSize: 40, footerSize: 0 },
      },
    });
    expect(taller).not.toBe(withHeader);
  });
});
