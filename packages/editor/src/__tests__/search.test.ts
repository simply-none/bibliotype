/**
 * 编辑态查找替换测试（findTextMatches / selectRange / replaceSelectionWith / replaceAll）
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type BookDocument } from '@bibliotype/core';
import type { Transaction } from 'prosemirror-state';
import { BookEditor } from '../editor.js';
import {
  buildSearchRegExp,
  findNextMatch,
  findTextMatches,
  replaceAll,
  replaceMatch,
  replaceSelectionWith,
  selectRange,
} from '../search.js';

/** 载入若干段落文本，构造编辑器（每段一个 paragraph） */
function editorWithParagraphs(texts: readonly string[]): BookEditor {
  const doc = createDoc(texts);
  const editor = new BookEditor();
  editor.loadDocument(doc);
  return editor;
}

/** 构造顶层含多个 paragraph 的文档 */
function createDoc(texts: readonly string[]): BookDocument {
  const doc: BookDocument = {
    schemaVersion: '0.1.0',
    metadata: { title: '测试', createdAt: '2020-01-01T00:00:00.000Z' },
    root: { type: NODE_TYPES.BOOK, id: 'book-1', attrs: {}, children: [] },
  };
  doc.root.children = texts.map((text, index) => ({
    type: NODE_TYPES.PARAGRAPH,
    id: `p-${index}`,
    children: [{ type: 'text', text }],
  }));
  return doc;
}

/** 执行命令并派发生成事务（返回是否生效） */
function run(editor: BookEditor, command: ReturnType<typeof replaceAll>): boolean {
  let transaction: Transaction | null = null;
  const applied = command(editor.editorState, (tr) => {
    transaction = tr;
  });
  if (applied && transaction !== null) {
    editor.dispatch(transaction);
  }
  return applied;
}

/** 提取全文纯文本（逐段以 / 连接，便于断言） */
function plainText(editor: BookEditor): string {
  return (
    editor.getDocument().root.children
      ?.map((block) => block.children?.map((child) => child.text ?? '').join('') ?? '')
      .join(' / ') ?? ''
  );
}

describe('findTextMatches', () => {
  it('命中字面区间，逐段累计', () => {
    const editor = editorWithParagraphs(['子曰：学而时习之。', '学而篇第一。']);
    const matches = findTextMatches(editor.editorState.doc, '学而');
    expect(matches).toHaveLength(2);
    matches.forEach((match) => {
      expect(match.to - match.from).toBe(2);
    });
  });

  it('空查询返回空数组', () => {
    const editor = editorWithParagraphs(['子曰']);
    expect(findTextMatches(editor.editorState.doc, '')).toHaveLength(0);
  });

  it('默认大小写不敏感，caseSensitive 时严格匹配', () => {
    const editor = editorWithParagraphs(['Abc ABC abc']);
    expect(findTextMatches(editor.editorState.doc, 'abc')).toHaveLength(3);
    expect(findTextMatches(editor.editorState.doc, 'abc', true)).toHaveLength(1);
  });
});

describe('findTextMatches（增强）', () => {
  it('正则模式：按模式命中，非法正则返回空', () => {
    const editor = editorWithParagraphs(['第1章 学而', '第2章 为政']);
    expect(findTextMatches(editor.editorState.doc, '第\\d章', { regex: true })).toHaveLength(2);
    expect(findTextMatches(editor.editorState.doc, '第[章', { regex: true })).toHaveLength(0);
    expect(() => buildSearchRegExp('第[章', { regex: true })).toThrow(SyntaxError);
  });

  it('整词匹配只跳过拉丁词内匹配', () => {
    const editor = editorWithParagraphs(['cat category cat.', '学而学而']);
    expect(findTextMatches(editor.editorState.doc, 'cat')).toHaveLength(3);
    expect(findTextMatches(editor.editorState.doc, 'cat', { wholeWord: true })).toHaveLength(2);
    // 中文无词边界，整词开关不影响子串匹配
    expect(
      findTextMatches(editor.editorState.doc, '学而', { wholeWord: true }),
    ).toHaveLength(2);
  });

  it('范围限定与结果上限', () => {
    const editor = editorWithParagraphs(['学而时习之', '学而篇第一', '学而第三']);
    const doc = editor.editorState.doc;
    const all = findTextMatches(doc, '学而');
    expect(all).toHaveLength(3);

    const scoped = findTextMatches(doc, '学而', {
      range: { from: all[1]!.from, to: all[2]!.from + 10 },
    });
    expect(scoped).toHaveLength(2);
    expect(findTextMatches(doc, '学而', { limit: 2 })).toHaveLength(2);
  });

  it('findNextMatch 支持前进 / 后退循环', () => {
    const editor = editorWithParagraphs(['学而时习之', '学而篇第一']);
    const doc = editor.editorState.doc;
    const first = findNextMatch(doc, '学而', 0);
    expect(first).toBeDefined();
    const second = findNextMatch(doc, '学而', first!.from + 1);
    expect(second!.from).toBeGreaterThan(first!.from);
    expect(findNextMatch(doc, '学而', second!.from + 1)).toBeUndefined();
    expect(findNextMatch(doc, '学而', second!.from, undefined, true)).toEqual(first);
  });
});

