/**
 * 竖排文字细节测试（B7）
 */
import { describe, expect, it } from 'vitest';
import {
  VERTICAL_DIGIT_STYLES,
  VERTICAL_PUNCTUATION_FORMS,
  needsVerticalTextTransform,
  toFullwidthDigits,
  toKanjiDigits,
  toVerticalPunctuation,
  transformVerticalText,
  verticalPunctuationOf,
} from '../vertical-text.js';

describe('竖排标点 / 引号', () => {
  it('句读、括号、引号换成 Unicode 竖排形态', () => {
    expect(toVerticalPunctuation('。、，：；！？（）〔〕…')).toBe('︒︑︐︓︔︕︖︵︶︹︺︙');
    expect(toVerticalPunctuation('「引」『双』【标】《书》〈篇〉')).toBe(
      '﹁引﹂﹃双﹄﹇标﹈︽书︾︿篇﹀',
    );
  });

  it('非标点原样保留，单字符查询与映射表同源', () => {
    expect(toVerticalPunctuation('子曰学而')).toBe('子曰学而');
    expect(verticalPunctuationOf('。')).toBe('︒');
    expect(verticalPunctuationOf('子')).toBeUndefined();
    expect(Object.keys(VERTICAL_PUNCTUATION_FORMS)).toHaveLength(22);
  });

  it('转换逐字符一一对应：长度不变、代理对完整、可重复调用', () => {
    const source = '子曰：「𠀀」1850…';
    const once = toVerticalPunctuation(source);
    expect(once).toHaveLength(source.length);
    expect(once).toContain('𠀀');
    expect(toVerticalPunctuation(once)).toBe(once);
  });
});

describe('竖排数字形态', () => {
  it('汉字数字直排：ASCII 与全角数字同口径', () => {
    expect(toKanjiDigits('1850')).toBe('一八五〇');
    expect(toKanjiDigits('１２３')).toBe('一二三');
    expect(toKanjiDigits('第3卷 2.5')).toBe('第三卷 二.五');
  });

  it('全角数字：仅 ASCII 数字转全角', () => {
    expect(toFullwidthDigits('1850')).toBe('１８５０');
    expect(toFullwidthDigits('１８50')).toBe('１８５０');
  });
});

describe('transformVerticalText', () => {
  it('缺省只替换标点，数字保持原样', () => {
    expect(transformVerticalText('子曰：「1850年。」')).toBe('子曰︓﹁1850年︒﹂');
  });

  it('digits=kanji / fullwidth 按需分组数字', () => {
    expect(
      transformVerticalText('1850年', {
        punctuation: false,
        digits: VERTICAL_DIGIT_STYLES.KANJI,
      }),
    ).toBe('一八五〇年');
    expect(
      transformVerticalText('1850年', {
        punctuation: false,
        digits: VERTICAL_DIGIT_STYLES.FULLWIDTH,
      }),
    ).toBe('１８５０年');
  });

  it('punctuation=false 保留横排标点；全关时原样返回', () => {
    expect(transformVerticalText('子曰：「」', { punctuation: false })).toBe('子曰：「」');
    expect(transformVerticalText('子曰：「」', { punctuation: false, digits: 'none' })).toBe(
      '子曰：「」',
    );
  });
});

describe('needsVerticalTextTransform', () => {
  it('按选项判断是否需要转换', () => {
    expect(needsVerticalTextTransform('子曰：')).toBe(true);
    expect(needsVerticalTextTransform('子曰')).toBe(false);
    expect(needsVerticalTextTransform('1850')).toBe(false);
    expect(needsVerticalTextTransform('1850', { digits: 'kanji' })).toBe(true);
  });
});
