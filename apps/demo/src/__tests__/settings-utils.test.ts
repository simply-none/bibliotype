/**
 * 设置分区纯函数测试（阶段 3 拆分自 SettingsPanel 的可测部分）
 *
 * 覆盖四条口径：
 * 1. `mergeTokens` 以 DEFAULT_THEME 起底，空串 / 非字符串覆写被忽略（色板不出现空块）；
 * 2. 令牌数值提取只取字面量数字，无数字回空串（number 输入回显依赖此约定）；
 * 3. 页边距解析与序列化往返一致，并保留 CSS 四值简写的补全规则；
 * 4. 页底溢出预设判定与面板回显一致（自定义 px 与行高倍数分别归位）。
 */
import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, DEFAULT_THEME, FONT_SIZE_TOKENS } from '@bibliotype/core';
import {
  SLACK_PRESET_MAP,
  extractTokenNum,
  mergeTokens,
  parseMarginBox,
  resolveColorValue,
  resolveSlackPreset,
  stringifyMarginBox,
} from '../components/settings/settings-utils.js';

describe('mergeTokens', () => {
  it('基线起底 + 非空覆写，空串与非字符串一律忽略', () => {
    const patch: Record<string, unknown> = {
      [COLOR_TOKENS.TEXT]: '#112233',
      [COLOR_TOKENS.BACKGROUND]: '',
      [FONT_SIZE_TOKENS.BODY]: 20,
    };
    const merged = mergeTokens(patch as Readonly<Record<string, string | undefined>>);
    expect(merged[COLOR_TOKENS.TEXT]).toBe('#112233');
    expect(merged[COLOR_TOKENS.BACKGROUND]).toBe(DEFAULT_THEME[COLOR_TOKENS.BACKGROUND]);
    expect(merged[FONT_SIZE_TOKENS.BODY]).toBe(DEFAULT_THEME[FONT_SIZE_TOKENS.BODY]);
  });

  it('未传基线时等于默认主题', () => {
    expect(mergeTokens(undefined)).toEqual({ ...DEFAULT_THEME });
  });
});

describe('令牌数值与颜色', () => {
  it('提取数值字面量（含小数与负号），无数字回空串', () => {
    expect(extractTokenNum('18px')).toBe('18');
    expect(extractTokenNum('1.75em')).toBe('1.75');
    expect(extractTokenNum('-0.02em')).toBe('-0.02');
    expect(extractTokenNum('normal')).toBe('');
    expect(extractTokenNum(undefined)).toBe('');
  });

  it('取色器只认 6 位十六进制，其余回退黑', () => {
    expect(resolveColorValue('#ABcdef')).toBe('#ABcdef');
    expect(resolveColorValue('rgb(1, 2, 3)')).toBe('#000000');
    expect(resolveColorValue('#abc')).toBe('#000000');
    expect(resolveColorValue(undefined)).toBe('#000000');
  });
});

describe('页边距', () => {
  it('四段声明解析与序列化往返一致', () => {
    const box = parseMarginBox('40px 50px 60px 70px');
    expect(box).toEqual({ top: 40, right: 50, bottom: 60, left: 70 });
    expect(stringifyMarginBox(box)).toBe('40px 50px 60px 70px');
  });

  it('两段简写按「下 = 上 / 左 = 右」补全，缺省回落 48 / 56', () => {
    expect(parseMarginBox('60px 80px')).toEqual({ top: 60, right: 80, bottom: 60, left: 80 });
    expect(parseMarginBox(undefined)).toEqual({ top: 48, right: 56, bottom: 48, left: 56 });
  });
});

describe('页底溢出预设', () => {
  it('行高倍数与关闭态归位，自由像素为自定义', () => {
    expect(resolveSlackPreset(SLACK_PRESET_MAP['off'])).toBe('off');
    expect(resolveSlackPreset(SLACK_PRESET_MAP['half'])).toBe('half');
    expect(resolveSlackPreset(SLACK_PRESET_MAP['full'])).toBe('full');
    expect(resolveSlackPreset({ px: 0 })).toBe('off');
    expect(resolveSlackPreset({ px: 24 })).toBe('custom');
    expect(resolveSlackPreset({ lines: 2 })).toBe('custom');
    expect(resolveSlackPreset(undefined)).toBe('custom');
  });
});
