/**
 * 选区转换（替换为）测试
 *
 * 以 core 的 `quote`（content: block+）作为通用块级容器目标，
 * 覆盖段中 / 段首 / 整段 / 跨段 / 跨父容器、id 归属、标记保留、
 * 空段清理、文本块规范化与撤销。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import type { Node as PmNode } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';
import { BookEditor } from '../editor.js';
import { buildEditorSchema } from '../default-schema.js';
import { createBookEditorPlugins } from '../plugins.js';
import { replaceSelectionWithContainer } from '../selection-convert.js';
import { undoCommand } from '../commands.js';

/** 构造样本文档：章 > 三个段落 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '选区转换' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'chap-1',
      attrs: { title: '学而第一' },
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-1',
          children: [{ type: 'text', text: '第一段甲乙' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [{ type: 'text', text: '中间整段' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-3',
          children: [{ type: 'text', text: '第三段丙丁' }],
        },
      ],
    },
  ];
  return doc;
}

/** 创建带插件（history）的编辑器 */
function createEditor(document: BookDocument = sampleDoc()): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({
    schema,
    document,
    plugins: createBookEditorPlugins(schema),
  });
}

/** 文档中第一个文本节点内的子串区间 */
function rangeOf(editor: BookEditor, needle: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.editorState.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isText) {
      const index = (node.text ?? '').indexOf(needle);
      if (index >= 0) {
        found = { from: pos + index, to: pos + index + needle.length };
        return false;
      }
    }
    return true;
  });
  if (found === null) {
    throw new Error(`未找到文本：${needle}`);
  }
  return found;
}

/** 设置选区 */
function select(editor: BookEditor, from: number, to: number): void {
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

/** 执行命令并派发事务 */
function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

/** 光标移到指定文本节点的末尾 / 起点（用于空选区用例） */
function cursorAt(editor: BookEditor, needle: string, offset: number): void {
  const { from } = rangeOf(editor, needle);
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + offset)));
}

