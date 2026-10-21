/**
 * 字体回退链覆盖分析测试：去重顺序、逐级命中、缺字与私用区标记。
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeGlyphCoverage,
  formatCodePoint,
  isPrivateUseCodePoint,
  type GlyphProbe,
} from '../font-coverage.js';

/** 构造「哪些字符由哪些族覆盖」的假探测（表值为可覆盖字符集合） */
function probeOf(table: Record<string, string>): GlyphProbe {
  return (char, family) => (table[family] ?? '').includes(char);
}

describe('formatCodePoint / isPrivateUseCodePoint', () => {
  it('码位补零到四位', () => {
    expect(formatCodePoint(0x4e00)).toBe('U+4E00');
    expect(formatCodePoint(0x41)).toBe('U+0041');
    expect(formatCodePoint(0x20000)).toBe('U+20000');
  });

  it('识别三段私用区', () => {
    expect(isPrivateUseCodePoint(0xe000)).toBe(true);
    expect(isPrivateUseCodePoint(0xf8ff)).toBe(true);
    expect(isPrivateUseCodePoint(0xf0000)).toBe(true);
    expect(isPrivateUseCodePoint(0x4e00)).toBe(false);
    expect(isPrivateUseCodePoint(0x41)).toBe(false);
  });
});

describe('analyzeGlyphCoverage', () => {
  it('按回退链顺序取首个命中族，并按首次出现去重', () => {
    const report = analyzeGlyphCoverage(
      '子子曰',
      ['Songti', 'Fallback'],
      probeOf({ Songti: '子', Fallback: '曰' }),
    );

    expect(report.total).toBe(2);
    expect(report.entries.map((entry) => entry.char)).toEqual(['子', '曰']);
    expect(report.entries.map((entry) => entry.family)).toEqual(['Songti', 'Fallback']);
    expect(report.missingCount).toBe(0);
  });

  it('全链未命中记为缺字并给码位', () => {
    const report = analyzeGlyphCoverage('A𠀋', ['Songti'], probeOf({ Songti: 'A' }));

    expect(report.missingCount).toBe(1);
    const missing = report.missing[0];
    expect(missing?.char).toBe('𠀋');
    expect(missing?.code).toBe('U+2000B');
    expect(missing?.family).toBeUndefined();
    expect(missing?.privateUse).toBe(false);
  });

  it('私用区字符即使命中也会被标记（换字体必错字）', () => {
    const report = analyzeGlyphCoverage('\uE001', ['Custom'], probeOf({ Custom: '\uE001' }));
    expect(report.entries[0]?.privateUse).toBe(true);
    expect(report.entries[0]?.missing).toBe(false);
  });

  it('空白与控制符不参与分析', () => {
    const report = analyzeGlyphCoverage('  \n\t字\u0000', ['Songti'], probeOf({ Songti: '字' }));
    expect(report.entries.map((entry) => entry.char)).toEqual(['字']);
  });

  it('空文本返回空报告且保留回退链', () => {
    const report = analyzeGlyphCoverage('', ['Songti', 'Kaiti'], () => true);
    expect(report.entries).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.total).toBe(0);
    expect(report.families).toEqual(['Songti', 'Kaiti']);
  });
});
