/**
 * 目录生成 / 刷新：条目收集、版式角色、原位替换与选项。
 */
import { describe, expect, it } from 'vitest';
import {
  MARK_TYPES,
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import type { Command } from 'prosemirror-state';
import { buildEditorSchema } from '../default-schema.js';
import { BookEditor } from '../editor.js';
import { createBookEditorPlugins } from '../plugins.js';
import { collectTocEntries, insertToc } from '../toc.js';

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    { type: NODE_TYPES.COVER, id: 'cover-1', children: [] },
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      attrs: { title: '上论' },
      children: [
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
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          attrs: { title: '为政第二' },
          children: [
            {
              type: NODE_TYPES.SECTION,
              id: 'sec-1',
              attrs: { title: '为政篇上' },
              children: [
                {
                  type: NODE_TYPES.PARAGRAPH,
                  children: [{ type: NODE_TYPES.TEXT, text: '为政以德。' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

function createEditor(document: BookDocument = sampleDoc()): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({
    schema,
    document,
    plugins: createBookEditorPlugins(schema),
  });
}

function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

function rootBlocks(editor: BookEditor): BookNode[] {
  return editor.getDocument().root.children ?? [];
}

function tocNode(editor: BookEditor): BookNode | undefined {
  return rootBlocks(editor).find((block) => block.type === NODE_TYPES.TOC);
}

function tocBlocks(editor: BookEditor): BookNode[] {
  return tocNode(editor)?.children ?? [];
}

function entryBlocks(editor: BookEditor): BookNode[] {
  return tocBlocks(editor).filter((block) => block.attrs?.['role'] !== 'toc-title');
}

function irText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) return node.text ?? '';
  return (node.children ?? []).map(irText).join('');
}

/** 改指定 id 节点的标题（模拟作者改章名后刷新目录） */
function renameNode(editor: BookEditor, id: string, title: string): void {
  let pos = -1;
  editor.editorState.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.attrs['id'] === id) {
      pos = nodePos;
      return false;
    }
    return true;
  });
  if (pos === -1) return;
  const state = editor.editorState;
  const node = state.doc.nodeAt(pos);
  if (node === null) return;
  editor.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, title }));
}

describe('collectTocEntries', () => {
  it('按先序收集，层级按结构嵌套推导', () => {
    const editor = createEditor();
    const entries = collectTocEntries(editor.editorState.doc);

    expect(entries.map((entry) => entry.id)).toEqual(['vol-1', 'chap-1', 'chap-2', 'sec-1']);
    expect(entries.map((entry) => entry.level)).toEqual([0, 1, 1, 2]);
    expect(entries.map((entry) => entry.title)).toEqual([
      '上论',
      '学而第一',
      '为政第二',
      '为政篇上',
    ]);
  });

  it('maxLevel 截断：0 只留顶层结构', () => {
    const editor = createEditor();
    const entries = collectTocEntries(editor.editorState.doc, { maxLevel: 0 });
    expect(entries.map((entry) => entry.id)).toEqual(['vol-1']);
  });

  it('无 id 的节点不出条目', () => {
    const doc = sampleDoc();
    const volume = doc.root.children?.[1];
    const first = volume?.children?.[0];
    if (volume !== undefined && first !== undefined) {
      volume.children![0] = { ...first, id: undefined };
    }
    const editor = createEditor(doc);
    expect(collectTocEntries(editor.editorState.doc).map((entry) => entry.id)).not.toContain(
      'chap-1',
    );
  });
});

describe('insertToc', () => {
  it('首次生成：插在前置页之后，标题行 + 条目段落带 data-role 与链接', () => {
    const editor = createEditor();
    expect(run(editor, insertToc())).toBe(true);

    expect(rootBlocks(editor).map((block) => block.type)).toEqual([
      NODE_TYPES.COVER,
      NODE_TYPES.TOC,
      NODE_TYPES.VOLUME,
    ]);

    const blocks = tocBlocks(editor);
    expect(blocks.map((block) => block.attrs?.['role'])).toEqual([
      'toc-title',
      'toc-entry',
      'toc-subentry',
      'toc-subentry',
      'toc-subentry',
    ]);
    expect(irText(blocks[0]!)).toBe('目录');
    expect(irText(blocks[1]!)).toBe('上论');
    expect(tocNode(editor)?.attrs?.['title']).toBe('目录');

    const link = blocks[1]?.children?.[0]?.marks?.[0];
    expect(link?.type).toBe(MARK_TYPES.LINK);
    expect(link?.attrs?.['href']).toBe('#vol-1');
  });

  it('再次调用原位刷新：不产生第二个目录，条目跟随标题变化，保留 id', () => {
    const editor = createEditor();
    run(editor, insertToc());

    /* 给目录一个 id 再刷新，验证原位替换保留 id */
    let tocPos = -1;
    editor.editorState.doc.descendants((node, pos) => {
      if (node.type.name === NODE_TYPES.TOC) {
        tocPos = pos;
        return false;
      }
      return true;
    });
    const state = editor.editorState;
    const node = state.doc.nodeAt(tocPos);
    editor.dispatch(
      state.tr.setNodeMarkup(tocPos, undefined, { ...node!.attrs, id: 'toc-1' }),
    );

    renameNode(editor, 'vol-1', '上论・新');
    run(editor, insertToc());

    expect(rootBlocks(editor).filter((block) => block.type === NODE_TYPES.TOC)).toHaveLength(1);
    expect(irText(entryBlocks(editor)[0]!)).toBe('上论・新');
  });

  it('已存在目录且文档有 id 时刷新保留该 id', () => {
    const doc = sampleDoc();
    doc.root.children?.splice(1, 0, {
      type: NODE_TYPES.TOC,
      id: 'toc-fixed',
      attrs: { title: '旧目录' },
      children: [
        { type: NODE_TYPES.PARAGRAPH, children: [{ type: NODE_TYPES.TEXT, text: '旧条目' }] },
      ],
    });
    const editor = createEditor(doc);
    expect(run(editor, insertToc())).toBe(true);

    expect(tocNode(editor)?.id).toBe('toc-fixed');
    expect(tocNode(editor)?.attrs?.['title']).toBe('目录');
    expect(irText(entryBlocks(editor)[0]!)).toBe('上论');
  });

  it('title 置空不排标题行；links: false 不加链接；hrefPrefix 生效', () => {
    const noTitle = createEditor();
    run(noTitle, insertToc({ title: '' }));
    expect(tocBlocks(noTitle)[0]?.attrs?.['role']).toBe('toc-entry');

    const plain = createEditor();
    run(plain, insertToc({ links: false }));
    expect(tocBlocks(plain)[1]?.children?.[0]?.marks).toBeUndefined();

    const prefixed = createEditor();
    run(prefixed, insertToc({ hrefPrefix: 'text/sec-0.xhtml#' }));
    expect(tocBlocks(prefixed)[1]?.children?.[0]?.marks?.[0]?.attrs?.['href']).toBe(
      'text/sec-0.xhtml#vol-1',
    );
  });

  it('无可收条目（空书）返回 false', () => {
    const empty = createEditor(createEmptyDocument({ title: '空书' }));
    expect(run(empty, insertToc())).toBe(false);
  });
});
