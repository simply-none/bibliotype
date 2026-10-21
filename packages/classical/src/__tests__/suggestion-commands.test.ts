/**
 * 句读 / 专名建议命令测试（K3 编辑层）
 *
 * 覆盖：接受建议落 mark（source=auto）、拒绝后文档逐字不变、
 * 「采纳为标点」插入真实字符且移除标记、schema 未注册时命令不可用。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { BookEditor, buildEditorSchema } from '@bibliotype/editor';
import type { Node as PmNode } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import {
  applyJudouSuggestions,
  applyProperNameSuggestions,
  commitJudouAsText,
  removeSuggestionMarks,
} from '../editor-commands.js';
import { buildClassicalEditorSchema } from '../editor-registration.js';
import { CLASSICAL_MARK_TYPES } from '../mark-types.js';

/** 样本文档：章 > 段落「孔子曰学而时习之不亦说乎」 */
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
          children: [{ type: 'text', text: '孔子曰学而时习之不亦说乎' }],
        },
      ],
    },
  ];
  return doc;
}

function createEditor(): BookEditor {
  return new BookEditor({ schema: buildClassicalEditorSchema(), document: sampleDoc() });
}

/** 执行命令并派发事务 */
function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
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

/** 收集带指定标记的属性 */
function markAttrs(pm: PmNode, markName: string): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  pm.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === markName) result.push(mark.attrs as Record<string, unknown>);
    }
    return true;
  });
  return result;
}

/** 首个文本节点的起始 PM 位置 */
function textStart(pm: PmNode): number {
  let start = -1;
  pm.descendants((node, pos) => {
    if (start === -1 && node.isText) {
      start = pos;
      return false;
    }
    return true;
  });
  if (start === -1) throw new Error('文档中没有文本节点');
  return start;
}

describe('句读建议命令', () => {
  it('接受建议：包裹前字并写入 source=auto / symbol', () => {
    const editor = createEditor();
    expect(
      run(
        editor,
        applyJudouSuggestions([
          { blockId: 'p-1', start: 2, end: 3, symbol: '：', suggestionId: 'j-1', confidence: 0.85 },
        ]),
      ),
    ).toBe(true);

    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.JUDOU)).toEqual(['曰']);
    const attrs = markAttrs(editor.editorState.doc, CLASSICAL_MARK_TYPES.JUDOU);
    expect(attrs[0]?.['source']).toBe('auto');
    expect(attrs[0]?.['symbol']).toBe('：');
    expect(attrs[0]?.['suggestionId']).toBe('j-1');
    // 正文不变
    expect(editor.editorState.doc.textContent).toBe('孔子曰学而时习之不亦说乎');
  });

  it('块不存在 / 区间非法时不产生事务', () => {
    const editor = createEditor();
    expect(
      run(editor, applyJudouSuggestions([{ blockId: 'missing', start: 0, end: 1, symbol: '，' }])),
    ).toBe(false);
    expect(
      run(editor, applyJudouSuggestions([{ blockId: 'p-1', start: 99, end: 120, symbol: '，' }])),
    ).toBe(false);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.JUDOU)).toEqual([]);
  });

  it('采纳为标点：插入真实字符、移除标记，可再次执行而无残留', () => {
    const editor = createEditor();
    run(
      editor,
      applyJudouSuggestions([
        { blockId: 'p-1', start: 2, end: 3, symbol: '：', suggestionId: 'j-1' },
        { blockId: 'p-1', start: 11, end: 12, symbol: '。', suggestionId: 'j-2' },
      ]),
    );
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.JUDOU)).toEqual(['曰', '乎']);

    expect(run(editor, commitJudouAsText())).toBe(true);
    expect(editor.editorState.doc.textContent).toBe('孔子曰：学而时习之不亦说乎。');
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.JUDOU)).toEqual([]);

    // 没有可落地的标记时返回 false（不产生空事务）
    expect(run(editor, commitJudouAsText())).toBe(false);
  });

  it('按 suggestionId 只落地指定建议', () => {
    const editor = createEditor();
    run(
      editor,
      applyJudouSuggestions([
        { blockId: 'p-1', start: 2, end: 3, symbol: '：', suggestionId: 'j-1' },
        { blockId: 'p-1', start: 11, end: 12, symbol: '。', suggestionId: 'j-2' },
      ]),
    );
    expect(run(editor, commitJudouAsText({ suggestionIds: ['j-1'] }))).toBe(true);
    expect(editor.editorState.doc.textContent).toBe('孔子曰：学而时习之不亦说乎');
    // 未落地的建议仍保留
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.JUDOU)).toEqual(['乎']);
  });
});

describe('专名建议命令与拒绝', () => {
  it('接受专名建议写入 proper-name，拒绝后文档逐字不变', () => {
    const editor = createEditor();
    const before = editor.editorState.doc.textContent;

    expect(
      run(
        editor,
        applyProperNameSuggestions([
          { blockId: 'p-1', start: 0, end: 2, suggestionId: 'p-1:0:2', nameKind: 'person' },
        ]),
      ),
    ).toBe(true);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.PROPER_NAME)).toEqual(['孔子']);
    const attrs = markAttrs(editor.editorState.doc, CLASSICAL_MARK_TYPES.PROPER_NAME);
    expect(attrs[0]?.['source']).toBe('auto');
    expect(attrs[0]?.['nameKind']).toBe('person');

    // 拒绝全部自动建议：标记清空、正文不变
    expect(run(editor, removeSuggestionMarks())).toBe(true);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.PROPER_NAME)).toEqual([]);
    expect(editor.editorState.doc.textContent).toBe(before);
  });

  it('按 id 拒绝只清掉指定建议', () => {
    const editor = createEditor();
    run(
      editor,
      applyJudouSuggestions([
        { blockId: 'p-1', start: 2, end: 3, symbol: '：', suggestionId: 'j-1' },
        { blockId: 'p-1', start: 11, end: 12, symbol: '。', suggestionId: 'j-2' },
      ]),
    );
    expect(run(editor, removeSuggestionMarks({ suggestionIds: ['j-1'] }))).toBe(true);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.JUDOU)).toEqual(['乎']);
  });

  it('手工标记（无 source=auto）不会被拒绝命令误删', () => {
    const editor = createEditor();
    const state = editor.editorState;
    const markType = state.schema.marks[CLASSICAL_MARK_TYPES.PROPER_NAME];
    if (markType === undefined) throw new Error('proper-name 未注册');
    const from = textStart(state.doc);
    // 手工标记不带 source
    editor.dispatch(state.tr.addMark(from + 3, from + 5, markType.create({})));

    expect(run(editor, removeSuggestionMarks())).toBe(false);
    expect(markedTexts(editor.editorState.doc, CLASSICAL_MARK_TYPES.PROPER_NAME)).toEqual(['学而']);
  });

  it('schema 未注册古籍标记时命令返回 false', () => {
    const editor = new BookEditor({ schema: buildEditorSchema(), document: sampleDoc() });
    expect(
      run(editor, applyJudouSuggestions([{ blockId: 'p-1', start: 2, end: 3, symbol: '：' }])),
    ).toBe(false);
  });
});
