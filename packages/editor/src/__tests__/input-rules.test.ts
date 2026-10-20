/**
 * 快捷输入测试：块首触发串 → 节点转换；非块首不触发；开关可关闭。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import type { BookDocument } from '@bibliotype/core';
import { TextSelection } from 'prosemirror-state';
import { BookEditor } from '../editor.js';
import { buildEditorSchema } from '../default-schema.js';
import { createBookEditorPlugins } from '../plugins.js';
import { createInputRulesPlugin, matchInputRule } from '../input-rules.js';

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
          children: [{ type: 'text', text: '子曰' }],
        },
        {
          type: NODE_TYPES.PARAGRAPH,
          id: 'p-2',
          children: [{ type: 'text', text: '有朋' }],
        },
      ],
    },
  ];
  return doc;
}

function createEditor(plugins = true): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({
    schema,
    document: sampleDoc(),
    plugins: plugins ? createBookEditorPlugins(schema) : [createInputRulesPlugin()],
  });
}

/** 把光标放到指定块的首字符（offset = 0） */
function cursorAtStart(editor: BookEditor, nodeId: string): void {
  const state = editor.editorState;
  let target: number | undefined;
  state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.attrs.id === nodeId) {
      target = pos + 1;
      return false;
    }
    return true;
  });
  if (target === undefined) {
    throw new Error(`测试文档中找不到块 ${nodeId}`);
  }
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)));
}

/** 逐字符输入（模拟键入） */
function typeText(editor: BookEditor, text: string): void {
  for (const char of text) {
    editor.dispatch(editor.createTransaction().insertText(char));
  }
}

function firstChapterChild(editor: BookEditor): Record<string, unknown> {
  const chapter = editor.getDocument().root.children?.[0];
  return (chapter?.children?.[0] ?? {}) as Record<string, unknown>;
}

describe('matchInputRule', () => {
  it('识别各类触发串', () => {
    expect(matchInputRule('# ')).toMatchObject({ kind: 'heading', headingLevel: 1 });
    expect(matchInputRule('###### ')).toMatchObject({ kind: 'heading', headingLevel: 6 });
    expect(matchInputRule('> ')).toMatchObject({ kind: 'quote' });
    expect(matchInputRule('- ')).toMatchObject({ kind: 'bullet-list' });
    expect(matchInputRule('1. ')).toMatchObject({ kind: 'ordered-list' });
    expect(matchInputRule('```ts ')).toMatchObject({ kind: 'code-block', language: 'ts' });
    expect(matchInputRule('---')).toMatchObject({ kind: 'hr' });
  });

  it('只认块首（带前缀不匹配）', () => {
    expect(matchInputRule('请# ')).toBeUndefined();
    expect(matchInputRule('## x')).toBeUndefined();
    expect(matchInputRule('#')).toBeUndefined();
  });

  it('开关可关闭规则', () => {
    expect(matchInputRule('# ', { headings: false })).toBeUndefined();
    expect(matchInputRule('---', { horizontalRule: false })).toBeUndefined();
    expect(matchInputRule('- ', { lists: false })).toBeUndefined();
  });
});

describe('快捷输入（编辑器）', () => {
  it('# + 空格 转为一级标题并保留块 id', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-1');
    typeText(editor, '# ');
    const block = firstChapterChild(editor);
    expect(block.type).toBe(NODE_TYPES.HEADING);
    // level 1 等于 spec 默认值，IR 中规范化为省略，故按「缺省即 1」断言
    const attrs = (block.attrs ?? {}) as { level?: number };
    expect(attrs.level ?? 1).toBe(1);
    expect(block.id).toBe('p-1');
  });

  it('### + 空格 转为三级标题', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-2');
    typeText(editor, '### ');
    const chapter = editor.getDocument().root.children?.[0];
    const block = chapter?.children?.[1];
    expect(block?.type).toBe(NODE_TYPES.HEADING);
    expect(block?.attrs).toMatchObject({ level: 3 });
  });

  it('> + 空格 包裹为引用', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-1');
    typeText(editor, '> ');
    const quote = firstChapterChild(editor);
    expect(quote.type).toBe(NODE_TYPES.QUOTE);
    const inner = (quote.children as Record<string, unknown>[] | undefined)?.[0];
    expect(inner?.type).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('- + 空格 转为无序列表', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-1');
    typeText(editor, '- ');
    const list = firstChapterChild(editor);
    expect(list.type).toBe(NODE_TYPES.LIST);
    // ordered: false 等于 spec 默认值，IR 中规范化为省略
    const attrs = (list.attrs ?? {}) as { ordered?: boolean };
    expect(attrs.ordered ?? false).toBe(false);
    const item = (list.children as Record<string, unknown>[] | undefined)?.[0];
    expect(item?.type).toBe(NODE_TYPES.LIST_ITEM);
  });

  it('1. + 空格 转为有序列表', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-1');
    typeText(editor, '1. ');
    const list = firstChapterChild(editor);
    expect(list.type).toBe(NODE_TYPES.LIST);
    expect(list.attrs).toMatchObject({ ordered: true });
  });

  it('```ts + 空格 转为代码块并记录语言', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-1');
    typeText(editor, '```ts ');
    const block = firstChapterChild(editor);
    expect(block.type).toBe(NODE_TYPES.CODE_BLOCK);
    expect(block.attrs).toMatchObject({ language: 'ts' });
  });

  it('--- 转为分隔符节点', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-1');
    typeText(editor, '---');
    const block = firstChapterChild(editor);
    expect(block.type).toBe(NODE_TYPES.BREAK);
    expect(block.attrs).toMatchObject({ variant: 'hr' });
  });

  it('末块转为分隔符后补空段落，可继续输入', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-2');
    typeText(editor, '---');
    const children = editor.getDocument().root.children?.[0]?.children ?? [];
    expect(children[children.length - 2]?.type).toBe(NODE_TYPES.BREAK);
    expect(children[children.length - 1]?.type).toBe(NODE_TYPES.PARAGRAPH);

    typeText(editor, '新段');
    const after = editor.getDocument().root.children?.[0]?.children ?? [];
    const last = after[after.length - 1];
    expect((last?.children as { text?: string }[] | undefined)?.[0]?.text).toBe('新段');
  });

  it('非块首不触发', () => {
    const editor = createEditor();
    cursorAtStart(editor, 'p-1');
    typeText(editor, '请# ');
    const block = firstChapterChild(editor);
    expect(block.type).toBe(NODE_TYPES.PARAGRAPH);
    expect((block.children as { text?: string }[])[0]?.text).toBe('请# 子曰');
  });

  it('关闭标题规则后保持段落', () => {
    const schema = buildEditorSchema();
    const editor = new BookEditor({
      schema,
      document: sampleDoc(),
      plugins: [createInputRulesPlugin({ headings: false })],
    });
    cursorAtStart(editor, 'p-1');
    typeText(editor, '# ');
    const block = firstChapterChild(editor);
    expect(block.type).toBe(NODE_TYPES.PARAGRAPH);
  });
});
