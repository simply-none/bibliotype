/**
 * K4 索引词命令：选区标注、同词条取消、空选区拒绝
 */
import { MARK_TYPES, NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import { TextSelection, type Command } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { BookEditor } from '../editor.js';
import { buildEditorSchema } from '../default-schema.js';
import { createBookEditorPlugins } from '../plugins.js';
import { toggleIndexTerm } from '../commands.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: 'K4' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: 'text', text: '朱熹与论语' }],
        },
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

function firstParagraphPos(editor: BookEditor): number {
  let found = -1;
  editor.editorState.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === NODE_TYPES.PARAGRAPH) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function selectText(editor: BookEditor, offset: number, length: number): void {
  const start = firstParagraphPos(editor) + 1 + offset;
  const tr = editor.editorState.tr.setSelection(
    TextSelection.create(editor.editorState.doc, start, start + length),
  );
  editor.dispatch(tr);
}

function marksOfFirstText(editor: BookEditor): BookNode['marks'] {
  const paragraph = editor.getDocument().root.children?.[0]?.children?.[0];
  return paragraph?.children?.[0]?.marks;
}

describe('toggleIndexTerm', () => {
  it('以选中文本为缺省 term 写入标记', () => {
    const editor = createEditor();
    selectText(editor, 0, 2);
    expect(run(editor, toggleIndexTerm())).toBe(true);

    const marks = marksOfFirstText(editor);
    expect(marks?.[0]?.type).toBe(MARK_TYPES.INDEX_TERM);
    expect(marks?.[0]?.attrs?.['term']).toBe('朱熹');
  });

  it('同词条再次执行时取消标记', () => {
    const editor = createEditor();
    selectText(editor, 0, 2);
    run(editor, toggleIndexTerm());
    selectText(editor, 0, 2);
    expect(run(editor, toggleIndexTerm())).toBe(true);

    expect(marksOfFirstText(editor)).toBeUndefined();
  });

  it('显式 term 覆盖选中文本', () => {
    const editor = createEditor();
    selectText(editor, 0, 2);
    expect(run(editor, toggleIndexTerm('朱子'))).toBe(true);
    expect(marksOfFirstText(editor)?.[0]?.attrs?.['term']).toBe('朱子');
  });

  it('空选区返回 false', () => {
    const editor = createEditor();
    const tr = editor.editorState.tr.setSelection(
      TextSelection.create(editor.editorState.doc, firstParagraphPos(editor) + 1),
    );
    editor.dispatch(tr);
    expect(run(editor, toggleIndexTerm())).toBe(false);
  });
});
