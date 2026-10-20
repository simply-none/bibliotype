/**
 * K2 校勘配对：自动编号、重排、底本/校本绑定与解绑
 */
import { NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import { BookEditor } from '@bibliotype/editor';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import {
  insertCollationNote,
  pairCollation,
  renumberCollationNotes,
  unpairCollation,
} from '../editor-commands.js';
import { buildClassicalEditorSchema } from '../editor-registration.js';
import { CLASSICAL_NODE_TYPES } from '../node-types.js';

function collationBlock(id: string, text: string, symbol: string): BookNode {
  return {
    type: NODE_TYPES.PARAGRAPH,
    id,
    children: [
      { type: 'text', text },
      { type: CLASSICAL_NODE_TYPES.COLLATION_MARK, attrs: { symbol } },
    ],
  };
}

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '校勘' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而第一' },
      children: [
        collationBlock('p-base', '底本作仁', '○'),
        collationBlock('p-variant', '校本作人', '□'),
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-plain',
          children: [{ type: 'text', text: '普通段落' }],
        },
      ],
    },
  ];
  return doc;
}

function createEditor(): BookEditor {
  return new BookEditor({ schema: buildClassicalEditorSchema(), document: sampleDoc() });
}

function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

interface NoteInfo {
  marker: unknown;
  pairId: unknown;
}

function collectNotes(editor: BookEditor): NoteInfo[] {
  const notes: NoteInfo[] = [];
  editor.editorState.doc.descendants((node) => {
    if (node.type.name === CLASSICAL_NODE_TYPES.COLLATION_NOTE) {
      notes.push({ marker: node.attrs['marker'], pairId: node.attrs['pairId'] });
    }
    return true;
  });
  return notes;
}

interface MarkInfo {
  pairId: unknown;
  role: unknown;
  symbol: unknown;
}

function collectMarks(editor: BookEditor): MarkInfo[] {
  const marks: MarkInfo[] = [];
  editor.editorState.doc.descendants((node) => {
    if (node.type.name === CLASSICAL_NODE_TYPES.COLLATION_MARK) {
      marks.push({
        pairId: node.attrs['pairId'],
        role: node.attrs['role'],
        symbol: node.attrs['symbol'],
      });
    }
    return true;
  });
  return marks;
}

/** 把光标放到指定块文本末尾 */
function caretInBlock(editor: BookEditor, blockId: string): void {
  let position = -1;
  editor.editorState.doc.descendants((node, pos) => {
    if (position >= 0) return false;
    if (node.attrs['id'] === blockId) {
      position = pos + node.nodeSize - 1;
      return false;
    }
    return true;
  });
  if (position < 0) throw new Error(`未找到块 ${blockId}`);
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, position)));
}

describe('校勘记编号', () => {
  it('插入时自动取号并递增', () => {
    const editor = createEditor();
    caretInBlock(editor, 'p-plain');
    expect(run(editor, insertCollationNote())).toBe(true);
    caretInBlock(editor, 'p-plain');
    expect(run(editor, insertCollationNote())).toBe(true);

    /* 编号按「现有最大值 + 1」分配，与插入位置无关；文档序不一定升序 */
    expect(
      collectNotes(editor)
        .map((note) => note.marker)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([1, 2]);
  });

  it('重排把空档压缩为连续编号', () => {
    const editor = createEditor();
    caretInBlock(editor, 'p-plain');
    run(editor, insertCollationNote());

    /* 人为制造编号空档（模拟删除 / 移动后的状态） */
    let notePos = -1;
    editor.editorState.doc.descendants((node, pos) => {
      if (node.type.name === CLASSICAL_NODE_TYPES.COLLATION_NOTE) {
        notePos = pos;
        return false;
      }
      return true;
    });
    const state = editor.editorState;
    const note = state.doc.nodeAt(notePos);
    editor.dispatch(state.tr.setNodeMarkup(notePos, undefined, { ...note?.attrs, marker: 7 }));
    expect(collectNotes(editor).map((item) => item.marker)).toEqual([7]);

    expect(run(editor, renumberCollationNotes())).toBe(true);
    expect(collectNotes(editor).map((item) => item.marker)).toEqual([1]);
  });

  it('无空档时重排返回 false', () => {
    const editor = createEditor();
    caretInBlock(editor, 'p-plain');
    run(editor, insertCollationNote());
    expect(run(editor, renumberCollationNotes())).toBe(false);
  });
});

describe('校勘配对', () => {
  it('两段写入同一 pairId 与不同角色', () => {
    const editor = createEditor();
    expect(run(editor, pairCollation('p-base', 'p-variant'))).toBe(true);

    const marks = collectMarks(editor);
    expect(marks).toHaveLength(2);
    expect(new Set(marks.map((mark) => mark.pairId)).size).toBe(1);
    expect(marks.map((mark) => mark.role)).toEqual(['base', 'variant']);
    expect(String(marks[0]?.pairId)).toMatch(/^pair-\d+$/);
  });

  it('重复配对生成新 pairId（覆盖旧值）', () => {
    const editor = createEditor();
    run(editor, pairCollation('p-base', 'p-variant'));
    run(editor, pairCollation('p-base', 'p-variant'));
    const marks = collectMarks(editor);
    expect(marks.filter((mark) => mark.pairId !== marks[0]?.pairId)).toHaveLength(0);
    expect(marks[0]?.pairId).toBe('pair-2');
  });

  it('缺少 id / 自配对时返回 false', () => {
    const editor = createEditor();
    expect(run(editor, pairCollation('p-base', 'missing'))).toBe(false);
    expect(run(editor, pairCollation('p-base', 'p-base'))).toBe(false);
  });

  it('解绑清除配对与角色', () => {
    const editor = createEditor();
    run(editor, pairCollation('p-base', 'p-variant'));
    const pairId = String(collectMarks(editor)[0]?.pairId);
    expect(run(editor, unpairCollation(pairId))).toBe(true);
    expect(collectMarks(editor).every((mark) => mark.pairId === null && mark.role === null)).toBe(
      true,
    );
  });
});
