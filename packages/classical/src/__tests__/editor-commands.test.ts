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
  wrapDoubleNote,
  insertHeadNote,
  replaceWithBorderFrame,
  replaceWithCollationNote,
  replaceWithColophon,
  replaceWithHeadNote,
  replaceWithImprint,
  replaceWithTailNote,
  toggleBookTitle,
  toggleCircleEmphasis,
  toggleInlineNote,
  toggleProperName,
  toggleTabooChar,
  toggleVariant,
  toggleVariantChar,
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
  it('wrapDoubleNote：光标处插入行内夹注，光标进入夹注内部（行内化语义）', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from, 0);

    expect(run(editor, wrapDoubleNote())).toBe(true);
    /* 行内夹注：章下块数不变（仍 1 段），夹注落在段落内 */
    const blocks = chapterBlocks(editor);
    expect(blocks).toHaveLength(1);
    const note = blocks?.[0]?.children?.find(
      (child) => child.type === CLASSICAL_NODE_TYPES.DOUBLE_NOTE,
    );
    expect(note).toBeDefined();

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

describe('行内容器包裹命令（修复 R1）', () => {
  it('toggleInlineNote：选中文字包裹为夹注，内容正确、文档变化、光标落入夹注', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from + 2, 2); // "学而"

    expect(run(editor, toggleInlineNote())).toBe(true);

    // 段落内出现夹注，且内容恰为选中文字
    let noteText: string | null = null;
    editor.editorState.doc.descendants((node) => {
      if (node.type.name === CLASSICAL_NODE_TYPES.INLINE_NOTE) {
        noteText = node.textContent;
        return false;
      }
      return true;
    });
    expect(noteText).toBe('学而');

    // 光标已落入夹注内（祖先链含 inline-note）
    const noteType = editor.bookSchema.nodes[CLASSICAL_NODE_TYPES.INLINE_NOTE];
    const { $from } = editor.editorState.selection;
    let inside = false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type === noteType) inside = true;
    }
    expect(inside).toBe(true);
  });

  it('toggleVariantChar / toggleTabooChar：选中文字包裹同样生效（不再抛异常）', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from + 2, 2);
    expect(run(editor, toggleVariantChar())).toBe(true);

    const editor2 = createEditor();
    const { from: f2 } = firstTextRange(editor2);
    selectText(editor2, f2 + 2, 2);
    expect(run(editor2, toggleTabooChar())).toBe(true);
  });

  it('toggleInlineNote：跨块选区返回 false（不抛异常、不改文档）', () => {
    const doc = createEmptyDocument({ title: '论' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        attrs: { title: 'x' },
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '甲' }] },
          { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '乙' }] },
        ],
      },
    ];
    const editor = new BookEditor({ schema: buildClassicalEditorSchema(), document: doc });
    const ranges: Array<{ from: number; to: number }> = [];
    editor.editorState.doc.descendants((node, pos) => {
      if (node.isText) ranges.push({ from: pos, to: pos + node.nodeSize });
      return true;
    });
    expect(ranges).toHaveLength(2);
    editor.dispatch(
      editor.editorState.tr.setSelection(
        TextSelection.create(editor.editorState.doc, ranges[0]!.from, ranges[1]!.to),
      ),
    );

    const before = editor.getDocument();
    expect(run(editor, toggleInlineNote())).toBe(false);
    expect(editor.getDocument()).toEqual(before);
  });
});

describe('选区替换为块级容器命令', () => {
  it('wrapDoubleNote：同段选区 → 行内夹注（前后文留同段，古籍随文连排）', () => {
    const editor = createEditor();
    const { from } = firstTextRange(editor);
    selectText(editor, from + 2, 2); // "学而"

    expect(run(editor, wrapDoubleNote())).toBe(true);

    const blocks = chapterBlocks(editor);
    /* 行内包裹：不切分段落，章下仍是一段 */
    expect(blocks).toHaveLength(1);
    const children = blocks?.[0]?.children ?? [];
    expect(children.map((child) => child.type)).toEqual([
      'text',
      CLASSICAL_NODE_TYPES.DOUBLE_NOTE,
      'text',
    ]);
    expect((children[0] as { text?: string }).text).toBe('子曰');
    // 容器内直接挂文本（行内容器直挂文本为合法形态）
    expect((children[1]?.children?.[0] as { text?: string }).text).toBe('学而');
    expect((children[2] as { text?: string }).text).toBe('时习之');
    expect(blocks?.[0]?.id).toBe('p-1');
  });

  it('其余块级容器：整段选区直接搬入目标容器', () => {
    const cases: ReadonlyArray<readonly [() => Command, string]> = [
      [replaceWithHeadNote, CLASSICAL_NODE_TYPES.HEAD_NOTE],
      [replaceWithTailNote, CLASSICAL_NODE_TYPES.TAIL_NOTE],
      [replaceWithCollationNote, CLASSICAL_NODE_TYPES.COLLATION_NOTE],
      [replaceWithImprint, CLASSICAL_NODE_TYPES.IMPRINT],
      [replaceWithColophon, CLASSICAL_NODE_TYPES.COLOPHON],
      [replaceWithBorderFrame, CLASSICAL_NODE_TYPES.BORDER_FRAME],
    ];

    for (const [make, expectedType] of cases) {
      const editor = createEditor();
      const { from, to } = firstTextRange(editor);
      selectText(editor, from, to - from);

      expect(run(editor, make())).toBe(true);
      const blocks = chapterBlocks(editor);
      expect(blocks).toHaveLength(1);
      expect(blocks?.[0]?.type).toBe(expectedType);
      expect(blocks?.[0]?.children?.[0]?.children?.[0]?.text).toBe('子曰学而时习之');
    }
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
    expect(run(editor, wrapDoubleNote())).toBe(false);
    expect(run(editor, insertHeadNote())).toBe(false);
    expect(run(editor, insertCollationNote())).toBe(false);
    expect(run(editor, insertCollationSymbol())).toBe(false);

    expect(editor.getDocument()).toEqual(before);
  });
});
