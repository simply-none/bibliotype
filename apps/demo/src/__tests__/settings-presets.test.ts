/**
 * 设置面板预设表与命中判定
 *
 * 覆盖四条口径：
 * 1. 版式套餐五组令牌齐备（字号 / 行距 / 字距 / 首行缩进 / 页边距）；
 * 2. 数值型档位命中按数值全等（`16px` / `1.90` 都能归位），未命中回空串；
 * 3. 字体栈只认全等字面量，页眉页脚组合按四字段全等判定；
 * 4. 版心带宽档位与数值输入同口径。
 */
import { describe, expect, it } from 'vitest';
import { FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import { PAGE_CHROME_FIELDS } from '@bibliotype/layout';
import {
  FONT_SIZE_PRESETS,
  FONT_STACK_PRESETS,
  GUTTER_WIDTH_PRESETS,
  LAYOUT_PACKAGE_PRESETS,
  LETTER_SPACING_PRESETS,
  LINE_HEIGHT_PRESETS,
  PAGE_CHROME_PRESETS,
  TEXT_INDENT_PRESETS,
  resolveFontStackPreset,
  resolveNumericPreset,
  resolvePageChromePreset,
} from '../components/settings/settings-presets.js';

describe('版式套餐', () => {
  it('五组套餐各写五组令牌，现代标准等于库默认组合', () => {
    expect(LAYOUT_PACKAGE_PRESETS.map((preset) => preset.key)).toEqual([
      'modern',
      'compact',
      'airy',
      'classical',
      'large',
    ]);

    const modern = LAYOUT_PACKAGE_PRESETS[0];
    expect(modern?.tokens).toEqual({
      [FONT_SIZE_TOKENS.BODY]: '16px',
      [LAYOUT_TOKENS.LINE_HEIGHT]: '1.9',
      [LAYOUT_TOKENS.LETTER_SPACING]: '0.02em',
      [LAYOUT_TOKENS.TEXT_INDENT]: '2em',
      [LAYOUT_TOKENS.PAGE_MARGIN]: '48px 56px 48px 56px',
    });

    for (const preset of LAYOUT_PACKAGE_PRESETS) {
      expect(Object.keys(preset.tokens)).toHaveLength(5);
    }
  });

  it('古籍刻本缩进 0、页边距汲古阁口径；紧凑电子行距 1.5', () => {
    const classical = LAYOUT_PACKAGE_PRESETS.find((preset) => preset.key === 'classical');
    expect(classical?.tokens[LAYOUT_TOKENS.TEXT_INDENT]).toBe('0');
    expect(classical?.tokens[LAYOUT_TOKENS.PAGE_MARGIN]).toBe('172px 100px 150px 72px');

    const compact = LAYOUT_PACKAGE_PRESETS.find((preset) => preset.key === 'compact');
    expect(compact?.tokens[LAYOUT_TOKENS.LINE_HEIGHT]).toBe('1.5');
    expect(compact?.tokens[FONT_SIZE_TOKENS.BODY]).toBe('15px');
  });
});

describe('数值型档位命中', () => {
  it('字号按数值部分归位，未命中回空串', () => {
    expect(resolveNumericPreset('16px', FONT_SIZE_PRESETS)).toBe('16');
    expect(resolveNumericPreset('16.0px', FONT_SIZE_PRESETS)).toBe('16');
    expect(resolveNumericPreset('17px', FONT_SIZE_PRESETS)).toBe('');
    expect(resolveNumericPreset(undefined, FONT_SIZE_PRESETS)).toBe('');
  });

  it('行距 / 字距 / 缩进按数值全等（1.90 仍落 1.9）', () => {
    expect(resolveNumericPreset('1.90', LINE_HEIGHT_PRESETS)).toBe('standard');
    expect(resolveNumericPreset('1.55', LINE_HEIGHT_PRESETS)).toBe('');
    expect(resolveNumericPreset('0em', LETTER_SPACING_PRESETS)).toBe('none');
    expect(resolveNumericPreset('0.04em', LETTER_SPACING_PRESETS)).toBe('');
    expect(resolveNumericPreset('2em', TEXT_INDENT_PRESETS)).toBe('two');
  });

  it('版心带宽档位与数值共用口径', () => {
    expect(resolveNumericPreset(30, GUTTER_WIDTH_PRESETS)).toBe('standard');
    expect(resolveNumericPreset('48', GUTTER_WIDTH_PRESETS)).toBe('xwide');
    expect(resolveNumericPreset(34, GUTTER_WIDTH_PRESETS)).toBe('');
  });
});

describe('字体栈与页眉页脚组合', () => {
  it('字体栈只认全等字面量，手输熄灭', () => {
    const kaiti = FONT_STACK_PRESETS.find((preset) => preset.key === 'kaiti');
    expect(resolveFontStackPreset(kaiti?.stack)).toBe('kaiti');
    expect(resolveFontStackPreset("'Songti SC', serif")).toBe('');
    expect(resolveFontStackPreset(undefined)).toBe('');
  });

  it('页眉页脚四字段全等才命中，未配置按关闭态', () => {
    expect(resolvePageChromePreset(undefined)).toBe('off');
    expect(
      resolvePageChromePreset({
        header: PAGE_CHROME_FIELDS.BOOK_TITLE,
        headerSize: 26,
        footer: PAGE_CHROME_FIELDS.PAGE_NUMBER,
        footerSize: 26,
      }),
    ).toBe('classic');
    expect(
      resolvePageChromePreset({
        header: PAGE_CHROME_FIELDS.CHAPTER_TITLE,
        headerSize: 26,
        footer: PAGE_CHROME_FIELDS.PAGE_NUMBER,
        footerSize: 26,
      }),
    ).toBe('academic');
    /* 单项微调（占位改 30）后不再命中任何组合 */
    expect(
      resolvePageChromePreset({
        header: PAGE_CHROME_FIELDS.BOOK_TITLE,
        headerSize: 30,
        footer: PAGE_CHROME_FIELDS.PAGE_NUMBER,
        footerSize: 26,
      }),
    ).toBe('');
  });

  it('组合表含关闭 / 经典 / 学术 / 宽裕四档', () => {
    expect(PAGE_CHROME_PRESETS.map((preset) => preset.key)).toEqual([
      'off',
      'classic',
      'academic',
      'wide',
    ]);
  });
});
