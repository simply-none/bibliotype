/**
 * 注释页索引测试：定位表构建、首次出现优先、上下条循环、Reader 端到端。
 */
import { describe, expect, it } from 'vitest';
import {
  MARK_TYPES,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
} from '@bibliotype/core';
import type { MeasurableBlock, PageItem } from '@bibliotype/layout';
import {
  buildNoteAnchors,
  findNoteAnchor,
  neighborNoteAnchor,
  type NoteIndexPage,
} from '../note-index.js';
import { Reader } from '../reader.js';
import type { BlockSizeEstimator } from '../document-blocks.js';

/** 构造注条目（只填索引关心的 `block.id`） */
function noteItem(id: string): PageItem {
  const block: MeasurableBlock = { id, mainSize: 40 };
  return { block, fromLine: 0, lineCount: 0, mainSize: 40 };
}

describe('buildNoteAnchors', () => {
  it('按页与注区顺序建立定位表', () => {
    const pages: NoteIndexPage[] = [
      { notes: [noteItem('fn-1'), noteItem('fn-2')] },
      {},
      { notes: [noteItem('fn-3')] },
    ];
    expect(buildNoteAnchors(pages)).toEqual([
      { noteId: 'fn-1', pageIndex: 0 },
      { noteId: 'fn-2', pageIndex: 0 },
      { noteId: 'fn-3', pageIndex: 2 },
    ]);
  });

  it('同一注跨页续排时只保留首次出现的页', () => {
    const pages: NoteIndexPage[] = [
      { notes: [noteItem('fn-1')] },
      { notes: [noteItem('fn-1'), noteItem('fn-2')] },
    ];
    expect(buildNoteAnchors(pages)).toEqual([
      { noteId: 'fn-1', pageIndex: 0 },
      { noteId: 'fn-2', pageIndex: 1 },
    ]);
  });

  it('跳过无 id 的注条目，空文档返回空表', () => {
    expect(buildNoteAnchors([])).toEqual([]);
    expect(buildNoteAnchors([{ notes: [noteItem('')] }])).toEqual([]);
  });
});

describe('findNoteAnchor / neighborNoteAnchor', () => {
  const anchors = buildNoteAnchors([
    { notes: [noteItem('fn-1')] },
    { notes: [noteItem('fn-2'), noteItem('fn-3')] },
  ]);

  it('按 id 取定位条目', () => {
    expect(findNoteAnchor(anchors, 'fn-3')).toEqual({ noteId: 'fn-3', pageIndex: 1 });
    expect(findNoteAnchor(anchors, 'missing')).toBeUndefined();
  });

  it('下一条循环：末条回到首条', () => {
    expect(neighborNoteAnchor(anchors, 'fn-2', 1)?.noteId).toBe('fn-3');
    expect(neighborNoteAnchor(anchors, 'fn-3', 1)?.noteId).toBe('fn-1');
  });

  it('上一条循环：首条回到末条', () => {
    expect(neighborNoteAnchor(anchors, 'fn-1', -1)?.noteId).toBe('fn-3');
    expect(neighborNoteAnchor(anchors, 'fn-2', -1)?.noteId).toBe('fn-1');
  });

  it('当前 id 缺失时按方向取首条 / 末条', () => {
    expect(neighborNoteAnchor(anchors, undefined, 1)?.noteId).toBe('fn-1');
    expect(neighborNoteAnchor(anchors, undefined, -1)?.noteId).toBe('fn-3');
    expect(neighborNoteAnchor(anchors, 'unknown', 1)?.noteId).toBe('fn-1');
  });

  it('无注释时返回 undefined', () => {
    expect(neighborNoteAnchor([], 'fn-1', 1)).toBeUndefined();
  });
});

/** 构造：两条独注，尺寸固定；注区上限压低使两注分页 */
function footnoteDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '注' });
  doc.root.children = [
    { type: NODE_TYPES.FOOTNOTE, id: 'fn-1', children: [{ type: 'text', text: '注一' }] },
    { type: NODE_TYPES.FOOTNOTE, id: 'fn-2', children: [{ type: 'text', text: '注二' }] },
  ];
  return doc;
}

const estimator: BlockSizeEstimator = (node) =>
  node.id === 'fn-1' || node.id === 'fn-2' ? 120 : 100;

/** 构造：正文段含一条注引用 + 浮注 + 后段（注被挤到下一页） */
function noteRefDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '注引用' });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [
        { type: 'text', text: '子曰' },
        {
          type: 'text',
          text: '1',
          marks: [{ type: MARK_TYPES.NOTE_REF, attrs: { targetId: 'fn-1', refId: 'ref-1' } }],
        },
        {
          type: 'text',
          text: '2',
          marks: [{ type: MARK_TYPES.NOTE_REF, attrs: { targetId: 'fn-2', refId: 'ref-2' } }],
        },
      ],
    },
    { type: NODE_TYPES.FOOTNOTE, id: 'fn-1', children: [{ type: 'text', text: '注一' }] },
    { type: NODE_TYPES.FOOTNOTE, id: 'fn-2', children: [{ type: 'text', text: '注二' }] },
    { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '为政' }] },
  ];
  return doc;
}

describe('Reader 注释定位', () => {
  it('getNoteAnchors / getPageOfNote 与页底注区同源', () => {
    const reader = new Reader({
      pageMainSize: 600,
      bottomSlack: 0,
      footnoteFloat: true,
      noteMaxRatio: 0.2,
      estimator,
    });
    reader.loadDocument(footnoteDoc());

    expect(reader.getNoteAnchors()).toEqual([
      { noteId: 'fn-1', pageIndex: 0 },
      { noteId: 'fn-2', pageIndex: 1 },
    ]);
    expect(reader.getPageOfNote('fn-1')).toBe(0);
    expect(reader.getPageOfNote('fn-2')).toBe(1);
    expect(reader.getPageOfNote('missing')).toBeUndefined();
  });

  it('未开启浮注时注释不进页底注区，定位表为空', () => {
    const reader = new Reader({ pageMainSize: 600, bottomSlack: 0, estimator });
    reader.loadDocument(footnoteDoc());

    expect(reader.getNoteAnchors()).toEqual([]);
    expect(reader.getPageOfNote('fn-1')).toBeUndefined();
  });

  it('getPageOfNoteRef 按注引用锚点反查正文原句所在页', () => {
    const reader = new Reader({
      pageMainSize: 100,
      bottomSlack: 0,
      footnoteFloat: true,
      noteMaxRatio: 0.2,
      estimator,
    });
    reader.loadDocument(noteRefDoc());

    // 注区上限 20：第二注溢出到第 2 页，与正文引用不同页
    expect(reader.getPageOfNote('fn-2')).toBe(1);
    expect(reader.getPageOfNoteRef('ref-2')).toBe(0);
    expect(reader.getPageOfNoteRef('missing')).toBeUndefined();
  });
});
