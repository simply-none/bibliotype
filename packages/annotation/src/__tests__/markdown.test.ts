/**
 * 标注 Markdown 导出测试
 */
import { describe, expect, it } from 'vitest';
import { createBlockAnchor, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import { annotationsToMarkdown, createBookmark, createComment, createNote } from '../index.js';

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
  ];
  return doc;
}

function findNode(root: BookNode, id: string): BookNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return undefined;
}

describe('annotationsToMarkdown', () => {
  it('按章节分组输出书签与评论', () => {
    const doc = buildDocument();
    const p2 = findNode(doc.root, 'p2')!;
    const annotations = [
      createBookmark(createBlockAnchor('p1'), { body: '重点', clock, author }),
      createComment(createBlockAnchor('p2'), '此处存疑', author, { clock }),
      createNote(createBlockAnchor('p2'), '旁注一条', { clock, author }),
    ];

    const md = annotationsToMarkdown(doc.root, annotations);
    expect(md).toContain('# 标注导出');
    expect(md).toContain('## 学而第一');
    expect(md).toContain('- 书签：重点');
    expect(md).toContain('- 评论：此处存疑');
    expect(md).toContain('- 笔记：旁注一条');
  });

  it('无标注返回空串', () => {
    const doc = buildDocument();
    expect(annotationsToMarkdown(doc.root, [])).toBe('');
  });

  it('转义 Markdown 特殊字符', () => {
    const doc = buildDocument();
    const annotations = [
      createNote(createBlockAnchor('p1'), 'a * b # c', { clock, author }),
    ];
    const md = annotationsToMarkdown(doc.root, annotations);
    expect(md).toContain('a \\* b \\# c');
  });
});
