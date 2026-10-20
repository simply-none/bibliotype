/**
 * 文档统计与词表检查：字数口径、阅读时长、结构分布、注释口径、锚点命中。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '../ir/node-types.js';
import { createEmptyDocument } from '../ir/document.js';
import type { BookDocument } from '../ir/document.js';
import {
  checkWordList,
  countDocumentStats,
  DEFAULT_READING_CHARS_PER_MINUTE,
} from '../ir/document-stats.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而第一' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: NODE_TYPES.TEXT, text: '子曰：学而时习之，不亦说乎？' }],
        },
        {
          type: NODE_TYPES.HEADING,
          id: 'h-1',
          attrs: { level: 2 },
          children: [{ type: NODE_TYPES.TEXT, text: '有朋自远方来' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [
            { type: NODE_TYPES.TEXT, text: '学而篇 ' },
            { type: NODE_TYPES.TEXT, text: 'AI 时代' },
          ],
        },
        {
          type: NODE_TYPES.FOOTNOTE,
          id: 'fn-1',
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'fn-p-1',
              children: [{ type: NODE_TYPES.TEXT, text: '注文四个字。' }],
            },
          ],
        },
      ],
    },
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-2',
      attrs: { title: '为政第二' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-3',
          children: [{ type: NODE_TYPES.TEXT, text: '为政以德。' }],
        },
      ],
    },
  ];
  return doc;
}

describe('countDocumentStats', () => {
  it('默认口径：正文去空白去标点，注释单独统计', () => {
    const stats = countDocumentStats(sampleDoc());
    // 正文：子曰学而时习之不亦说乎(11) + 有朋自远方来(6) + 学而篇(3) + AI(2) + 时代(2) + 为政以德(4)
    expect(stats.characters).toBe(28);
    // 注释：注文四个字(5) + 句号(1，标点不计) → 5
    expect(stats.noteCharacters).toBe(5);
    expect(stats.totalCharacters).toBe(33);
    expect(stats.notes).toEqual({ footnote: 1, endnote: 0, marginNote: 0 });
  });

  it('countPunctuation 计入标点', () => {
    const stats = countDocumentStats(sampleDoc(), { countPunctuation: true });
    // 正文标点：：，？。共 4 个
    expect(stats.characters).toBe(32);
    expect(stats.noteCharacters).toBe(6);
  });

  it('注释口径：include 计入正文 / exclude 忽略', () => {
    const included = countDocumentStats(sampleDoc(), { notes: 'include' });
    expect(included.characters).toBe(33);
    expect(included.totalCharacters).toBe(33);

    const excluded = countDocumentStats(sampleDoc(), { notes: 'exclude' });
    expect(excluded.characters).toBe(28);
    expect(excluded.noteCharacters).toBe(0);
    expect(excluded.totalCharacters).toBe(28);
  });

  it('词数与阅读时长：CJK 逐字 + 拉丁连续串计 1 词', () => {
    const stats = countDocumentStats(sampleDoc());
    // 词数含注释全文（11 + 6 + 3+1+2 + 5 + 4，拉丁 AI 计 1）
    expect(stats.words).toBe(32);
    expect(stats.readingMinutes).toBe(
      Math.ceil(28 / DEFAULT_READING_CHARS_PER_MINUTE),
    );
    const fast = countDocumentStats(sampleDoc(), { charsPerMinute: 6 });
    expect(fast.readingMinutes).toBe(5);
  });

  it('结构分布：按先序给出卷 / 章 / 节字数', () => {
    const stats = countDocumentStats(sampleDoc());
    expect(stats.structures.map((item) => item.title)).toEqual(['学而第一', '为政第二']);
    expect(stats.structures[0]).toMatchObject({
      type: NODE_TYPES.CHAPTER,
      nodeId: 'chap-1',
      level: 2,
      characters: 24,
    });
    expect(stats.structures[1]?.characters).toBe(4);
  });

  it('块计数不含空根与空结构容器', () => {
    const empty = createEmptyDocument({ title: '空书' });
    expect(countDocumentStats(empty).blocks).toBe(0);
    expect(countDocumentStats(empty).readingMinutes).toBe(0);

    const stats = countDocumentStats(sampleDoc());
    // p-1 / h-1 / p-2 / fn-p-1 / p-3
    expect(stats.blocks).toBe(5);
  });
});

describe('checkWordList', () => {
  it('命中返回块内偏移与文本锚点', () => {
    const matches = checkWordList(sampleDoc(), [
      { term: '学而', kind: 'term' },
      { term: 'AI', suggestion: '人工智能', kind: 'typo' },
    ]);
    const first = matches[0];
    expect(first).toMatchObject({ nodeId: 'p-1', term: '学而', offset: 3, kind: 'term' });
    expect(first?.anchor).toEqual({ type: 'text', nodeId: 'p-1', offset: 3, length: 2 });
    expect(first?.excerpt).toContain('学而时习之');

    const latin = matches.find((match) => match.term === 'AI');
    expect(latin).toMatchObject({ nodeId: 'p-2', suggestion: '人工智能' });
  });

  it('大小写与注释开关', () => {
    expect(checkWordList(sampleDoc(), [{ term: 'ai' }])).toHaveLength(1);
    expect(
      checkWordList(sampleDoc(), [{ term: 'ai' }], { caseSensitive: true }),
    ).toHaveLength(0);
    expect(checkWordList(sampleDoc(), [{ term: '注文' }])).toHaveLength(1);
    expect(
      checkWordList(sampleDoc(), [{ term: '注文' }], { notes: false }),
    ).toHaveLength(0);
  });

  it('同一块内多次命中全部返回；空词表返回空数组', () => {
    const doc = createEmptyDocument({ title: '重复' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'p-1',
        children: [{ type: NODE_TYPES.TEXT, text: '甲乙甲乙甲乙' }],
      },
    ];
    const matches = checkWordList(doc, [{ term: '甲乙' }]);
    expect(matches.map((match) => match.offset)).toEqual([0, 2, 4]);
    expect(checkWordList(doc, [])).toEqual([]);
    expect(checkWordList(doc, [{ term: '' }])).toEqual([]);
  });
});
