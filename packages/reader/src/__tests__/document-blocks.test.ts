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
});
