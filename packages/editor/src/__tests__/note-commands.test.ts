/**
 * 注释插入命令：自动注码、类型独立性、注文落位与不可用分支。
 */
import { describe, expect, it } from 'vitest';
import {
  NODE_TYPES,
  NOTE_LABEL_STYLES,
  createEmptyDocument,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { insertEndnote, insertFootnote, insertMarginNote, insertNote } from '../commands.js';
import { buildEditorSchema } from '../default-schema.js';
import { BookEditor } from '../editor.js';
import { createBookEditorPlugins } from '../plugins.js';

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
          children: [{ type: NODE_TYPES.TEXT, text: '子曰：学而时习之。' }],
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
    document: sampleDoc(),
    plugins: createBookEditorPlugins(schema),
  });
}

/** 光标置于文档末尾文本节点之后（连续插入即顺序追加） */
function caretAtEnd(editor: BookEditor): void {
  let pos = 0;
  editor.editorState.doc.descendants((node, nodePos) => {
    if (node.isText) pos = nodePos + node.nodeSize;
    return true;
  });
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

/** 章内的块列表（IR） */
function chapterBlocks(editor: BookEditor): BookNode[] {
  return editor.getDocument().root.children?.[0]?.children ?? [];
}

function irText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) return node.text ?? '';
  return (node.children ?? []).map(irText).join('');
}

describe('注释插入命令', () => {
  it('insertFootnote：段后插入脚注块，自动注码 1，光标进入注文', () => {
    const editor = createEditor();
    caretAtEnd(editor);

    expect(run(editor, insertFootnote({ text: '注文' }))).toBe(true);

    const blocks = chapterBlocks(editor);
    expect(blocks.map((block) => block.type)).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.FOOTNOTE,
    ]);
    const footnote = blocks[1];
    expect(footnote?.attrs?.['marker']).toBe('1');
    expect(irText(footnote!)).toBe('注文');
    /* 光标落在注文段落内（深度 = 章 > 脚注 > 段落） */
    expect(editor.editorState.selection.$from.depth).toBeGreaterThanOrEqual(3);
  });

  it('第二条脚注自动递增，可切换为圈码', () => {
    const editor = createEditor();
    caretAtEnd(editor);
    run(editor, insertFootnote({ text: '甲' }));
    caretAtEnd(editor);
    expect(run(editor, insertFootnote({ text: '乙', labelStyle: NOTE_LABEL_STYLES.CIRCLED }))).toBe(
      true,
    );

    const markers = chapterBlocks(editor)
      .filter((block) => block.type === NODE_TYPES.FOOTNOTE)
      .map((block) => block.attrs?.['marker']);
    expect(markers).toEqual(['1', '②']);
  });

  it('脚注与尾注各自独立编号，显式注码优先', () => {
    const editor = createEditor();
    caretAtEnd(editor);
    run(editor, insertFootnote({ text: '甲' }));
    caretAtEnd(editor);
    run(editor, insertEndnote({ text: '乙' }));
    caretAtEnd(editor);
    run(editor, insertEndnote({ text: '丙', marker: '*' }));

    const notes = chapterBlocks(editor).filter((block) => block.type !== NODE_TYPES.PARAGRAPH);
    expect(notes.map((block) => block.type)).toEqual([
      NODE_TYPES.FOOTNOTE,
      NODE_TYPES.ENDNOTE,
      NODE_TYPES.ENDNOTE,
    ]);
    expect(notes.map((block) => block.attrs?.['marker'])).toEqual(['1', '1', '*']);
  });

  it('insertMarginNote 走边注类型', () => {
    const editor = createEditor();
    caretAtEnd(editor);
    expect(run(editor, insertMarginNote({ text: '旁批' }))).toBe(true);
    expect(chapterBlocks(editor)[1]?.type).toBe(NODE_TYPES.MARGIN_NOTE);
  });

  it('非注释类型 / 光标在文档根时不可用', () => {
    const editor = createEditor();
    caretAtEnd(editor);
    expect(run(editor, insertNote(NODE_TYPES.PARAGRAPH, { text: 'x' }))).toBe(false);

    const schema = buildEditorSchema();
    const empty = new BookEditor({
      schema,
      document: createEmptyDocument({ title: '空书' }),
      plugins: createBookEditorPlugins(schema),
    });
    expect(run(empty, insertFootnote())).toBe(false);
  });
});
