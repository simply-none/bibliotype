/**
 * 标点挤压 / 混排间距 / CSS 声明测试。
 */
import { describe, expect, it } from 'vitest';
import {
  buildCjkTypographyCss,
  buildCompressionAdjustments,
  buildMixedSpacingSegments,
  classifyChar,
  cjkTypographyDeclarations,
  countMixedGaps,
  findPunctuationRuns,
  needsCjkLatinGap,
  totalSqueezeEm,
} from '../index.js';

describe('标点挤压', () => {
  it('识别连续标点段', () => {
    const runs = findPunctuationRuns('他说。」好');
    expect(runs).toEqual([{ start: 2, end: 4, text: '。」' }]);
  });

  it('段内首字保持全角，其余挤压', () => {
    const adjustments = buildCompressionAdjustments('。」');
    expect(adjustments).toEqual([{ offset: 1, char: '」', squeezeEm: 0.5 }]);
    expect(totalSqueezeEm(adjustments)).toBe(0.5);
  });

  it('单标点与普通文本不产生调整', () => {
    expect(buildCompressionAdjustments('你好。')).toEqual([]);
    expect(buildCompressionAdjustments('你好')).toEqual([]);
  });

  it('可配置挤压量与字符集', () => {
    const adjustments = buildCompressionAdjustments('，，', { squeezeEm: 0.25 });
    expect(adjustments[0]?.squeezeEm).toBe(0.25);
    expect(buildCompressionAdjustments('，，', { squeezeEm: 0 })).toEqual([]);
    expect(buildCompressionAdjustments('ab', { squeezeChars: 'ab' })).toEqual([
      { offset: 1, char: 'b', squeezeEm: 0.5 },
    ]);
  });
});

describe('中西文混排', () => {
  it('字符分类', () => {
    expect(classifyChar('中')).toBe('cjk');
    expect(classifyChar('a')).toBe('latin');
    expect(classifyChar('7')).toBe('latin');
    expect(classifyChar('，')).toBe('other');
    expect(classifyChar(' ')).toBe('other');
  });

  it('汉字与拉丁相邻需要间距，同类别不需要', () => {
    expect(needsCjkLatinGap('文', 'a')).toBe(true);
    expect(needsCjkLatinGap('a', '文')).toBe(true);
    expect(needsCjkLatinGap('文', '字')).toBe(false);
    expect(needsCjkLatinGap('a', 'b')).toBe(false);
    expect(needsCjkLatinGap('文', '，')).toBe(false);
  });

  it('分段拼接回原文，间隙落在类别切换处', () => {
    const segments = buildMixedSpacingSegments('中文abc中文');
    expect(segments.map((segment) => segment.text)).toEqual(['中文', 'abc', '中文']);
    expect(segments.map((segment) => segment.gapBeforeEm)).toEqual([0, 0.25, 0.25]);
    expect(segments.map((segment) => segment.text).join('')).toBe('中文abc中文');
  });

  it('标点与空白不产生间隙', () => {
    const segments = buildMixedSpacingSegments('第 3 章');
    expect(segments.every((segment) => segment.gapBeforeEm === 0)).toBe(true);
  });

  it('可配置间距量并统计间隙数量', () => {
    expect(buildMixedSpacingSegments('甲a', { gapEm: 0.5 })[1]?.gapBeforeEm).toBe(0.5);
    expect(countMixedGaps('中文abc中文')).toBe(2);
    expect(countMixedGaps('中文')).toBe(0);
  });
});

describe('CSS 声明', () => {
  it('缺省给出行尾禁则相关声明', () => {
    const css = buildCjkTypographyCss();
    expect(css['line-break']).toBe('strict');
    expect(css['word-break']).toBe('normal');
    expect(css['overflow-wrap']).toBe('break-word');
  });

  it('日文配置缺省 line-break 为 normal', () => {
    expect(buildCjkTypographyCss({ profile: 'ja' })['line-break']).toBe('normal');
    expect(buildCjkTypographyCss({ lineBreak: 'loose' })['line-break']).toBe('loose');
  });

  it('可选属性按开关输出', () => {
    const css = buildCjkTypographyCss({
      punctuationCompression: true,
      mixedSpacing: true,
      hangingPunctuation: true,
    });
    expect(css['text-spacing-trim']).toBe('space-first');
    expect(css['text-autospace']).toBe('normal');
    expect(css['hanging-punctuation']).toBe('first last');
  });

  it('序列化为声明串', () => {
    expect(cjkTypographyDeclarations({})).toBe(
      'line-break: strict; word-break: normal; overflow-wrap: break-word;',
    );
  });
});
