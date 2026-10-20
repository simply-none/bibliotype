/**
 * 禁则与断行测试：行首行尾禁则、拉丁词不断、代理对不截断、贪心切行。
 */
import { describe, expect, it } from 'vitest';
import {
  KINSOKU_PROFILES,
  findBreakOpportunities,
  isForbiddenAtLineEnd,
  isForbiddenAtLineStart,
  resolveLineBreak,
  resolveKinsokuProfile,
  splitLines,
} from '../index.js';

describe('禁则判定', () => {
  it('收束性标点不可居行首', () => {
    expect(isForbiddenAtLineStart('。')).toBe(true);
    expect(isForbiddenAtLineStart('」')).toBe(true);
    expect(isForbiddenAtLineStart('，')).toBe(true);
    expect(isForbiddenAtLineStart('学')).toBe(false);
  });

  it('开启性标点不可居行尾', () => {
    expect(isForbiddenAtLineEnd('「')).toBe(true);
    expect(isForbiddenAtLineEnd('（')).toBe(true);
    expect(isForbiddenAtLineEnd('学')).toBe(false);
  });

  it('日文配置额外禁小假名与长音', () => {
    expect(isForbiddenAtLineStart('ゃ', 'zh-Hans')).toBe(false);
    expect(isForbiddenAtLineStart('ゃ', 'ja')).toBe(true);
    expect(KINSOKU_PROFILES.ja.name).toBe('ja');
  });

  it('未知配置名回退缺省配置', () => {
    const profile = resolveKinsokuProfile('unknown' as 'zh-Hans');
    expect(profile.name).toBe('zh-Hans');
  });
});

describe('findBreakOpportunities', () => {
  it('不在标点前断、不在前括号后断', () => {
    expect(findBreakOpportunities('「你好」')).toEqual([2]);
    // 冒号之后可以断（下一行以「开头是合法的），但「之后不能断
    expect(findBreakOpportunities('他说：「好。」')).toEqual([1, 3]);
  });

  it('汉字之间逐字可断', () => {
    expect(findBreakOpportunities('学而时习之')).toEqual([1, 2, 3, 4]);
  });

  it('不拆拉丁单词与数字', () => {
    expect(findBreakOpportunities('中文abc中文')).toEqual([1, 2, 5, 6]);
    expect(findBreakOpportunities('第3章')).toEqual([1, 2]);
  });

  it('breakLatinWords 打开后允许拆词', () => {
    expect(findBreakOpportunities('ab', { breakLatinWords: true })).toEqual([1]);
  });

  it('不切断代理对', () => {
    expect(findBreakOpportunities('😀好')).toEqual([2]);
  });

  it('perCharacter 关闭后只在空白后断行', () => {
    const breaks = findBreakOpportunities('中文 排版', { perCharacter: false });
    expect(breaks).toEqual([3]);
  });

  it('额外禁则字符生效', () => {
    expect(findBreakOpportunities('甲乙丙', { extraForbiddenStart: '乙' })).not.toContain(1);
  });
});

describe('resolveLineBreak / splitLines', () => {
  it('优先向前找合法断点', () => {
    expect(resolveLineBreak('「你好」世界', 3)).toBe(2);
  });

  it('行内可容全文时返回长度', () => {
    expect(resolveLineBreak('短句', 10)).toBe(2);
  });

  it('无合法断点时退回容量上限（不死循环）', () => {
    expect(resolveLineBreak('abcdef', 2)).toBe(2);
    expect(resolveLineBreak('abcdef', 0)).toBe(0);
  });

  it('from 偏移生效', () => {
    expect(resolveLineBreak('一二三四五六', 3, { from: 3 })).toBe(6);
  });

  it('切行结果拼回原文', () => {
    const text = '学而时习之，不亦说乎';
    const lines = splitLines(text, 4);
    expect(lines.join('')).toBe(text);
    expect(lines).toEqual(['学而时习', '之，不亦', '说乎']);
  });

  it('容量非法抛错', () => {
    expect(() => splitLines('x', 0)).toThrow(RangeError);
  });
});
