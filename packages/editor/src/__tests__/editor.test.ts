/**
 * BookEditor 门面测试（载入 / 导出 / 事务 / 变更订阅）
 */
import { describe, expect, it } from 'vitest';
import {
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookMetadata,
} from '@bibliotype/core';
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

describe('BookEditor 元数据', () => {
  /** 载入含全量元数据的文档 */
  function metaEditor(): BookEditor {
    const doc = sampleDoc();
    doc.metadata = {
      title: '论语',
      subtitle: '全集',
      language: 'zh-Hans',
      createdAt: '2020-01-01T00:00:00.000Z',
      contributors: [{ name: '何晏', dynasty: '魏', role: '集解' }],
    } satisfies BookMetadata;
    const editor = new BookEditor();
    editor.loadDocument(doc);
    return editor;
  }

  it('getMetadata 返回载入时的元数据快照', () => {
    const editor = metaEditor();
    expect(editor.getMetadata().title).toBe('论语');
    expect(editor.getMetadata().subtitle).toBe('全集');
  });

  it('updateMetadata 合并字段、刷新 updatedAt 并广播变更', () => {
    const editor = metaEditor();
    const received: BookDocument[] = [];
    editor.onChange((doc) => received.push(doc));

    editor.updateMetadata({ title: '论语集解', volumeCount: 20 });

    const meta = editor.getMetadata();
    expect(meta.title).toBe('论语集解');
    expect(meta.volumeCount).toBe(20);
    expect(meta.subtitle).toBe('全集'); // 未提及字段保留
    expect(typeof meta.updatedAt).toBe('string'); // 发生变更时刷新时间戳
    expect(received).toHaveLength(1);
    expect(received[0]?.metadata.title).toBe('论语集解');
  });

  it('updateMetadata：undefined 清空可选字段，空 title 不改，createdAt 不变', () => {
    const editor = metaEditor();
    editor.updateMetadata({ title: '', subtitle: undefined });

    const meta = editor.getMetadata();
    expect(meta.title).toBe('论语'); // 空串 title 被忽略
    expect(meta.subtitle).toBeUndefined(); // undefined 清空
    expect(meta.createdAt).toBe('2020-01-01T00:00:00.000Z'); // 创建时间不受补丁影响
  });

  it('updateMetadata：与当前一致的补丁不广播', () => {
    const editor = metaEditor();
    const received: BookDocument[] = [];
    editor.onChange((doc) => received.push(doc));

    editor.updateMetadata({ title: '论语', subtitle: '全集', language: 'zh-Hans' });

    expect(received).toHaveLength(0);
  });
});

describe('BookEditor 脏标记', () => {
  /** 追加一段文本触发文档变更 */
  function editOnce(editor: BookEditor): void {
    const tr = editor.createTransaction();
    tr.insert(0, editor.bookSchema.node('paragraph', null, editor.bookSchema.text('新增')));
    editor.dispatch(tr);
  }

  it('载入即视为已保存基线（不置脏）', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());
    expect(editor.isDirty).toBe(false);
  });

  it('文档事务置脏，markSaved 后归净', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());
    editOnce(editor);
    expect(editor.isDirty).toBe(true);
    editor.markSaved();
    expect(editor.isDirty).toBe(false);
  });

  it('元数据变更置脏', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());
    editor.updateMetadata({ subtitle: '新增副标题' });
    expect(editor.isDirty).toBe(true);
  });

  it('非文档变更事务不置脏', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());
    editor.dispatch(editor.createTransaction().setMeta('flag', true));
    expect(editor.isDirty).toBe(false);
  });

  it('重新载入文档重置脏基准（丢弃历史）', () => {
    const editor = new BookEditor();
    editor.loadDocument(sampleDoc());
    editOnce(editor);
    expect(editor.isDirty).toBe(true);
    editor.loadDocument(sampleDoc());
    expect(editor.isDirty).toBe(false);
  });
});
