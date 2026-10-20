/**
 * 文本转换测试：逐字替换、词组保护、命中记录、冲突检测、反向表与外部适配。
 */
import { describe, expect, it } from 'vitest';
import {
  TRADITIONAL_TO_SIMPLIFIED,
  convertText,
  createOpenCcConverter,
  createTableConverter,
  findAmbiguousTargets,
  reverseTable,
  summarizeHits,
} from '../index.js';
import type { TextConversionTable } from '../index.js';

const table: TextConversionTable = {
  id: 'test',
  name: '测试表',
  entries: [
    { from: '為', to: '为' },
    { from: '學', to: '学' },
  ],
  phrases: [{ from: '為學', to: '为学' }],
};

describe('内置繁简表', () => {
  it('常用繁简字转换', () => {
    expect(convertText('學而時習之，不亦說乎')).toBe('学而时习之，不亦说乎');
  });

  it('词组优先于单字，保护规则不改写', () => {
    expect(convertText('皇后')).toBe('皇后');
    expect(convertText('後來')).toBe('后来');
    expect(convertText('頭髮')).toBe('头发');
  });

  it('非中文字符原样保留', () => {
    expect(convertText('abc 123，。')).toBe('abc 123，。');
  });

  it('代理对整体处理不拆断', () => {
    expect(convertText('😀為')).toBe('😀为');
  });
});

describe('表驱动转换器', () => {
  it('convertWithHits 记录偏移与命中', () => {
    const result = createTableConverter(table).convertWithHits('為學');
    expect(result.text).toBe('为学');
    expect(result.hits).toEqual([
      { offset: 0, from: '為學', to: '为学' },
    ]);
  });

  it('词组未命中时退回单字规则', () => {
    const result = createTableConverter(table).convertWithHits('為人');
    expect(result.text).toBe('为人');
    expect(result.hits[0]?.from).toBe('為');
    expect(result.hits[0]?.offset).toBe(0);
  });

  it('冲突规则与空 id 抛错', () => {
    expect(() =>
      createTableConverter({ id: 'x', name: 'x', entries: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] }),
    ).toThrow(RangeError);
    expect(() => createTableConverter({ id: '', name: 'x', entries: [] })).toThrow(RangeError);
    expect(() => createTableConverter({ id: 'x', name: 'x', entries: [{ from: '', to: 'c' }] })).toThrow(
      RangeError,
    );
  });

  it('外部转换器适配', () => {
    const converter = createOpenCcConverter((text) => text.toUpperCase(), { id: 'oc' });
    expect(converter.id).toBe('oc');
    expect(converter.convert('ab')).toBe('AB');
    expect(converter.convertWithHits('ab')).toEqual({ text: 'AB', hits: [] });
  });
});

describe('反向表', () => {
  it('简 → 繁转换可用', () => {
    const reversed = reverseTable(TRADITIONAL_TO_SIMPLIFIED);
    expect(createTableConverter(reversed).convert('学而时习之')).toBe('學而時習之');
  });

  it('一对多歧义字在单字层被跳过（宁可不转）', () => {
    const reversed = reverseTable(TRADITIONAL_TO_SIMPLIFIED);
    const converter = createTableConverter(reversed);
    expect(converter.convert('后')).toBe('后');
    expect(converter.convert('发')).toBe('发');
    // 词组层无歧义时仍可还原
    expect(converter.convert('后来')).toBe('後來');
    const targets = findAmbiguousTargets(TRADITIONAL_TO_SIMPLIFIED);
    expect(targets).toContain('发');
    expect(targets).toContain('后');
    expect([...targets].sort()).toEqual(targets);
  });

  it('可指定新表标识', () => {
    const reversed = reverseTable(table, { id: 'rev', name: '反向' });
    expect(reversed.id).toBe('rev');
    expect(reversed.name).toBe('反向');
    expect(reverseTable(table).id).toBe('test-reversed');
  });
});

describe('命中统计', () => {
  it('按源文本聚合', () => {
    const result = createTableConverter(TRADITIONAL_TO_SIMPLIFIED).convertWithHits('為學為');
    expect(result.text).toBe('为学为');
    const summary = summarizeHits(result.hits);
    expect(summary.total).toBe(3);
    expect(summary.byFrom['為']).toBe(2);
  });
});
