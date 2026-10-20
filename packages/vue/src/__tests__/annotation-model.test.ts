/**
 * 标注侧栏视图模型测试（纯函数）
 */
import { describe, expect, it } from 'vitest';
import { createBlockAnchor, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import { createBookmark, createComment, createNote } from '@bibliotype/annotation';
import { buildAnnotationSidebarModel } from '../annotation-model.js';

const FIXED = '2026-10-20T00:00:00.000Z';
const clock = (): string => FIXED;
const author = { id: 'u1', name: '读者' };

function buildDocument(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      id: 'ch1',
      type: 'chapter',
      attrs: { title: '学而第一' },
      children: [
        { id: 'p1', type: 'paragraph', children: [{ type: 'text', text: '学而时习之' }] },
        { id: 'p2', type: 'paragraph', children: [{ type: 'text', text: '有朋自远方来' }] },
      ],
    },
    {
      id: 'ch2',
      type: 'chapter',
      attrs: { title: '为政第二' },
      children: [{ id: 'p3', type: 'paragraph', children: [{ type: 'text', text: '为政以德' }] }],
    },
  ];
  return doc;
}

describe('buildAnnotationSidebarModel', () => {
  it('按章节分组并保留标注种类', () => {
    const doc = buildDocument();
    const annotations = [
      createBookmark(createBlockAnchor('p1'), { body: '重点', clock, author }),
      createNote(createBlockAnchor('p2'), '旁注', { clock, author }),
      createComment(createBlockAnchor('p3'), '存疑', author, { clock }),
    ];

    const model = buildAnnotationSidebarModel(doc.root, annotations);
    expect(model.map((chapter) => chapter.title)).toEqual(['学而第一', '为政第二']);
    expect(model[0]?.items.map((item) => item.kind)).toEqual(['bookmark', 'note']);
    expect(model[0]?.items[0]?.label).toBe('重点');
    expect(model[1]?.items[0]?.label).toBe('存疑');
  });

  it('无标注返回空数组', () => {
    const doc = buildDocument();
    expect(buildAnnotationSidebarModel(doc.root, [])).toEqual([]);
  });

  it('锚点失效的标注不进入模型', () => {
    const doc = buildDocument();
    const annotations = [createNote(createBlockAnchor('missing'), '孤儿', { clock, author })];
    expect(buildAnnotationSidebarModel(doc.root, annotations)).toEqual([]);
  });
});
