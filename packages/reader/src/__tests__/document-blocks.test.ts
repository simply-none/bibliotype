/**
 * 文档块提取测试
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import {
  DEFAULT_MEASURE_CONTEXT,
  defaultEstimator,
  extractBlocks,
} from '../document-blocks.js';

/** 构造：书 > 卷 > 章（标题 + 两段） + 章（一段） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '样本' });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-1',
          children: [
            {
              type: NODE_TYPES.HEADING,
              id: 'h-1',
              children: [{ type: 'text', text: '学而第一' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-2',
              children: [{ type: 'text', text: '有朋自远方来' }],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-3',
              children: [{ type: 'text', text: '为政以德' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

describe('extractBlocks', () => {
  it('展开为叶块序列（结构容器不入块）', () => {
    const blocks = extractBlocks(sampleDoc());
    expect(blocks.map((b) => b.id)).toEqual(['h-1', 'p-1', 'p-2', 'p-3']);
  });

  it('章首块标记 breakBefore（章的第一个叶块）', () => {
    const blocks = extractBlocks(sampleDoc());
    const h1 = blocks.find((b) => b.id === 'h-1');
    const p3 = blocks.find((b) => b.id === 'p-3');
    expect(h1?.breakBefore).toBe(true);
    expect(p3?.breakBefore).toBe(true);
    expect(blocks.find((b) => b.id === 'p-1')?.breakBefore).toBeUndefined();
  });

  it('标题块标记 keepWithNext', () => {
    const blocks = extractBlocks(sampleDoc());
    expect(blocks.find((b) => b.id === 'h-1')?.keepWithNext).toBe(true);
    expect(blocks.find((b) => b.id === 'p-1')?.keepWithNext).toBeUndefined();
  });

  it('无 id 节点使用稳定的路径 id', () => {
    const doc = createEmptyDocument({ title: '无 id' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: '第一段' }],
      },
      {
        type: NODE_TYPES.PARAGRAPH,
        children: [{ type: 'text', text: '第二段' }],
      },
    ];
    const first = extractBlocks(doc).map((b) => b.id);
    const second = extractBlocks(doc).map((b) => b.id);
    expect(first).toEqual(second);
    expect(first).toEqual(['/0', '/1']);
  });

  it('默认估算器按文本长度折算尺寸', () => {
    const node = {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: '甲'.repeat(53) }],
    };
    // 53 字符 / 每行 26 → 3 行 → 3×30 + 12
    const size = defaultEstimator(node, DEFAULT_MEASURE_CONTEXT);
    expect(size).toBe(3 * 30 + 12);
  });

  it('自定义估算器与上下文可覆盖', () => {
    const blocks = extractBlocks(sampleDoc(), {
      estimator: () => 7,
      context: { charsPerLine: 1 },
    });
    expect(blocks.every((b) => b.mainSize === 7)).toBe(true);
  });

  it('含行内载体（空元素/纯文本载体）的块不拆开', () => {
    const doc = createEmptyDocument({ title: '行内载体' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'p-inline',
        children: [
          { type: 'text', text: '子曰学而时习之' },
          // 校勘符号：无子元素的空元素载体
          { type: 'collation-mark', id: 'mark-1', attrs: { symbol: '○' } },
          // 避讳字：仅含文本子节点的行内载体
          {
            type: 'taboo-char',
            id: 'char-1',
            children: [{ type: 'text', text: '丘' }],
          },
        ],
      },
    ];
    const blocks = extractBlocks(doc);
    expect(blocks.map((b) => b.id)).toEqual(['p-inline']);
    // 度量按整体文本（含载体文本）折算
    expect(blocks[0]?.mainSize).toBeGreaterThan(0);
  });

  it('版式文本容器规范化后整体成块（编辑保存形态：容器 + 段落）', () => {
    const doc = createEmptyDocument({ title: '注文规范化' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          {
            type: 'double-note',
            id: 'note-1',
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [{ type: 'text', text: '朱子曰：学之为言效也。' }],
              },
            ],
          },
          {
            type: NODE_TYPES.FOOTNOTE,
            id: 'fn-1',
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [{ type: 'text', text: '注① 愠，怒也。' }],
              },
            ],
          },
          {
            type: 'collation-note',
            id: 'colla-1',
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [
                  { type: 'text', text: '校勘记：' },
                  { type: 'collation-mark', attrs: { symbol: '○' } },
                ],
              },
            ],
          },
        ],
      },
    ];

    const blocks = extractBlocks(doc);
    /* 容器整体成块：稳定 id 保留，内部无 id 段落不单独成块 */
    expect(blocks.map((b) => b.id)).toEqual(['note-1', 'fn-1', 'colla-1']);
    /* 度量按容器全文折算 */
    expect(blocks[0]?.mainSize).toBeGreaterThan(0);
  });

  it('结构页容器（封面/书名页/版权页/封底）首块 mark breakBefore', () => {
    const doc = createEmptyDocument({ title: '结构页' });
    const pageChild = (type: string, id: string) => ({
      type,
      id,
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: `${id}-p`, children: [{ type: 'text', text: '内容' }] },
      ],
    });
    doc.root.children = [
      pageChild(NODE_TYPES.COVER, 'cover'),
      pageChild(NODE_TYPES.TITLE_PAGE, 'title'),
      pageChild(NODE_TYPES.COPYRIGHT_PAGE, 'copyright'),
      pageChild(NODE_TYPES.BACK_COVER, 'back'),
      pageChild(NODE_TYPES.PREFACE, 'preface'),
      pageChild(NODE_TYPES.APPENDIX, 'appendix'),
      pageChild(NODE_TYPES.POSTSCRIPT, 'postscript'),
      pageChild(NODE_TYPES.TOC, 'toc'),
    ];
    const blocks = extractBlocks(doc);
    for (const id of [
      'cover-p',
      'title-p',
      'copyright-p',
      'back-p',
      'preface-p',
      'appendix-p',
      'postscript-p',
      'toc-p',
    ]) {
      expect(blocks.find((b) => b.id === id)?.breakBefore).toBe(true);
    }
  });
});