describe('selectRange', () => {
  it('选中文档中给定区间', () => {
    const editor = editorWithParagraphs(['子曰：学而时习之。']);
    const [match] = findTextMatches(editor.editorState.doc, '学而');
    expect(match).toBeDefined();
    expect(run(editor, selectRange(match!))).toBe(true);
    const { from, to } = editor.editorState.selection;
    expect(from).toBe(match!.from);
    expect(to).toBe(match!.to);
  });
});

describe('replaceSelectionWith', () => {
  it('替换当前选中区间为给定文本', () => {
    const editor = editorWithParagraphs(['子曰：学而时习之。']);
    const [match] = findTextMatches(editor.editorState.doc, '学而');
    run(editor, selectRange(match!));
    expect(run(editor, replaceSelectionWith('思'))).toBe(true);
    expect(plainText(editor)).toBe('子曰：思时习之。');
  });

  it('空选区时不生效', () => {
    const editor = editorWithParagraphs(['子曰']);
    expect(run(editor, replaceSelectionWith('x'))).toBe(false);
  });
});

describe('replaceAll', () => {
  it('替换所有命中（跨段）', () => {
    const editor = editorWithParagraphs(['学而时习之', '不亦说乎学而']);
    expect(run(editor, replaceAll('学而', 'X'))).toBe(true);
    expect(plainText(editor)).toBe('X时习之 / 不亦说乎X');
  });

  it('replacement 为空即删除命中', () => {
    const editor = editorWithParagraphs(['aaa bbb aaa']);
    expect(run(editor, replaceAll('aaa', ''))).toBe(true);
    expect(plainText(editor)).toBe(' bbb ');
  });

  it('无命中 / 空查询不派发生效', () => {
    const editor = editorWithParagraphs(['子曰']);
    expect(run(editor, replaceAll('诗', 'X'))).toBe(false);
    expect(run(editor, replaceAll('', 'X'))).toBe(false);
  });

  it('正则 / 整词选项透传到查找', () => {
    const editor = editorWithParagraphs(['第1章 学而', '第2章 为政']);
    expect(run(editor, replaceAll('第\\d章', '#', { regex: true }))).toBe(true);
    expect(plainText(editor)).toBe('# 学而 / # 为政');

    const latin = editorWithParagraphs(['cat category']);
    expect(run(latin, replaceAll('cat', 'dog', { wholeWord: true }))).toBe(true);
    expect(plainText(latin)).toBe('dog category');
  });
});

describe('replaceMatch', () => {
  it('只替换指定的一处匹配', () => {
    const editor = editorWithParagraphs(['学而时习之', '学而篇第一']);
    const matches = findTextMatches(editor.editorState.doc, '学而');
    expect(run(editor, replaceMatch(matches[1]!, 'X'))).toBe(true);
    expect(plainText(editor)).toBe('学而时习之 / X篇第一');
  });

  it('非法区间不生效', () => {
    const editor = editorWithParagraphs(['学而']);
    expect(run(editor, replaceMatch({ from: 5, to: 5 }, 'X'))).toBe(false);
    expect(run(editor, replaceMatch({ from: 0, to: 9999 }, 'X'))).toBe(false);
  });
});
