/**
 * BookEditor 门面测试（载入 / 导出 / 事务 / 变更订阅）
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { BookEditor } from '../editor.js';

/** 构造样本文档：卷 > 章 > 段落 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      attrs: { title: '卷一' },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-1',
          attrs: { title: '学而第一' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰：学而时习之。' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

describe('BookEditor', () => {
  it('默认构造空文档', () => {
    const editor = new BookEditor();
    const doc = editor.getDocument();

    expect(doc.root.type).toBe(NODE_TYPES.BOOK);
    // 空内容节点规范化为省略 children 字段
    expect(doc.root.children).toBeUndefined();
    expect(doc.schemaVersion).toBe('0.1.0');
  });

  it('loadDocument → getDocument 往返一致', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());
    expect(editor.getDocument()).toEqual(sampleDoc());
  });

  it('dispatch 编辑事务后 getDocument 反映变更并触发 onChange', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());

    const changes: BookDocument[] = [];
    editor.onChange((doc) => changes.push(doc));

    const tr = editor.createTransaction();
    const paragraph = editor.bookSchema.node(
      'paragraph',
      null,
      editor.bookSchema.text('为政以德，譬如北辰。'),
    );
    tr.insert(0, paragraph);
    editor.dispatch(tr);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.root.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);

    const doc = editor.getDocument();
    const firstParagraph = doc.root.children?.[0];
    expect(firstParagraph?.children?.[0]?.text).toBe('为政以德，譬如北辰。');
  });

  it('dispatch 非文档变更事务不触发 onChange', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());

    const changes: BookDocument[] = [];
    editor.onChange((doc) => changes.push(doc));

    const tr = editor.createTransaction().setMeta('flag', true);
    editor.dispatch(tr);

    expect(changes).toHaveLength(0);
  });

  it('取消订阅后不再收到通知', () => {
    const editor = new BookEditor();
    const received: BookDocument[] = [];
    const off = editor.onChange((doc) => received.push(doc));
    off();

    const tr = editor.createTransaction();
    tr.insert(0, editor.bookSchema.node('paragraph', null, editor.bookSchema.text('x')));
    editor.dispatch(tr);

    expect(received).toHaveLength(0);
  });

  it('loadDocument 触发变更广播（快照为新文档）', () => {
    const editor = new BookEditor();
    const received: BookDocument[] = [];
    editor.onChange((doc) => received.push(doc));

    editor.loadDocument(sampleDoc());

    expect(received).toHaveLength(1);
    expect(received[0]?.metadata.title).toBe('论语');
  });
});
