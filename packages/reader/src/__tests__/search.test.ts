/**
 * 搜索能力测试：字面 / 正则 / 大小写 / 范围 / 命中区间 / 纯函数内核。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import { Reader } from '../reader.js';
import {
  buildMatchExcerpt,
  buildSearchPattern,
  collectSubtreeNodes,
  escapeRegExp,
  findMatchRanges,
} from '../search.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      id: 'chap-1',
      type: 'chapter',
      attrs: { title: '学而第一' },
      children: [
        {
          id: 'p-1',
          type: 'paragraph',
          children: [{ type: 'text', text: '子曰：学而时习之。子曰：不亦说乎。' }],
        },
        { id: 'p-2', type: 'paragraph', children: [{ type: 'text', text: 'ABC 甲乙丙' }] },
      ],
    },
    {
      id: 'chap-2',
      type: 'chapter',
      attrs: { title: '为政第二' },
      children: [
        { id: 'p-3', type: 'paragraph', children: [{ type: 'text', text: '为政以德，子曰。' }] },
      ],
    },
  ];
  return doc;
}

function createReader(): Reader {
  const reader = new Reader({ pageMainSize: 10_000 });
  reader.loadDocument(sampleDoc());
  return reader;
}

describe('搜索（Reader）', () => {
  it('缺省字面匹配、大小写敏感', () => {
    const reader = createReader();
    expect(reader.search('子曰')).toHaveLength(2);
    expect(reader.search('abc')).toHaveLength(0);
    expect(reader.search('ABC')).toHaveLength(1);
  });

  it('caseSensitive:false 忽略大小写', () => {
    const reader = createReader();
    expect(reader.search('abc', { caseSensitive: false })).toHaveLength(1);
  });

  it('regex:true 按正则匹配', () => {
    const reader = createReader();
    const results = reader.search('甲[乙丙]丙', { regex: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.matchCount).toBe(1);
  });

  it('非法正则抛 RangeError', () => {
    const reader = createReader();
    expect(() => reader.search('([', { regex: true })).toThrow(RangeError);
  });

  it('ranges:true 返回命中区间', () => {
    const reader = createReader();
    const [hit] = reader.search('子曰', { ranges: true });
    expect(hit?.ranges).toEqual([
      { from: 0, to: 2 },
      { from: 9, to: 11 },
    ]);
    expect(hit?.matchCount).toBe(2);
  });

  it('缺省不返回 ranges（保持既有结果形状）', () => {
    const reader = createReader();
    expect(reader.search('子曰')[0]).not.toHaveProperty('ranges');
  });

  it('scope 限定到结构节点子树', () => {
    const reader = createReader();
    const scoped = reader.search('子曰', { scope: 'chap-2' });
    expect(scoped.map((item) => item.nodeId)).toEqual(['p-3']);
    expect(reader.search('子曰', { scope: 'ghost' })).toEqual([]);
  });

  it('结果上限与上下文半径生效', () => {
    const reader = createReader();
    expect(reader.search('子曰', { limit: 1 })).toHaveLength(1);
    const [hit] = reader.search('时习', { contextLength: 2 });
    expect(hit?.excerpt).toBe('…学而时习之。…');
  });

  it('空查询返回空结果且不抛错', () => {
    const reader = createReader();
    expect(reader.search('   ')).toEqual([]);
  });
});

describe('搜索内核（纯函数）', () => {
  it('escapeRegExp 转义元字符', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });

  it('buildSearchPattern 支持两种模式', () => {
    const literal = buildSearchPattern('a.b');
    expect(literal.test('a.b')).toBe(true);
    expect(buildSearchPattern('a.b', { regex: true }).test('axb')).toBe(true);
    expect(buildSearchPattern('ABC', { caseSensitive: false }).test('abc')).toBe(true);
  });

  it('findMatchRanges 统计全部命中但截断区间', () => {
    const result = findMatchRanges('甲甲甲甲', buildSearchPattern('甲'), 2);
    expect(result.count).toBe(4);
    expect(result.ranges).toHaveLength(2);
    expect(result.ranges[0]).toEqual({ from: 0, to: 1 });
  });

  it('零宽正则不死循环', () => {
    const result = findMatchRanges('abc', buildSearchPattern('x*', { regex: true }), 10);
    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThanOrEqual(4);
  });

  it('buildMatchExcerpt 首尾越界标记省略号', () => {
    expect(buildMatchExcerpt('九十甲乙丙', 2, 4, 1)).toBe('…十甲乙丙');
    expect(buildMatchExcerpt('甲乙', 0, 2, 5)).toBe('甲乙');
  });

  it('collectSubtreeNodes 按身份收集子树，缺失返回 undefined', () => {
    const doc = sampleDoc();
    const nodes = collectSubtreeNodes(doc.root, 'chap-1');
    expect(nodes?.size).toBeGreaterThan(0);
    expect(nodes?.has(doc.root.children![1]!)).toBe(false);
    expect(collectSubtreeNodes(doc.root, 'ghost')).toBeUndefined();
  });
});
