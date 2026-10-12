/**
 * IR ⇄ Y.Doc 映射测试（往返保真，D6）
 */
import { describe, expect, it } from 'vitest';
import {
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
} from '@bibliotype/core';
import * as Y from 'yjs';
import { readDocument, writeDocument } from '../doc-mapper.js';

/** 构造一个含批注、标记、稳定 id 的样本文档 */
function sampleDocument(): BookDocument {
  const doc = createEmptyDocument({
    title: '论语注疏',
    language: 'zh-Hant',
    identifiers: [{ scheme: 'isbn', value: '978-7-101-00000-0' }],
  });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      attrs: { label: '卷一', order: 1 },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-1',
          attrs: { title: '学而第一' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'para-1',
              children: [
                { type: 'text', text: '子曰：' },
                {
                  type: 'text',
                  text: '学而时习之',
                  marks: [{ type: 'proper-name' }],
                },
                { type: 'text', text: '，不亦说乎？见' },
                {
                  type: 'text',
                  text: '第 2 版',
                  marks: [{ type: 'book-title' }],
                },
              ],
            },
            {
              type: NODE_TYPES.FOOTNOTE,
              id: 'note-1',
              children: [{ type: 'text', text: '说，音悦。' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

describe('writeDocument / readDocument', () => {
  it('往返保真：metadata / 树结构 / id / attrs / marks', () => {
    const ydoc = new Y.Doc();
    const source = sampleDocument();
    writeDocument(ydoc, source);

    const restored = readDocument(ydoc);
    expect(restored).toEqual(source);
  });

  it('schemaVersion 写入映射元信息并可读回', () => {
    const ydoc = new Y.Doc();
    const source = sampleDocument();
    writeDocument(ydoc, source);

    const restored = readDocument(ydoc);
    expect(restored.schemaVersion).toBe(source.schemaVersion);
  });

  it('全量写入为覆盖语义：二次写入不残留旧节点', () => {
    const ydoc = new Y.Doc();
    writeDocument(ydoc, sampleDocument());

    const slim = createEmptyDocument({ title: '新书' });
    slim.root.children = [
      { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text: '正文' }] },
    ];
    writeDocument(ydoc, slim);

    const restored = readDocument(ydoc);
    expect(restored.metadata.title).toBe('新书');
    expect(restored.root.children).toHaveLength(1);
    expect(restored.root.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('空 Y.Doc 读出最小文档（title 为空串）', () => {
    const ydoc = new Y.Doc();
    const restored = readDocument(ydoc);
    expect(restored.metadata.title).toBe('');
    expect(restored.root.type).toBe(NODE_TYPES.BOOK);
    expect(restored.root.children).toEqual([]);
  });

  it('写入使用独立事务来源，便于观察者区分', () => {
    const ydoc = new Y.Doc();
    const origins: unknown[] = [];
    ydoc.on('afterTransaction', (tr) => origins.push(tr.origin));

    writeDocument(ydoc, sampleDocument());
    expect(origins).toContain('bibliotype:doc-mapper');
  });

  it('同结构写入两个 Y.Doc 后合并结果稳定', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const source = sampleDocument();
    writeDocument(a, source);
    writeDocument(b, source);

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const restored = readDocument(b);
    expect(restored.metadata.title).toBe(source.metadata.title);
    expect(restored.root.children).toHaveLength(1);
  });
});
