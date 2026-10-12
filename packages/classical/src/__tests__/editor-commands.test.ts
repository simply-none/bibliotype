/**
 * 古籍编辑命令测试（编辑器状态机路径）
 *
 * 使用含古籍规格的完整 schema 构造 BookEditor，
 * 覆盖行内标记、块插入与符号插入；并验证未注册古籍规格时命令不可用。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { BookEditor, buildEditorSchema } from '@bibliotype/editor';
import type { Node as PmNode } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';
import {
  insertCollationNote,
  insertCollationSymbol,
  insertDoubleNote,
  insertHeadNote,
  toggleBookTitle,
  toggleCircleEmphasis,
  toggleProperName,
  toggleVariant,
} from '../editor-commands.js';
import { buildClassicalEditorSchema } from '../editor-registration.js';
import { CLASSICAL_MARK_TYPES } from '../mark-types.js';
import { CLASSICAL_NODE_TYPES } from '../node-types.js';

/** 构造样本文档：章 > 段落（古籍文本） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而第一' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: 'text', text: '子曰学而时习之' }],
        },
      ],
    },
  ];
  return doc;
}

/** 创建含古籍规格的编辑器 */
function createEditor(): BookEditor {
  return new BookEditor({ schema: buildClassicalEditorSchema(), document: sampleDoc() });
}

/** 首个文本节点的区间（from 含、to 不含） */
function firstTextRange(editor: BookEditor): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  editor.editorState.doc.descendants((node, pos) => {
    if (range === null && node.isText) {
      range = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  if (range === null) {
    throw new Error('文档中没有文本节点');
  }
  return range;
}

/** 设置选区（length 为 0 即光标） */
function selectText(editor: BookEditor, from: number, length: number): void {
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, from + length)));
}

/** 执行命令并派发事务 */
function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

/** 章内块列表 */
function chapterBlocks(editor: BookEditor): BookDocument['root']['children'] | undefined {
  return editor.getDocument().root.children?.[0]?.children;
}

/** 收集带指定标记的文本片段 */
function markedTexts(pm: PmNode, markName: string): string[] {
  const result: string[] = [];
  pm.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) {
      result.push(node.text ?? '');
    }
    return true;
  });
  return result;
}

describe('古籍行内标记命令', () => {
  it('toggleProperName：选中片段应用专名号', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from + 2, 2); // "学而"

    expect(run(editor, toggleProperName())).toBe(true);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.PROPER_NAME)).toEqual(['学而']);

    // 再次执行取消标记
    expect(run(editor, toggleProperName())).toBe(true);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.PROPER_NAME)).toEqual([]);
  });

  it('toggleBookTitle / toggleVariant：书名号与异体字标记', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);

    selectText(editor, from + 2, 2);
    expect(run(editor, toggleBookTitle())).toBe(true);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.BOOK_TITLE)).toEqual(['学而']);

    selectText(editor, from + 4, 2);
    expect(run(editor, toggleVariant())).toBe(true);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.VARIANT)).toEqual(['时习']);
  });

  it('toggleCircleEmphasis：支持 style 属性', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from, 2);

    expect(run(editor, toggleCircleEmphasis('dot'))).toBe(true);
    let style: unknown;
    editor.editorState.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS)) {
        style = node.marks.find((m) => m.type.name === CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS)?.attrs.style;
      }
      return true;
    });
    expect(style).toBe('dot');
  });
});

describe('古籍块插入命令', () => {
  it('insertDoubleNote：叶块之后插入容器（含空段落）且光标进入新块', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from, 0);

    expect(run(editor, insertDoubleNote())).toBe(true);
    const blocks = chapterBlocks(editor);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[1]?.type).toBe(CLASSICAL_NODE_TYPES.DOUBLE_NOTE);
    expect(blocks?.[1]?.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);

    // 光标已进入新块（祖先链含 double-note），后续插入会落入容器内
    const doubleNoteType = editor.bookSchema.nodes[CLASSICAL_NODE_TYPES.DOUBLE_NOTE];
    const { $from } = editor.editorState.selection;
    let inside = false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type === doubleNoteType) {
        inside = true;
      }
    }
    expect(inside).toBe(true);
  });

  it('insertHeadNote / insertCollationNote：分别独立插入叶块之后', () => {
    const editor = createEditor();
    selectText(editor, firstTextRange(editor).from, 0);
    expect(run(editor, insertHeadNote())).toBe(true);
    expect(chapterBlocks(editor)?.[1]?.type).toBe(CLASSICAL_NODE_TYPES.HEAD_NOTE);

    const editor2 = createEditor();
    selectText(editor2, firstTextRange(editor2).from, 0);
    expect(run(editor2, insertCollationNote())).toBe(true);
    expect(chapterBlocks(editor2)?.[1]?.type).toBe(CLASSICAL_NODE_TYPES.COLLATION_NOTE);
  });

  it('insertCollationSymbol：光标处插入出校符号', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from, 0);

    expect(run(editor, insertCollationSymbol('△'))).toBe(true);
    const paragraph = chapterBlocks(editor)?.[0];
    const symbol = paragraph?.children?.find(
      (child) => child.type === CLASSICAL_NODE_TYPES.COLLATION_MARK,
    );
    expect(symbol).toBeDefined();
    expect(symbol?.attrs?.symbol).toBe('△');

    // 光标移至文本末尾后插入默认符号 ○
    selectText(editor, firstTextRange(editor).to, 0);
    expect(run(editor, insertCollationSymbol())).toBe(true);
    const symbols = chapterBlocks(editor)?.[0]?.children?.filter(
      (child) => child.type === CLASSICAL_NODE_TYPES.COLLATION_MARK,
    );
    expect(symbols?.map((node) => node.attrs?.symbol)).toEqual(['△', '○']);
  });
});

describe('未注册古籍规格的 schema', () => {
  it('命令一律返回 false 且不改变文档', () => {
    const editor = new BookEditor({ schema: buildEditorSchema(), document: sampleDoc() });
    const { from } = firstTextRange(editor);
    selectText(editor, from, 2);
    const before = editor.getDocument();

    expect(run(editor, toggleProperName())).toBe(false);
    expect(run(editor, toggleBookTitle())).toBe(false);
    expect(run(editor, toggleCircleEmphasis())).toBe(false);
    expect(run(editor, toggleVariant())).toBe(false);
    expect(run(editor, insertDoubleNote())).toBe(false);
    expect(run(editor, insertHeadNote())).toBe(false);
    expect(run(editor, insertCollationNote())).toBe(false);
    expect(run(editor, insertCollationSymbol())).toBe(false);

    expect(editor.getDocument()).toEqual(before);
  });
});
