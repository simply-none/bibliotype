/**
 * C10 命名样式命令：批量套用、幂等、清除格式
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import { TextSelection, type Command } from 'prosemirror-state';
import { BookEditor } from '../editor.js';
import { buildEditorSchema } from '../default-schema.js';
import { createBookEditorPlugins } from '../plugins.js';
import { applyNamedStyle, clearFormat, getBlockStyleId } from '../commands.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: 'C10' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '第一段' }] },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '第二段' }] },
        { type: NODE_TYPES.PARAGRAPH, id: 'p-3', children: [{ type: 'text', text: '第三段' }] },
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

function positionOf(editor: BookEditor, id: string): number {
  let found = -1;
  editor.editorState.doc.descendants((node, pos) => {
    if (found < 0 && node.attrs?.['id'] === id) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function selectRange(editor: BookEditor, fromId: string, toId: string): void {
  const from = positionOf(editor, fromId);
  const to = positionOf(editor, toId);
  const tr = editor.editorState.tr.setSelection(
    TextSelection.create(editor.editorState.doc, from + 1, to + 1),
  );
  editor.dispatch(tr);
}

function findNode(nodes: readonly BookNode[], id: string): BookNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children ?? [], id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function styleIdOf(editor: BookEditor, id: string): unknown {
  return findNode(editor.getDocument().root.children ?? [], id)?.attrs?.['styleId'];
}

describe('applyNamedStyle', () => {
  it('批量作用于选区内所有可样式块', () => {
    const editor = createEditor();
    selectRange(editor, 'p-1', 'p-2');
    expect(run(editor, applyNamedStyle('ns-quote'))).toBe(true);

    expect(styleIdOf(editor, 'p-1')).toBe('ns-quote');
    expect(styleIdOf(editor, 'p-2')).toBe('ns-quote');
    expect(styleIdOf(editor, 'p-3')).toBeUndefined();
  });

  it('全部目标已是该样式时返回 false（不产生空事务）', () => {
    const editor = createEditor();
    selectRange(editor, 'p-1', 'p-1');
    expect(run(editor, applyNamedStyle('ns-quote'))).toBe(true);
    const revision = editor.editorState.doc;
    expect(run(editor, applyNamedStyle('ns-quote'))).toBe(false);
    expect(editor.editorState.doc).toBe(revision);
  });

  it('空选区只作用于光标所在块', () => {
    const editor = createEditor();
    const pos = positionOf(editor, 'p-2');
    editor.dispatch(
      editor.editorState.tr.setSelection(
        TextSelection.create(editor.editorState.doc, pos + 1),
      ),
    );
    expect(run(editor, applyNamedStyle('ns-only'))).toBe(true);
    expect(styleIdOf(editor, 'p-2')).toBe('ns-only');
    expect(styleIdOf(editor, 'p-1')).toBeUndefined();
    expect(getBlockStyleId(editor.editorState)).toBe('ns-only');
  });

  it('空 styleId 返回 false', () => {
    const editor = createEditor();
    selectRange(editor, 'p-1', 'p-1');
    expect(run(editor, applyNamedStyle('   '))).toBe(false);
  });
});

describe('clearFormat', () => {
  it('清除 marks 与命名样式，保留节点 id 与结构', () => {
    const editor = createEditor();
    selectRange(editor, 'p-1', 'p-2');
    run(editor, applyNamedStyle('ns-quote'));

    const strong = editor.editorState.schema.marks['strong'];
    expect(strong).toBeDefined();
    const from = positionOf(editor, 'p-1') + 1;
    editor.dispatch(
      editor.editorState.tr.addMark(from, from + 2, strong!.create()),
    );

    expect(run(editor, clearFormat())).toBe(true);
    expect(styleIdOf(editor, 'p-1')).toBeUndefined();
    expect(styleIdOf(editor, 'p-2')).toBeUndefined();
    expect(findNode(editor.getDocument().root.children ?? [], 'p-1')?.id).toBe('p-1');

    let marked = false;
    editor.editorState.doc.descendants((node) => {
      if (node.marks.length > 0) marked = true;
      return true;
    });
    expect(marked).toBe(false);
  });

  it('空选区返回 false', () => {
    const editor = createEditor();
    expect(run(editor, clearFormat())).toBe(false);
  });
});
