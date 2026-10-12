/**
 * 块 id → 节点解析测试（findNodeById）
 *
 * 覆盖：节点 id 直查、树路径解析（含文本叶子过滤）、未命中，
 * 以及与 extractBlocks 全量块 id 的还原一致性。
 */
import { describe, expect, it } from 'vitest';
import {
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import { extractBlocks } from '../document-blocks.js';
import { findNodeById } from '../find-node.js';

/** 构造样本：书 > 章（标题 + 段） + 章（段） + 散段 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语', language: 'zh-Hant' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而' },
      children: [
        {
          type: NODE_TYPES.HEADING,
          id: 'h-1',
          attrs: { level: 2 },
          children: [{ type: 'text', text: '学而第一' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: 'text', text: '子曰：学而时习之。' }],
        },
      ],
    },
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-2',
      attrs: { title: '为政' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [{ type: 'text', text: '为政以德。' }],
        },
      ],
    },
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-3',
      children: [{ type: 'text', text: '散段。' }],
    },
  ];
  return doc;
}

describe('findNodeById', () => {
  it('节点 id 直接命中', () => {
    const doc = sampleDoc();
    expect(findNodeById(doc.root, 'p-1')?.id).toBe('p-1');
    expect(findNodeById(doc.root, 'chap-2')?.attrs?.title).toBe('为政');
  });

  it('树路径解析（索引基于过滤文本叶子后的元素子节点）', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [
        { type: 'text', text: '前言散字' },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'c-1',
          children: [
            { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: 'x' }] },
          ],
        },
      ],
    };
    /* 文本叶子被过滤：'/0' 指向章而非文本 */
    expect(findNodeById(root, '/0')?.id).toBe('c-1');
    /* 无 id 段落按路径解析 */
    expect(findNodeById(root, '/0/0')?.type).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('未命中返回 undefined', () => {
    const doc = sampleDoc();
    expect(findNodeById(doc.root, 'nope')).toBeUndefined();
    expect(findNodeById(doc.root, '/9')).toBeUndefined();
    expect(findNodeById(doc.root, '/x')).toBeUndefined();
  });

  it('extractBlocks 全部块 id 可还原为节点（含无 id 的路径块）', () => {
    const doc = sampleDoc();
    doc.root.children?.push({
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text: '匿名段' }],
    });
    for (const block of extractBlocks(doc)) {
      expect(findNodeById(doc.root, block.id), `块 ${block.id} 未还原`).toBeDefined();
    }
  });
});
