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
  isCjkLetter,
  isCjkPunctuation,
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

  it('省略号 …… 不参与挤压（GB/T 15834：省略号占两字位，压缩会变形）', () => {
    expect(findPunctuationRuns('……')).toEqual([]);
    expect(buildCompressionAdjustments('……')).toEqual([]);
    /* 其他收束性标点不受影响 */
    expect(buildCompressionAdjustments('」。')).toEqual([
      { offset: 1, char: '。', squeezeEm: 0.5 },
    ]);
  });
});

describe('字符分类', () => {
  it('扩展 B~F 区汉字按完整码位判定（charCodeAt 高代理永不命中的回归）', () => {
    expect(isCjkLetter('\u{20000}')).toBe(true);
    expect(isCjkLetter('\u{2B740}')).toBe(true);
    expect(isCjkPunctuation('\u{20000}')).toBe(false);
    expect(classifyChar('\u{20000}')).toBe('cjk');
    expect(needsCjkLatinGap('\u{20000}', 'a')).toBe(true);
  });

  it('General Punctuation 的中文标点：破折号 / 省略号 / 两点线 / 弯引号 / 间隔号', () => {
    for (const char of ['—', '‥', '…', '‘', '’', '“', '”', '·']) {
      expect(isCjkPunctuation(char)).toBe(true);
    }
  });

  it('叠字符号 々〆 归字母；部首 / IDS / 笔画 / 半角片假名归字母', () => {
    expect(isCjkLetter('々')).toBe(true);
    expect(isCjkLetter('〆')).toBe(true);
    expect(isCjkPunctuation('々')).toBe(false);
    expect(isCjkLetter('\u{2E80}')).toBe(true); // 部首补充
    expect(isCjkLetter('\u{2F00}')).toBe(true); // 康熙部首
    expect(isCjkLetter('\u{2FF0}')).toBe(true); // 表意文字描述符
    expect(isCjkLetter('\u{31C0}')).toBe(true); // 笔画
    expect(isCjkLetter('ｱ')).toBe(true); // 半角片假名
    expect(classifyChar('々')).toBe('cjk');
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
