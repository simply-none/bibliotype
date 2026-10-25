/**
 * 行款命令测试（直排 v2 批 3）
 *
 * 覆盖：setLineIndent / setLift / toggleBreakLine 的目标定位（段落 / 引文，
 * 标题不命中）、属性写入与清除、PM → IR 导出带出行款 attrs。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { TextSelection, type Command } from 'prosemirror-state';
import {
  setLineIndent,
  setLift,
  toggleBreakLine,
} from '../commands.js';
import { BookEditor } from '../editor.js';
import { buildEditorSchema } from '../default-schema.js';

/** 构造单段文档 */
function oneParaDoc(text: string): BookDocument {
  const doc = createEmptyDocument({ title: '行款' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      children: [{ type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text }] }],
    },
  ];
  return doc;
}

function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

/** 光标落进首段文字起点（doc>chapter>paragraph：段落内容起点 = 2） */
function caretFirstPara(editor: BookEditor): void {
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2)));
}

function firstPara(editor: BookEditor) {
  return editor.editorState.doc.child(0).child(0);
}

describe('行款命令（setLineIndent / setLift / toggleBreakLine）', () => {
  it('setLineIndent(2)：写入 indent=2，setLineIndent(null) 清除', () => {
    const editor = new BookEditor({ schema: buildEditorSchema(), document: oneParaDoc('子曰') });
    caretFirstPara(editor);
    expect(run(editor, setLineIndent(2))).toBe(true);
    expect(firstPara(editor).attrs['indent']).toBe(2);

    expect(run(editor, setLineIndent(null))).toBe(true);
    expect(firstPara(editor).attrs['indent']).toBeNull();
  });

  it('setLift：space / newline+level 写入，none 清除（level 一并清）', () => {
    const editor = new BookEditor({ schema: buildEditorSchema(), document: oneParaDoc('子曰') });
    caretFirstPara(editor);
    expect(run(editor, setLift('space'))).toBe(true);
    expect(firstPara(editor).attrs['lift']).toBe('space');

    expect(run(editor, setLift('newline', 3))).toBe(true);
    expect(firstPara(editor).attrs['lift']).toBe('newline');
    expect(firstPara(editor).attrs['liftLevel']).toBe(3);

    expect(run(editor, setLift('none'))).toBe(true);
    expect(firstPara(editor).attrs['lift']).toBeNull();
    expect(firstPara(editor).attrs['liftLevel']).toBeNull();
  });

  it('toggleBreakLine：true ⇄ null 往返', () => {
    const editor = new BookEditor({ schema: buildEditorSchema(), document: oneParaDoc('子曰') });
    caretFirstPara(editor);
    expect(run(editor, toggleBreakLine())).toBe(true);
    expect(firstPara(editor).attrs['breakLine']).toBe(true);
    expect(run(editor, toggleBreakLine())).toBe(true);
    expect(firstPara(editor).attrs['breakLine']).toBeNull();
  });

  it('行款属性经 PM → IR 导出（getDocument 带出 attrs）', () => {
    const editor = new BookEditor({ schema: buildEditorSchema(), document: oneParaDoc('子曰') });
    caretFirstPara(editor);
    run(editor, setLineIndent(2));
    run(editor, toggleBreakLine());
    const para = editor.getDocument().root.children?.[0]?.children?.[0]!;
    expect(para.attrs?.['indent']).toBe(2);
    expect(para.attrs?.['breakLine']).toBe(true);
  });

  it('标题不命中：光标在标题内时命令返回 false 且文档不变', () => {
    const doc = createEmptyDocument({ title: '标题' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        children: [{ type: NODE_TYPES.HEADING, attrs: { level: 2 }, children: [{ type: 'text', text: '篇名' }] }],
      },
    ];
    const editor = new BookEditor({ schema: buildEditorSchema(), document: doc });
    caretFirstPara(editor);
    const before = editor.getDocument();

    expect(run(editor, setLineIndent(2))).toBe(false);
    expect(run(editor, setLift('space'))).toBe(false);
    expect(run(editor, toggleBreakLine())).toBe(false);
    expect(editor.getDocument()).toEqual(before);
  });
});
