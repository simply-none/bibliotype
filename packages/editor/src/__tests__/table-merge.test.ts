/**
 * 表格合并 / 拆分命令测试（C4）
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type Attrs, type BookDocument, type BookNode } from '@bibliotype/core';
import { TextSelection, type Command } from 'prosemirror-state';
import { mergeCells, splitCell } from '../table-merge.js';
import { BookEditor } from '../editor.js';
import { createBookEditorPlugins } from '../plugins.js';
import { buildEditorSchema } from '../default-schema.js';

function cell(id: string, text: string, attrs?: Attrs): BookNode {
  return {
    type: NODE_TYPES.TABLE_CELL,
    id,
    ...(attrs !== undefined ? { attrs } : {}),
    children: [{ type: NODE_TYPES.PARAGRAPH, id: `${id}-p`, children: [{ type: 'text', text }] }],
  };
}

/** 3 行 3 列普通表格 */
function gridDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '合并拆分' });
  const rows = ['r1', 'r2', 'r3'].map((rid, r) =>
    ({
      type: NODE_TYPES.TABLE_ROW,
      id: rid,
      children: ['a', 'b', 'c'].map((col) => cell(`${rid}-${col}`, `${r}-${col}`)),
    }) as BookNode,
  );
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [{ type: NODE_TYPES.TABLE, id: 't-1', children: rows }],
    },
  ];
  return doc;
}

/** 首行表头 + 第二行首格跨两行，用于跨表头冲突用例 */
function headerDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '跨表头' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'ch-1',
      attrs: { title: '第一章' },
      children: [
        {
          type: NODE_TYPES.TABLE,
          id: 't-1',
          children: [
            { type: NODE_TYPES.TABLE_ROW, id: 'r1', attrs: { header: true }, children: [cell('r1-a', 'H1'), cell('r1-b', 'H2')] },
            { type: NODE_TYPES.TABLE_ROW, id: 'r2', children: [cell('r2-a', 'B1', { rowspan: 2 }), cell('r2-b', 'B2')] },
            { type: NODE_TYPES.TABLE_ROW, id: 'r3', children: [cell('r3-b', 'C2')] },
          ],
        },
      ],
    },
  ];
  return doc;
}

function createEditor(): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({ schema, plugins: createBookEditorPlugins(schema) });
}

function selectRange(editor: BookEditor, startParaId: string, endParaId: string): void {
  const state = editor.editorState;
  let from: number | undefined;
  let to: number | undefined;
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      if (node.attrs['id'] === startParaId) from = pos + 1;
      if (node.attrs['id'] === endParaId) to = pos + node.nodeSize - 1;
    }
  });
  if (from === undefined || to === undefined) throw new Error('选区定位失败');
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function caretInCell(editor: BookEditor, paraId: string): void {
  const state = editor.editorState;
  let target: number | undefined;
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' && node.attrs['id'] === paraId) {
      target = pos + 1;
    }
  });
  if (target === undefined) throw new Error('找不到单元格段落');
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)));
}

function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

function findNode(doc: BookDocument, id: string): BookNode | undefined {
  let found: BookNode | undefined;
  const walk = (node: BookNode): void => {
    if (found !== undefined) return;
    if (node.id === id) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.root);
  return found;
}

describe('mergeCells', () => {
  it('合并 2×2 矩形为单格并清除其余三格', () => {
    const editor = createEditor();
    editor.loadDocument(gridDoc());
    selectRange(editor, 'r1-a-p', 'r2-b-p');

    expect(run(editor, mergeCells)).toBe(true);
    const table = findNode(editor.getDocument(), 't-1')!;
    const cellCount = (table.children ?? []).flatMap((r) => r.children ?? []).length;
    expect(cellCount).toBe(6); // 9 - 4 + 1
    const merged = findNode(editor.getDocument(), 'r1-a')!;
    expect(merged.attrs?.['colspan']).toBe(2);
    expect(merged.attrs?.['rowspan']).toBe(2);
    // 左上格保留拼接后的内容
    const text = JSON.stringify(editor.getDocument());
    expect(text).toContain('0-a');
    expect(text).toContain('1-b');
    expect(findNode(editor.getDocument(), 'r1-b')).toBeUndefined();
    expect(findNode(editor.getDocument(), 'r2-a')).toBeUndefined();
    expect(findNode(editor.getDocument(), 'r2-b')).toBeUndefined();
  });

  it('跨表头行冲突时拒绝合并', () => {
    const editor = createEditor();
    editor.loadDocument(headerDoc());
    // r1-a（表头）到 r2-a（正文）跨表头
    selectRange(editor, 'r1-a-p', 'r2-a-p');
    expect(run(editor, mergeCells)).toBe(false);
    expect((findNode(editor.getDocument(), 't-1')?.children ?? []).flatMap((r) => r.children ?? []).length).toBe(5);
  });

  it('选区仅覆盖单个单元格时不合并', () => {
    const editor = createEditor();
    editor.loadDocument(gridDoc());
    selectRange(editor, 'r1-a-p', 'r1-a-p');
    expect(run(editor, mergeCells)).toBe(false);
  });
});

describe('splitCell', () => {
  it('拆分合并格还原为独立空单元格', () => {
    const editor = createEditor();
    editor.loadDocument(gridDoc());
    selectRange(editor, 'r1-a-p', 'r2-b-p');
    expect(run(editor, mergeCells)).toBe(true);

    caretInCell(editor, 'r1-a-p');
    expect(run(editor, splitCell)).toBe(true);

    const table = findNode(editor.getDocument(), 't-1')!;
    const cellCount = (table.children ?? []).flatMap((r) => r.children ?? []).length;
    expect(cellCount).toBe(9);
    const topLeft = findNode(editor.getDocument(), 'r1-a')!;
    expect(topLeft.attrs?.['colspan'] ?? 1).toBe(1);
    expect(topLeft.attrs?.['rowspan'] ?? 1).toBe(1);
  });

  it('普通单元格（跨度 1×1）无法拆分', () => {
    const editor = createEditor();
    editor.loadDocument(gridDoc());
    caretInCell(editor, 'r1-a-p');
    expect(run(editor, splitCell)).toBe(false);
  });
});
