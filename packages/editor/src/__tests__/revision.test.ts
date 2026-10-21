/**
 * 修订模式（C5）：自动打标、接受 / 拒绝命令、格式变更回滚。
 *
 * 无视图路径：通过 BookEditor.dispatch 触发 `applyTransaction`，
 * 让插件的 `appendTransaction` 真正参与（与 EditorView 行为一致）。
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import type { Mark } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import {
  acceptAllRevisions,
  rejectAllRevisions,
} from '../revision-commands.js';
import { createRevisionTrackingPlugin, revisionStateOf } from '../revision-plugin.js';
import { BookEditor } from '../editor.js';
import { createBookEditorPlugins } from '../plugins.js';
import { buildEditorSchema } from '../default-schema.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [{ type: 'text', text: '学而时习之' }],
    },
  ];
  return doc;
}

function createEditor(enabled = true): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({
    schema,
    document: sampleDoc(),
    plugins: [
      ...createBookEditorPlugins(schema),
      createRevisionTrackingPlugin({ author: '甲', timestamp: () => 1000, enabled }),
    ],
  });
}

/** 首个文本节点区间 */
function textRange(editor: BookEditor): { from: number; to: number } {
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

function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

/** 收集 IR 中带某标记的文本 */
function textsWithMark(doc: BookDocument, markType: string): string[] {
  const result: string[] = [];
  const walk = (node: BookNode): void => {
    if (node.type === 'text') {
      if ((node.marks ?? []).some((mark) => mark.type === markType)) {
        result.push(node.text ?? '');
      }
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.root);
  return result;
}

/** 拼接全文 */
function plainText(doc: BookDocument): string {
  const parts: string[] = [];
  const walk = (node: BookNode): void => {
    if (node.type === 'text') {
      parts.push(node.text ?? '');
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(doc.root);
  return parts.join('');
}

/** 文档内全部标记名 */
function markNames(editor: BookEditor): string[] {
  const names = new Set<string>();
  editor.editorState.doc.descendants((node) => {
    node.marks.forEach((mark: Mark) => names.add(mark.type.name));
    return true;
  });
  return [...names];
}

describe('修订插件自动打标', () => {
  it('插件默认关闭，未开启时不记录', () => {
    const editor = createEditor(false);
    expect(revisionStateOf(editor.editorState).enabled).toBe(false);
    const { to } = textRange(editor);
    editor.dispatch(editor.editorState.tr.insertText('新', to));
    expect(textsWithMark(editor.getDocument(), MARK_TYPES.INSERTION)).toEqual([]);
  });

  it('插入文本自动加 insertion 标记（含作者与时间）', () => {
    const editor = createEditor();
    const { to } = textRange(editor);
    editor.dispatch(editor.editorState.tr.insertText('新', to));

    const doc = editor.getDocument();
    expect(plainText(doc)).toBe('学而时习之新');
    expect(textsWithMark(doc, MARK_TYPES.INSERTION)).toEqual(['新']);

    const insertion = collectMarks(editor).find((mark) => mark.type.name === MARK_TYPES.INSERTION);
    expect(insertion?.attrs['author']).toBe('甲');
    expect(insertion?.attrs['timestamp']).toBe(1000);
    expect(typeof insertion?.attrs['changeId']).toBe('string');
  });

  it('删除文本保留原文并加 deletion 标记', () => {
    const editor = createEditor();
    const { from } = textRange(editor);
    editor.dispatch(editor.editorState.tr.delete(from, from + 2));

    const doc = editor.getDocument();
    expect(plainText(doc)).toBe('学而时习之');
    expect(textsWithMark(doc, MARK_TYPES.DELETION)).toEqual(['学而']);
  });

  it('格式变更记录 format-change 与变更前快照', () => {
    const editor = createEditor();
    const { from, to } = textRange(editor);
    const strong = editor.editorState.schema.marks['strong'];
    expect(strong).toBeDefined();
    editor.dispatch(editor.editorState.tr.addMark(from, to, strong!.create()));

    expect(markNames(editor)).toContain(MARK_TYPES.FORMAT_CHANGE);
    const formatMark = collectMarks(editor).find(
      (mark) => mark.type.name === MARK_TYPES.FORMAT_CHANGE,
    );
    expect(formatMark?.attrs['previous']).toBe('[]');
  });

  it('撤销事务不记录修订', () => {
    const editor = createEditor();
    const { to } = textRange(editor);
    editor.dispatch(editor.editorState.tr.insertText('新', to));
    const undo = editor.createTransaction().setMeta('addToHistory', false);
    // 直接构造一个「历史回放」语义的事务：不应产生新的修订标记
    editor.dispatch(undo.insertText('乙', to));
    expect(textsWithMark(editor.getDocument(), MARK_TYPES.INSERTION).join('')).toBe('新');
  });
});

describe('接受 / 拒绝修订命令', () => {
  it('接受全部：删除内容消失，插入内容保留', () => {
    const editor = createEditor();
    const { from, to } = textRange(editor);
    editor.dispatch(editor.editorState.tr.insertText('新', to));
    editor.dispatch(editor.editorState.tr.delete(from, from + 2));

    expect(run(editor, acceptAllRevisions)).toBe(true);
    const doc = editor.getDocument();
    expect(plainText(doc)).toBe('时习之新');
    expect(markNames(editor)).not.toContain(MARK_TYPES.DELETION);
    expect(markNames(editor)).not.toContain(MARK_TYPES.INSERTION);
  });

  it('拒绝全部：插入内容消失，删除内容复原', () => {
    const editor = createEditor();
    const { from, to } = textRange(editor);
    editor.dispatch(editor.editorState.tr.insertText('新', to));
    editor.dispatch(editor.editorState.tr.delete(from, from + 2));

    expect(run(editor, rejectAllRevisions)).toBe(true);
    expect(plainText(editor.getDocument())).toBe('学而时习之');
    expect(markNames(editor)).not.toContain(MARK_TYPES.DELETION);
    expect(markNames(editor)).not.toContain(MARK_TYPES.INSERTION);
  });

  it('拒绝格式变更后样式复原', () => {
    const editor = createEditor();
    const { from, to } = textRange(editor);
    const strong = editor.editorState.schema.marks['strong'];
    editor.dispatch(editor.editorState.tr.addMark(from, to, strong!.create()));
    expect(markNames(editor)).toContain(MARK_TYPES.STRONG);

    expect(run(editor, rejectAllRevisions)).toBe(true);
    expect(markNames(editor)).not.toContain(MARK_TYPES.STRONG);
    expect(markNames(editor)).not.toContain(MARK_TYPES.FORMAT_CHANGE);
    expect(plainText(editor.getDocument())).toBe('学而时习之');
  });

  it('无修订时命令返回 false（不做无谓事务）', () => {
    const editor = createEditor();
    expect(run(editor, acceptAllRevisions)).toBe(false);
    expect(run(editor, rejectAllRevisions)).toBe(false);
  });

  it('接受后再次拒绝为空操作', () => {
    const editor = createEditor();
    const { to } = textRange(editor);
    editor.dispatch(editor.editorState.tr.insertText('新', to));
    run(editor, acceptAllRevisions);
    expect(run(editor, rejectAllRevisions)).toBe(false);
    expect(plainText(editor.getDocument())).toBe('学而时习之新');
  });
});

/** 收集文档内全部标记实例 */
function collectMarks(editor: BookEditor): Mark[] {
  const marks: Mark[] = [];
  editor.editorState.doc.descendants((node) => {
    marks.push(...node.marks);
    return true;
  });
  return marks;
}