/** 文档中第一个指定类型节点 */
function findNode(doc: PmNode, typeName: string): PmNode | undefined {
  let found: PmNode | undefined;
  doc.descendants((node) => {
    if (found === undefined && node.type.name === typeName) {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}

/** 章容器的直接子块 */
function chapterChildren(editor: BookEditor): PmNode[] {
  const chapter = findNode(editor.editorState.doc, NODE_TYPES.CHAPTER);
  if (chapter === undefined) {
    throw new Error('未找到章容器');
  }
  const children: PmNode[] = [];
  chapter.forEach((child) => children.push(child));
  return children;
}

/** 收集所有带 id 的节点 id（用于唯一性断言） */
function allIds(doc: PmNode): string[] {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (typeof node.attrs.id === 'string' && node.attrs.id !== '') {
      ids.push(node.attrs.id);
    }
    return true;
  });
  return ids;
}

describe('replaceSelectionWithContainer', () => {
  it('段中选区：拆成前段 + 容器 + 后段，前段保留原 id', () => {
    const editor = createEditor();
    const { from, to } = rangeOf(editor, '甲乙');
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const children = chapterChildren(editor);
    expect(children.map((node) => node.type.name)).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.QUOTE,
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.PARAGRAPH,
    ]);
    expect(children[0]?.textContent).toBe('第一段');
    expect(children[0]?.attrs.id).toBe('p-1');
    expect(children[1]?.textContent).toBe('甲乙');
    expect(children[1]?.firstChild?.type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect(children[1]?.firstChild?.attrs.id).toBeNull();
    // 选区在段尾结束 → 无后段片段，后续块保持原样
    expect(children[2]?.textContent).toBe('中间整段');
    expect(children[3]?.textContent).toBe('第三段丙丁');
  });

  it('选区从段首开始：不产生空前段，容器内段落保留原 id', () => {
    const editor = createEditor();
    const { from, to } = rangeOf(editor, '第一段');
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const children = chapterChildren(editor);
    expect(children.map((node) => node.type.name)).toEqual([
      NODE_TYPES.QUOTE,
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.PARAGRAPH,
    ]);
    expect(children[0]?.textContent).toBe('第一段');
    expect(children[0]?.firstChild?.attrs.id).toBe('p-1');
    expect(children[1]?.textContent).toBe('甲乙');
    expect(children[1]?.attrs.id).toBeNull();
    expect(children[2]?.textContent).toBe('中间整段');
    expect(children[3]?.textContent).toBe('第三段丙丁');
  });

  it('整段选中：原段整体入容器，外层不留空段', () => {
    const editor = createEditor();
    const { from, to } = rangeOf(editor, '第一段甲乙');
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const children = chapterChildren(editor);
    expect(children).toHaveLength(3);
    expect(children[0]?.type.name).toBe(NODE_TYPES.QUOTE);
    expect(children[0]?.textContent).toBe('第一段甲乙');
    expect(children[0]?.firstChild?.attrs.id).toBe('p-1');
    expect(children[1]?.textContent).toBe('中间整段');
    expect(children[2]?.textContent).toBe('第三段丙丁');
  });

  it('跨多段选区：首尾切分、中间整段入容器，id 各自保留且不重复', () => {
    const editor = createEditor();
    const start = rangeOf(editor, '甲乙');
    const end = rangeOf(editor, '丙');
    select(editor, start.from, end.to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const children = chapterChildren(editor);
    expect(children.map((node) => node.type.name)).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.QUOTE,
      NODE_TYPES.PARAGRAPH,
    ]);
    expect(children[0]?.textContent).toBe('第一段');
    expect(children[0]?.attrs.id).toBe('p-1');
    expect(children[1]?.textContent).toBe('甲乙中间整段第三段丙');
    // 容器内三段分别对应 p-1 的选中后半、p-2 整段、p-3 的选中前半
    const inner: PmNode[] = [];
    children[1]?.forEach((node) => inner.push(node));
    expect(inner.map((node) => node.textContent)).toEqual(['甲乙', '中间整段', '第三段丙']);
    expect(inner[0]?.attrs.id).toBeNull();
    expect(inner[1]?.attrs.id).toBe('p-2');
    expect(inner[2]?.attrs.id).toBe('p-3');
    expect(children[2]?.textContent).toBe('丁');
    expect(children[2]?.attrs.id).toBeNull();
    expect(new Set(allIds(editor.editorState.doc)).size).toBe(allIds(editor.editorState.doc).length);
  });

  it('保留行内标记（strong）', () => {
    const editor = createEditor();
    const strong = editor.bookSchema.marks.strong;
    const { from, to } = rangeOf(editor, '甲乙');
    const state = editor.editorState;
    editor.dispatch(state.tr.addMark(from, to, strong.create()));
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const quote = findNode(editor.editorState.doc, NODE_TYPES.QUOTE);
    const text = quote?.firstChild?.firstChild;
    expect(text?.isText).toBe(true);
    expect(text?.marks.some((mark) => mark.type === strong)).toBe(true);
  });

  it('跨父容器（跨章）选区拒绝执行，文档不变', () => {
    const doc = createEmptyDocument({ title: '跨章' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'a', children: [{ type: 'text', text: '第一章文字' }] },
        ],
      },
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-2',
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'b', children: [{ type: 'text', text: '第二章文字' }] },
        ],
      },
    ];
    const editor = createEditor(doc);
    const start = rangeOf(editor, '第一章文字');
    const end = rangeOf(editor, '第二章文字');
    select(editor, start.from, end.to);
    const before = JSON.stringify(editor.getDocument());

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(false);
    expect(JSON.stringify(editor.getDocument())).toBe(before);
  });

  it('跨嵌套层级选区拒绝执行（段落与引用内段落深度不同）', () => {
    const doc = createEmptyDocument({ title: '跨层级' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'a', children: [{ type: 'text', text: '外层文字' }] },
          {
            type: NODE_TYPES.QUOTE,
            id: 'q-1',
            children: [
              { type: NODE_TYPES.PARAGRAPH, id: 'b', children: [{ type: 'text', text: '内层文字' }] },
            ],
          },
        ],
      },
    ];
    const editor = createEditor(doc);
    const start = rangeOf(editor, '外层文字');
    const end = rangeOf(editor, '内层文字');
    select(editor, start.from, end.to);
    const before = JSON.stringify(editor.getDocument());

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(false);
    expect(JSON.stringify(editor.getDocument())).toBe(before);
  });

  it('空选区默认退化为段后插入空容器', () => {
    const editor = createEditor();
    cursorAt(editor, '中间整段', 2);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const children = chapterChildren(editor);
    expect(children.map((node) => node.type.name)).toEqual([
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.PARAGRAPH,
      NODE_TYPES.QUOTE,
      NODE_TYPES.PARAGRAPH,
    ]);
    // 空容器插在当前段（p-2）之后
    expect(children[2]?.textContent).toBe('');
    expect(children[1]?.textContent).toBe('中间整段');
    expect(children[3]?.textContent).toBe('第三段丙丁');
  });

  it('空选区 + insertWhenEmpty=false 不执行', () => {
    const editor = createEditor();
    cursorAt(editor, '中间整段', 2);
    const before = JSON.stringify(editor.getDocument());

    expect(
      run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE, undefined, { insertWhenEmpty: false })),
    ).toBe(false);
    expect(JSON.stringify(editor.getDocument())).toBe(before);
  });

  it('目标未注册 / 非容器目标返回 false', () => {
    const editor = createEditor();
    const { from, to } = rangeOf(editor, '甲乙');
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer('no-such-node'))).toBe(false);
    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.IMAGE))).toBe(false);
  });

  it('文本块默认规范化为段落（标题不把标题样式带进容器）', () => {
    const doc = createEmptyDocument({ title: '标题转换' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          {
            type: NODE_TYPES.HEADING,
            id: 'h-1',
            attrs: { level: 1 },
            children: [{ type: 'text', text: '标题文字' }],
          },
        ],
      },
    ];
    const editor = createEditor(doc);
    const { from, to } = rangeOf(editor, '标题文字');
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const quote = findNode(editor.editorState.doc, NODE_TYPES.QUOTE);
    expect(quote?.firstChild?.type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect(quote?.firstChild?.attrs.id).toBe('h-1');
  });

  it('normalizeTextblocks=false 时保留原块类型', () => {
    const doc = createEmptyDocument({ title: '标题保留' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          {
            type: NODE_TYPES.HEADING,
            id: 'h-1',
            attrs: { level: 1 },
            children: [{ type: 'text', text: '标题文字' }],
          },
        ],
      },
    ];
    const editor = createEditor(doc);
    const { from, to } = rangeOf(editor, '标题文字');
    select(editor, from, to);

    expect(
      run(
        editor,
        replaceSelectionWithContainer(NODE_TYPES.QUOTE, undefined, {
          normalizeTextblocks: false,
        }),
      ),
    ).toBe(true);

    const quote = findNode(editor.editorState.doc, NODE_TYPES.QUOTE);
    expect(quote?.firstChild?.type.name).toBe(NODE_TYPES.HEADING);
  });

  it('纯空白前后片段默认删除', () => {
    const doc = createEmptyDocument({ title: '空白' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            id: 'p-1',
            children: [{ type: 'text', text: '  选中的文字  ' }],
          },
        ],
      },
    ];
    const editor = createEditor(doc);
    const { from, to } = rangeOf(editor, '选中的文字');
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);

    const children = chapterChildren(editor);
    expect(children).toHaveLength(1);
    expect(children[0]?.type.name).toBe(NODE_TYPES.QUOTE);
    expect(children[0]?.textContent).toBe('选中的文字');
    expect(children[0]?.firstChild?.attrs.id).toBe('p-1');
  });

  it('一次事务可整体撤销', () => {
    const editor = createEditor();
    const before = JSON.stringify(editor.getDocument());
    const { from, to } = rangeOf(editor, '甲乙');
    select(editor, from, to);

    expect(run(editor, replaceSelectionWithContainer(NODE_TYPES.QUOTE))).toBe(true);
    expect(JSON.stringify(editor.getDocument())).not.toBe(before);

    expect(run(editor, undoCommand)).toBe(true);
    expect(JSON.stringify(editor.getDocument())).toBe(before);
  });
});
