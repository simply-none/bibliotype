/**
 * 页码格式化测试
 */
import { describe, expect, it } from 'vitest';
import {
  formatPageNumber,
  toChineseNumeral,
  toRomanNumeral,
} from '../page-numbering.js';

describe('toChineseNumeral', () => {
  it('个位与十位边界（一/十/十一/二十/二十一）', () => {
    expect(toChineseNumeral(1)).toBe('一');
    expect(toChineseNumeral(9)).toBe('九');
    expect(toChineseNumeral(10)).toBe('十');
    expect(toChineseNumeral(11)).toBe('十一');
    expect(toChineseNumeral(19)).toBe('十九');
    expect(toChineseNumeral(20)).toBe('二十');
    expect(toChineseNumeral(21)).toBe('二十一');
  });

  it('百位含零的补零规则（一百零五/一百一十/一百二十三）', () => {
    expect(toChineseNumeral(100)).toBe('一百');
    expect(toChineseNumeral(105)).toBe('一百零五');
    expect(toChineseNumeral(110)).toBe('一百一十');
    expect(toChineseNumeral(123)).toBe('一百二十三');
    expect(toChineseNumeral(999)).toBe('九百九十九');
  });

  it('千页级大部头（一千/一千零八/一千一百零四/九千九百九十九）', () => {
    expect(toChineseNumeral(1000)).toBe('一千');
    expect(toChineseNumeral(1008)).toBe('一千零八');
    expect(toChineseNumeral(1056)).toBe('一千零五十六');
    expect(toChineseNumeral(1050)).toBe('一千零五十');
    expect(toChineseNumeral(1104)).toBe('一千一百零四');
    expect(toChineseNumeral(1106)).toBe('一千一百零六');
    expect(toChineseNumeral(9999)).toBe('九千九百九十九');
  });

  it('超出范围抛出 RangeError', () => {
    expect(() => toChineseNumeral(10000)).toThrow(RangeError);
    expect(() => toChineseNumeral(-1)).toThrow(RangeError);
    expect(() => toChineseNumeral(1.5)).toThrow(RangeError);
  });
});

describe('toRomanNumeral', () => {
  it('基础映射与减法组合', () => {
    expect(toRomanNumeral(1)).toBe('i');
    expect(toRomanNumeral(4)).toBe('iv');
    expect(toRomanNumeral(9)).toBe('ix');
    expect(toRomanNumeral(14)).toBe('xiv');
    expect(toRomanNumeral(40)).toBe('xl');
    expect(toRomanNumeral(1987)).toBe('mcmlxxxvii');
  });

  it('大写选项', () => {
    expect(toRomanNumeral(42, true)).toBe('XLII');
  });

  it('超出范围抛出 RangeError', () => {
    expect(() => toRomanNumeral(0)).toThrow(RangeError);
    expect(() => toRomanNumeral(4000)).toThrow(RangeError);
  });
});

describe('formatPageNumber', () => {
  it('按样式分发（decimal/chinese/roman）', () => {
    expect(formatPageNumber(42, 'decimal')).toBe('42');
    expect(formatPageNumber(42, 'chinese')).toBe('四十二');
    expect(formatPageNumber(42, 'roman')).toBe('xlii');
  });
});
