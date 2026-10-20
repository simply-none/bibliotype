/**
 * 表格数据层测试：跨行跨列 / 表头行 / 单元格对齐
 *
 * - IR ⇄ PM 往返不丢 colspan / rowspan / align / header；
 * - 表头切换与对齐命令只改目标行 / 单元格，不破坏表格结构。
 */
import { describe, expect, it } from 'vitest';
import {
  NODE_TYPES,
  createEmptyDocument,
  type Attrs,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import { TextSelection, type Command } from 'prosemirror-state';
import { setTableCellAlign, toggleTableHeaderRow } from '../commands.js';
import { BookEditor } from '../editor.js';
import { createBookEditorPlugins } from '../plugins.js';
import { buildEditorSchema } from '../default-schema.js';

function cell(id: string, text: string, attrs?: Attrs): BookNode {
  return {
    type: NODE_TYPES.TABLE_CELL,
    id,
    ...(attrs !== undefined ? { attrs } : {}),
    children: [
      { type: NODE_TYPES.PARAGRAPH, id: `${id}-p`, children: [{ type: 'text', text }] },
    ],
  };
}

/** 两行两列：首行表头，首格跨两列，次行首格跨两行且居中 */
function tableDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '表格属性' });
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
            {
              type: NODE_TYPES.TABLE_ROW,
              id: 'r-1',
              attrs: { header: true },
              children: [
                cell('c-1', '合表头', { colspan: 2 }),
                cell('c-2', '表头'),
              ],
            },
            {
              type: NODE_TYPES.TABLE_ROW,
              id: 'r-2',
              children: [cell('c-3', '跨行', { rowspan: 2, align: 'center' }), cell('c-4', '普通')],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

function createEditor(): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({
    schema,
    plugins: createBookEditorPlugins(schema),
  });
}

function caretInCell(editor: BookEditor, nodeId: string): void {
  const state = editor.editorState;
  let target: number | undefined;
  state.doc.descendants((node, pos) => {
    if (node.type.name === NODE_TYPES.PARAGRAPH && node.attrs['id'] === nodeId) {
      target = pos + 1;
      return false;
    }
    return true;
  });
  if (target === undefined) {
    throw new Error(`找不到单元格段落 ${nodeId}`);
  }
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)));
}

/** 执行命令并派发事务 */
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

describe('表格属性 IR ⇄ PM', () => {
  it('colspan / rowspan / align / header 往返不丢', () => {
    const editor = createEditor();
    const doc = tableDoc();
    editor.loadDocument(doc);
    expect(editor.getDocument()).toEqual(doc);
  });

  it('未声明的扩展属性仍进 rawAttrs（不因新增表格属性而丢失）', () => {
    const editor = createEditor();
    const doc = tableDoc();
    const table = findNode(doc, 't-1')!;
    table.attrs = { 'data-custom': 'x' };
    editor.loadDocument(doc);
    expect(findNode(editor.getDocument(), 't-1')?.attrs?.['data-custom']).toBe('x');
  });
});

describe('表格命令', () => {
  it('toggleTableHeaderRow：只翻转当前行的表头标记', () => {
    const editor = createEditor();
    editor.loadDocument(tableDoc());
    caretInCell(editor, 'c-1-p');

    expect(run(editor, toggleTableHeaderRow())).toBe(true);
    let doc = editor.getDocument();
    // header=false 等于 spec 默认值，IR 规范化为省略
    expect(findNode(doc, 'r-1')?.attrs?.['header']).toBeUndefined();
    expect(findNode(doc, 'r-2')?.attrs?.['header']).toBeUndefined();

    caretInCell(editor, 'c-3-p');
    run(editor, toggleTableHeaderRow());
    doc = editor.getDocument();
    expect(findNode(doc, 'r-2')?.attrs?.['header']).toBe(true);
    // 上一行仍保持已取消状态
    expect(findNode(doc, 'r-1')?.attrs?.['header']).toBeUndefined();
  });

  it('setTableCellAlign：设置 / 清除当前单元格对齐', () => {
    const editor = createEditor();
    editor.loadDocument(tableDoc());
    caretInCell(editor, 'c-4-p');

    expect(run(editor, setTableCellAlign('right'))).toBe(true);
    expect(findNode(editor.getDocument(), 'c-4')?.attrs?.['align']).toBe('right');

    run(editor, setTableCellAlign(null));
    expect(findNode(editor.getDocument(), 'c-4')?.attrs?.['align']).toBeUndefined();
    // 其它单元格不受影响
    expect(findNode(editor.getDocument(), 'c-3')?.attrs?.['align']).toBe('center');
  });

  it('不在表格内时命令返回 false', () => {
    const editor = createEditor();
    const doc = createEmptyDocument({ title: '无表' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '正文' }] },
    ];
    editor.loadDocument(doc);
    caretInCell(editor, 'p-1');
    expect(run(editor, toggleTableHeaderRow())).toBe(false);
    expect(run(editor, setTableCellAlign('center'))).toBe(false);
  });
});
