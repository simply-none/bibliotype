/**
 * K4 索引采集与附录：同词多页、连续页合并、排序、回跳链接
 */
import { describe, expect, it } from 'vitest';
import {
  MARK_TYPES,
  NODE_TYPES,
  buildIndexAppendix,
  buildIndexEntries,
  collectIndexTerms,
  createEmptyDocument,
  formatIndexRanges,
  type BookDocument,
  type BookNode,
} from '../index.js';

function termText(text: string, term: string): BookNode {
  return {
    type: NODE_TYPES.TEXT,
    text,
    marks: [{ type: MARK_TYPES.INDEX_TERM, attrs: { term } }],
  };
}

function sampleDocument(): BookDocument {
  const doc = createEmptyDocument({ title: '索引' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [termText('朱熹', '朱熹'), { type: NODE_TYPES.TEXT, text: '曰。' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [termText('礼', '礼')],
        },
      ],
    },
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-2',
      attrs: { title: '第二章' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-3',
          children: [termText('朱熹', '朱熹')],
        },
      ],
    },
  ];
  return doc;
}

describe('collectIndexTerms', () => {
  it('按文档顺序收集词条与所在块 id', () => {
    const occurrences = collectIndexTerms(sampleDocument());
    expect(occurrences.map((item) => item.term)).toEqual(['朱熹', '礼', '朱熹']);
    expect(occurrences.map((item) => item.blockId)).toEqual(['p-1', 'p-2', 'p-3']);
    expect(occurrences[0]?.sortKey).toBe('朱熹');
  });

  it('忽略空 term 与无 id 的块', () => {
    const doc = createEmptyDocument({ title: '空' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [termText('无 id', '无 id')],
      },
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'p-9',
        children: [termText('空', '   ')],
      },
    ];
    expect(collectIndexTerms(doc)).toEqual([]);
  });
});

describe('buildIndexEntries', () => {
  it('同词条合并页码并把连续页压成区间', () => {
    const entries = buildIndexEntries(sampleDocument(), { 'p-1': 3, 'p-2': 4, 'p-3': 7 });
    const zhu = entries.find((entry) => entry.term === '朱熹');
    expect(zhu?.pages).toEqual([3, 7]);
    expect(zhu?.ranges).toEqual([
      [3, 3],
      [7, 7],
    ]);
    expect(zhu?.anchorId).toBe('p-1');

    const li = entries.find((entry) => entry.term === '礼');
    expect(li?.ranges).toEqual([[4, 4]]);
  });

  it('连续页码合并为一个区间', () => {
    const entries = buildIndexEntries(sampleDocument(), { 'p-1': 3, 'p-3': 4 });
    const zhu = entries.find((entry) => entry.term === '朱熹');
    expect(zhu?.ranges).toEqual([[3, 4]]);
    expect(formatIndexRanges(zhu?.ranges ?? [])).toBe('3–4');
  });

  it('支持自定义排序（sortKey 兜底）', () => {
    const entries = buildIndexEntries(sampleDocument(), {}, {
      compare: (left, right) => (left.term < right.term ? -1 : left.term > right.term ? 1 : 0),
    });
    expect(entries.map((entry) => entry.term)).toEqual(['朱熹', '礼']);
  });
});

describe('buildIndexAppendix', () => {
  it('生成附录节点、标题与页码回跳链接', () => {
    const entries = buildIndexEntries(sampleDocument(), { 'p-1': 3, 'p-3': 5 });
    const appendix = buildIndexAppendix(entries, {
      hrefFor: (blockId) => `text/sec-1.xhtml#${blockId}`,
    });
    expect(appendix.type).toBe(NODE_TYPES.APPENDIX);
    expect(appendix.id).toBe('index-appendix');
    expect(appendix.attrs?.['title']).toBe('索引');
    expect(appendix.children?.[0]?.type).toBe(NODE_TYPES.HEADING);

    const zhu = entries.find((item) => item.term === '朱熹');
    const entry = appendix.children?.find((child) =>
      (child.children ?? []).some((item) => item.text === '朱熹'),
    );
    const link = entry?.children?.find((child) => child.marks?.[0]?.type === MARK_TYPES.LINK);
    expect(link?.marks?.[0]?.attrs?.['href']).toBe(`text/sec-1.xhtml#${zhu?.anchorId ?? ''}`);
    expect(link?.text).toBe('3, 5');
  });

  it('EPUB 模式（无页码）链接落在词条上', () => {
    const entries = buildIndexEntries(sampleDocument());
    const appendix = buildIndexAppendix(entries, { showPageNumbers: false });
    const first = appendix.children?.[1]?.children?.[0];
    expect(first?.text).toBe(entries[0]?.term);
    expect(first?.marks?.[0]?.attrs?.['href']).toBe(`#${entries[0]?.anchorId}`);
  });
});
