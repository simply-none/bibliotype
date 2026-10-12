/**
 * 数字/英文直排合并规则测试（D3 补充核心用例）
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBINE_OPTIONS,
  SEGMENT_KINDS,
  combineUprightCss,
  needsCombineUpright,
  segmentForVertical,
} from '../combine-upright.js';

describe('segmentForVertical', () => {
  it('汉字与全角标点归为 native 段', () => {
    const segments = segmentForVertical('子曰：');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: SEGMENT_KINDS.NATIVE,
      text: '子曰：',
      upright: 'as-is',
    });
  });

  it('短数字串合并为一格', () => {
    const segments = segmentForVertical('贞观2026年');
    expect(segments).toHaveLength(3);
    expect(segments[1]).toMatchObject({
      kind: SEGMENT_KINDS.DIGITS,
      text: '2026',
      upright: 'combine',
    });
  });

  it('超长数字串（超过位数上限）侧转顺排', () => {
    const segments = segmentForVertical('编号1234567890');
    expect(segments[1]).toMatchObject({
      kind: SEGMENT_KINDS.DIGITS,
      text: '1234567890',
      upright: 'sideways',
    });
  });

  it('拉丁词默认侧转', () => {
    const segments = segmentForVertical('用Web发布');
    expect(segments[1]).toMatchObject({
      kind: SEGMENT_KINDS.LATIN,
      text: 'Web',
      upright: 'sideways',
    });
  });

  it('latinStrategy=combine 时拉丁词并入字格', () => {
    const segments = segmentForVertical('用Web发布', {
      ...DEFAULT_COMBINE_OPTIONS,
      latinStrategy: 'combine',
    });
    expect(segments[1]?.upright).toBe('combine');
  });

  it('混合文本按顺序切分：汉字+数字+拉丁+空白', () => {
    const segments = segmentForVertical('共 12 items');
    expect(segments.map((s) => s.kind)).toEqual([
      SEGMENT_KINDS.NATIVE,
      SEGMENT_KINDS.SPACE,
      SEGMENT_KINDS.DIGITS,
      SEGMENT_KINDS.SPACE,
      SEGMENT_KINDS.LATIN,
    ]);
    // 拼接无损
    expect(segments.map((s) => s.text).join('')).toBe('共 12 items');
  });

  it('空文本返回空数组', () => {
    expect(segmentForVertical('')).toEqual([]);
  });
});

describe('combineUprightCss', () => {
  it('默认生成 "digits 4"', () => {
    expect(combineUprightCss()).toBe('digits 4');
  });

  it('禁用合并（maxDigits<=0）返回 undefined', () => {
    expect(combineUprightCss({ maxDigits: 0, latinStrategy: 'rotate' })).toBeUndefined();
  });

  it('latinStrategy=combine 时生成 "all"', () => {
    expect(combineUprightCss({ maxDigits: 4, latinStrategy: 'combine' })).toBe('all');
  });
});

describe('needsCombineUpright', () => {
  it('纯汉字返回 false，含数字或拉丁返回 true', () => {
    expect(needsCombineUpright('十三经注疏')).toBe(false);
    expect(needsCombineUpright('贞观元年')).toBe(false);
    expect(needsCombineUpright('贞观2年')).toBe(true);
    expect(needsCombineUpright('WEB 服务')).toBe(true);
  });
});
