/**
 * A6 结构命令测试：页眉 / 页脚 / 条件容器 / 分栏属性
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import { TextSelection, type Command } from 'prosemirror-state';
import { BookEditor } from '../editor.js';
import { buildEditorSchema } from '../default-schema.js';
import { createBookEditorPlugins } from '../plugins.js';
import {
  insertColumnBreak,
  insertCondition,
  insertPageFooter,
  insertPageHeader,
} from '../commands.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: 'A6' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章', columns: 2 },
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
      ],
    },
  ];
  return doc;
}

function createEditor(): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({ schema, document: sampleDoc(), plugins: createBookEditorPlugins(schema) });
}

function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

function cursorInto(editor: BookEditor, nodeId: string): void {
  let target = -1;
  editor.editorState.doc.descendants((node, pos) => {
    if (target < 0 && node.attrs?.id === nodeId) {
      target = pos;
      return false;
    }
    return true;
  });
  expect(target).toBeGreaterThanOrEqual(0);
  const tr = editor.editorState.tr.setSelection(
    TextSelection.create(editor.editorState.doc, target + 1),
  );
  editor.dispatch(tr);
}

describe('A6 结构命令', () => {
  it('页眉插入为 book 直接子节点且只插一次', () => {
    const editor = createEditor();
    expect(run(editor, insertPageHeader())).toBe(true);
    expect(run(editor, insertPageHeader())).toBe(true);

    const root = editor.getDocument().root.children ?? [];
    expect(root.filter((node) => node.type === NODE_TYPES.PAGE_HEADER)).toHaveLength(1);
    expect(root[0]?.type).toBe(NODE_TYPES.PAGE_HEADER);
  });

  it('页脚追加到书末且只插一次', () => {
    const editor = createEditor();
    expect(run(editor, insertPageFooter())).toBe(true);
    expect(run(editor, insertPageFooter())).toBe(true);

    const root = editor.getDocument().root.children ?? [];
    expect(root.filter((node) => node.type === NODE_TYPES.PAGE_FOOTER)).toHaveLength(1);
    expect(root[root.length - 1]?.type).toBe(NODE_TYPES.PAGE_FOOTER);
  });

  it('条件容器包裹当前块并写入 when', () => {
    const editor = createEditor();
    cursorInto(editor, 'p-1');
    expect(run(editor, insertCondition('platform=epub'))).toBe(true);

    const chapter = editor.getDocument().root.children?.[0];
    const condition = chapter?.children?.[0];
    expect(condition?.type).toBe(NODE_TYPES.CONDITION);
    expect(condition?.attrs?.when).toBe('platform=epub');
    expect(condition?.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('chapter.columns 经编辑器往返保留', () => {
    const editor = createEditor();
    const chapter = editor.getDocument().root.children?.[0];
    expect(chapter?.attrs?.columns).toBe(2);
  });

  it('分栏符写入 break(variant=column)', () => {
    const editor = createEditor();
    cursorInto(editor, 'p-1');
    expect(run(editor, insertColumnBreak())).toBe(true);

    const chapter = editor.getDocument().root.children?.[0];
    const brk = chapter?.children?.[0];
    expect(brk?.type).toBe(NODE_TYPES.BREAK);
    expect(brk?.attrs?.variant).toBe('column');
  });
});
