/**
 * 分页可编辑桥测试（selection-bridge 纯映射 + edit-applier 落模）
 *
 * selection-bridge：纯数字映射，断言「(块,行,片段内偏移)⇄PM 位置」双向正确（实测/回退两套口径）。
 * edit-applier：以真实 BookEditor（ProseMirror 模型）验证文本插入 / 删除落到 IR 文档，脱浏览器可测。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import type { MeasurableBlock } from '@bibliotype/layout';
import { BookEditor, buildEditorSchema } from '@bibliotype/editor';
import { collectNodeText, extractBlocks, findNodeById } from '@bibliotype/reader';
import { collectPmLeafPositions } from '../paged-editor/use-paged-layout.js';
import {
  blockCharToPm,
  buildPagedIndex,
  charOfLine,
  fragmentCharToBlockChar,
  locatePmPosition,
  pmToBlockChar,
  resolveFragmentPoint,
  resolveFragmentRange,
} from '../paged-editor/selection-bridge.js';
import {
  applyFragmentEdit,
  applyFragmentSelection,
  applyFragmentSplit,
} from '../paged-editor/edit-applier.js';

describe('selection-bridge 纯映射', () => {
  const blocks = [
    { id: 'p-0', mainSize: 10 },
    { id: 'p-1', mainSize: 10 },
    { id: 'p-2', mainSize: 10 },
  ] as MeasurableBlock[];
  const leaf = [3, 15, 40];
  const lineOffsets = new Map<string, number[]>([['p-1', [0, 26, 52]]]);
  const index = buildPagedIndex(blocks, leaf, lineOffsets);

  it('按序对齐块与 PM 位置（contentStart = docStart + 1）', () => {
    expect(index.ordered).toHaveLength(3);
    expect(index.byId.get('p-1')?.contentStart).toBe(16);
    expect(index.byId.get('p-1')?.lineOffsets).toEqual([0, 26, 52]);
  });

  it('charOfLine：实测优先、回退 charsPerLine', () => {
    expect(charOfLine(1, [0, 26, 52], 26)).toBe(26);
    expect(charOfLine(2, undefined, 26)).toBe(52);
    expect(charOfLine(9, [0, 26, 52], 26)).toBe(52); // 越界钳到末行行首
  });

  it('片段字符 → 块内字符 → PM 位置', () => {
    expect(fragmentCharToBlockChar(1, 5, [0, 26, 52], 26)).toBe(31);
    expect(blockCharToPm(16, 31)).toBe(47);
    expect(pmToBlockChar(16, 47)).toBe(31);
  });

  it('resolveFragmentRange：命中块产出 PM 区间', () => {
    const r = resolveFragmentRange(index, 'p-1', 1, 5, 9, 26);
    expect(r).toEqual({ from: 47, to: 51 });
  });

  it('resolveFragmentRange：未命中返回 null', () => {
    expect(resolveFragmentRange(index, 'nope', 0, 0, 1, 26)).toBeNull();
  });

  it('resolveFragmentRange：负偏移（越出块首）返回 null', () => {
    expect(resolveFragmentRange(index, 'p-1', 0, -1, 0, 26)).toBeNull();
  });

  it('resolveFragmentPoint：片段单点 → PM 位置 / 越界 null', () => {
    expect(resolveFragmentPoint(index, 'p-1', 1, 5, 26)).toBe(47);
    expect(resolveFragmentPoint(index, 'p-1', 0, -1, 26)).toBeNull();
    expect(resolveFragmentPoint(index, 'p-1', 0, 5, 26, 4)).toBeNull(); // 超 doc.content.size
  });

  it('locatePmPosition：定位 PM 位置所属块与块内偏移', () => {
    const hit = locatePmPosition(index, 20);
    expect(hit?.loc.blockId).toBe('p-1');
    expect(hit?.blockChar).toBe(4);
  });
});

function docOneParagraph(text: string): BookDocument {
  const doc = createEmptyDocument({ title: '测试' });
  doc.root.children = [
    { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text }] },
  ];
  return doc;
}

function freshEditor(text: string): { editor: BookEditor; id: string } {
  const editor = new BookEditor({ schema: buildEditorSchema(), document: docOneParagraph(text) });
  const doc = editor.getDocument();
  const blocks = extractBlocks(doc, {});
  const leaf = collectPmLeafPositions(editor.editorState.doc);
  const index = buildPagedIndex(blocks, leaf, new Map());
  void index;
  return { editor, id: blocks[0]!.id };
}

describe('edit-applier 落模（真实 BookEditor）', () => {
  function indexFor(editor: BookEditor) {
    const doc = editor.getDocument();
    const blocks = extractBlocks(doc, {});
    const leaf = collectPmLeafPositions(editor.editorState.doc);
    return buildPagedIndex(blocks, leaf, new Map());
  }

  function textOf(editor: BookEditor, id: string): string {
    const node = findNodeById(editor.getDocument().root, id);
    return node ? collectNodeText(node) : '';
  }

  it('片段首部插入文本', () => {
    const { editor, id } = freshEditor('子曰学而时习之');
    const ok = applyFragmentEdit(editor, indexFor(editor), id, 0, 0, 0, 'X', 26);
    expect(ok).toBe(true);
    expect(textOf(editor, id)).toBe('X子曰学而时习之');
  });

  it('片段区间替换文本', () => {
    const { editor, id } = freshEditor('子曰学而时习之');
    const ok = applyFragmentEdit(editor, indexFor(editor), id, 0, 0, 2, 'AB', 26);
    expect(ok).toBe(true);
    expect(textOf(editor, id)).toBe('AB学而时习之');
  });

  it('删除区间（空插入文本）', () => {
    const { editor, id } = freshEditor('子曰学而时习之');
    const ok = applyFragmentEdit(editor, indexFor(editor), id, 0, 0, 2, '', 26);
    expect(ok).toBe(true);
    expect(textOf(editor, id)).toBe('学而时习之');
  });

  it('未命中块返回 false 且不改文档', () => {
    const { editor, id } = freshEditor('子曰');
    const before = textOf(editor, id);
    const ok = applyFragmentEdit(editor, indexFor(editor), 'nope', 0, 0, 0, 'X', 26);
    expect(ok).toBe(false);
    expect(textOf(editor, id)).toBe(before);
  });

  it('applyFragmentSplit：Enter 在片段内拆分块', () => {
    const { editor, id } = freshEditor('子曰学而时习之');
    const ok = applyFragmentSplit(editor, indexFor(editor), id, 0, 2, 26);
    expect(ok).toBe(true);
    const paras = (editor.getDocument().root.children ?? []).filter((c) => c.type === NODE_TYPES.PARAGRAPH);
    expect(paras.map((p) => collectNodeText(p))).toEqual(['子曰', '学而时习之']);
  });

  it('applyFragmentSelection：选区落模不改文档', () => {
    const { editor, id } = freshEditor('子曰学而时习之');
    const before = editor.editorState.doc;
    const ok = applyFragmentSelection(editor, indexFor(editor), id, 0, 1, 3, 26);
    expect(ok).toBe(true);
    expect(editor.editorState.doc).toBe(before);
    expect(editor.editorState.selection.from).toBe(2);
    expect(editor.editorState.selection.to).toBe(4);
  });
});
