/**
 * 编辑命令与插件测试（无视图状态机路径）
 *
 * 通过 BookEditor（EditorState + dispatch）执行命令，
 * 断言 IR 往返后的文档形态与历史行为。
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import type { Mark, Node as PmNode } from 'prosemirror-model';
import { TextSelection, type Command } from 'prosemirror-state';
import {
  insertAtomicNode,
  insertBlockAfterSelection,
  insertCodeBlock,
  insertImage,
  insertTable,
  redoCommand,
  setHeadingLevel,
  setLink,
  setMarkAttrs,
  setNodeAttrs,
  setParagraph,
  tableAddRow,
  toggleBulletList,
  toggleMarkByName,
  toggleMarkOfType,
  toggleOrderedList,
  toggleQuote,
  undoCommand,
  unsetLink,
} from '../commands.js';
import { BookEditor } from '../editor.js';
import { createBookEditorKeymap, createBookEditorPlugins } from '../plugins.js';
import { buildEditorSchema } from '../default-schema.js';

/** 构造样本文档：卷 > 章 > 段落 */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.VOLUME,
      id: 'vol-1',
      attrs: { title: '卷一' },
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-1',
          attrs: { title: '学而第一' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰：学而时习之。' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

/** 创建带插件（history + keymap）的编辑器 */
function createEditor(): BookEditor {
  const schema = buildEditorSchema();
  return new BookEditor({
    schema,
    document: sampleDoc(),
    plugins: createBookEditorPlugins(schema),
  });
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

/** 选中首个文本节点全部内容 */
function selectFirstText(editor: BookEditor): void {
  const { from, to } = firstTextRange(editor);
  const state = editor.editorState;
  editor.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

/** 执行命令并派发事务 */
function run(editor: BookEditor, command: Command): boolean {
  return command(editor.editorState, (tr) => editor.dispatch(tr));
}

/** 文档首个叶块（卷 > 章 > 块） */
function firstLeafBlock(editor: BookEditor): BookDocument['root']['children'] | undefined {
  return editor.getDocument().root.children?.[0]?.children?.[0]?.children;
}

/** 收集节点树中所有文本文本的 marks（深度优先） */
function collectTextMarks(pm: PmNode): readonly Mark[] {
  const marks: Mark[] = [];
  pm.descendants((node) => {
    if (node.isText) {
      marks.push(...node.marks);
    }
    return true;
  });
  return marks;
}

/** 章节点（卷 > 章） */
function chapterNode(editor: BookEditor): BookDocument['root']['children'] | undefined {
  return editor.getDocument().root.children?.[0]?.children;
}

describe('编辑命令', () => {
  it('toggleMarkOfType：对选中文本应用 / 取消 strong 标记', () => {
    const editor = createEditor();
    selectFirstText(editor);
    const strong = editor.bookSchema.marks[MARK_TYPES.STRONG];
    expect(strong).toBeDefined();

    expect(run(editor, toggleMarkOfType(strong!))).toBe(true);
    expect(collectTextMarks(editor.editorState.doc).map((mark) => mark.type.name)).toContain(
      MARK_TYPES.STRONG,
    );

    const root = editor.getDocument().root;
    const paragraph = root.children?.[0]?.children?.[0]?.children?.[0];
    expect(paragraph?.type).toBe(NODE_TYPES.PARAGRAPH);
    expect(paragraph?.children?.[0]?.marks?.[0]?.type).toBe(MARK_TYPES.STRONG);

    // 再次执行撤销标记
    expect(run(editor, toggleMarkOfType(strong!))).toBe(true);
    expect(collectTextMarks(editor.editorState.doc)).toHaveLength(0);
  });

  it('setHeadingLevel / setParagraph：段落与标题互转', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, setHeadingLevel(2))).toBe(true);
    const heading = firstLeafBlock(editor)?.[0];
    expect(heading?.type).toBe(NODE_TYPES.HEADING);
    expect(heading?.attrs?.level).toBe(2);

    expect(run(editor, setParagraph())).toBe(true);
    expect(firstLeafBlock(editor)?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('toggleQuote：包裹引用与提升回退', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, toggleQuote())).toBe(true);
    let blocks = firstLeafBlock(editor);
    expect(blocks?.[0]?.type).toBe(NODE_TYPES.QUOTE);
    expect(blocks?.[0]?.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);

    expect(run(editor, toggleQuote())).toBe(true);
    blocks = firstLeafBlock(editor);
    expect(blocks?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('toggleBulletList：包裹为列表与退出列表', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, toggleBulletList())).toBe(true);
    let blocks = firstLeafBlock(editor);
    expect(blocks?.[0]?.type).toBe(NODE_TYPES.LIST);
    expect(blocks?.[0]?.children?.[0]?.type).toBe(NODE_TYPES.LIST_ITEM);

    expect(run(editor, toggleBulletList())).toBe(true);
    blocks = firstLeafBlock(editor);
    expect(blocks?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('insertBlockAfterSelection：叶块之后插入容器（含空段落）且光标进入新块', () => {
    const editor = createEditor();
    selectFirstText(editor);

    const schema = editor.bookSchema;
    expect(run(editor, insertBlockAfterSelection(schema, NODE_TYPES.FOOTNOTE))).toBe(true);

    const blocks = firstLeafBlock(editor);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[1]?.type).toBe(NODE_TYPES.FOOTNOTE);
    expect(blocks?.[1]?.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);

    // 光标位于新块内（祖先链含 footnote）
    const footnoteType = schema.nodes[NODE_TYPES.FOOTNOTE];
    const { $from } = editor.editorState.selection;
    let inside = false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type === footnoteType) {
        inside = true;
      }
    }
    expect(inside).toBe(true);
  });

  it('setNodeAttrs：修改祖先章的声明属性 title（id 不变）', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, setNodeAttrs(NODE_TYPES.CHAPTER, { title: '为新题名' }))).toBe(true);
    const chapter = chapterNode(editor)?.[0];
    expect(chapter?.type).toBe(NODE_TYPES.CHAPTER);
    expect(chapter?.id).toBe('chap-1');
    expect(chapter?.attrs?.title).toBe('为新题名');
  });

  it('setNodeAttrs：未声明属性经 rawAttrs 兜底往返，null 可清除', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, setNodeAttrs(NODE_TYPES.PARAGRAPH, { audience: '初学' }))).toBe(true);
    let paragraph = firstLeafBlock(editor)?.[0];
    expect(paragraph?.attrs?.audience).toBe('初学');

    expect(run(editor, setNodeAttrs(NODE_TYPES.PARAGRAPH, { audience: null }))).toBe(true);
    paragraph = firstLeafBlock(editor)?.[0];
    expect(paragraph?.attrs?.audience).toBeUndefined();
  });

  it('setNodeAttrs：选区不在目标类型内 / 类型未注册时返回 false', () => {
    const editor = createEditor();
    selectFirstText(editor);

    // heading 已注册但选区祖先链内无标题
    expect(run(editor, setNodeAttrs(NODE_TYPES.HEADING, { level: 2 }))).toBe(false);
    // 未注册类型
    expect(run(editor, setNodeAttrs('no-such-node', { title: 'x' }))).toBe(false);
  });

  it('setMarkAttrs：更新选区内 ruby 标记的注文 text', () => {
    const editor = createEditor();
    selectFirstText(editor);
    const ruby = editor.bookSchema.marks[MARK_TYPES.RUBY];
    expect(ruby).toBeDefined();

    expect(run(editor, toggleMarkOfType(ruby!, { text: '旧注' }))).toBe(true);
    expect(run(editor, setMarkAttrs(MARK_TYPES.RUBY, { text: '新注' }))).toBe(true);

    const paragraph = firstLeafBlock(editor)?.[0];
    const mark = paragraph?.children?.[0]?.marks?.[0];
    expect(mark?.type).toBe(MARK_TYPES.RUBY);
    expect(mark?.attrs?.text).toBe('新注');
  });

  it('setMarkAttrs：选区无该标记实例时返回 false', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, setMarkAttrs(MARK_TYPES.STRONG, { text: 'x' }))).toBe(false);
    expect(run(editor, setMarkAttrs('no-such-mark', { text: 'x' }))).toBe(false);
  });

  it('toggleOrderedList / toggleMarkByName：有序列表切换与按名标记切换', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, toggleOrderedList())).toBe(true);
    expect(firstLeafBlock(editor)?.[0]?.attrs?.ordered).toBe(true);

    // 同为列表类型：退出列表
    expect(run(editor, toggleOrderedList())).toBe(true);
    expect(firstLeafBlock(editor)?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);

    // 按名切换标记与未知名
    expect(run(editor, toggleMarkByName(MARK_TYPES.STRIKETHROUGH))).toBe(true);
    expect(collectTextMarks(editor.editorState.doc).map((m) => m.type.name)).toContain(
      MARK_TYPES.STRIKETHROUGH,
    );
    expect(run(editor, toggleMarkByName('no-such-mark'))).toBe(false);
  });

  it('setLink / unsetLink：选区加链、换 href、移除', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, setLink('https://example.com'))).toBe(true);
    const linkMark = () =>
      collectTextMarks(editor.editorState.doc).find((m) => m.type.name === MARK_TYPES.LINK);
    expect(linkMark()?.attrs?.href).toBe('https://example.com');

    // 已有实例时更新 href
    expect(run(editor, setLink('https://example.org'))).toBe(true);
    expect(linkMark()?.attrs?.href).toBe('https://example.org');

    // 空 href 不可用
    expect(run(editor, setLink(''))).toBe(false);

    expect(run(editor, unsetLink())).toBe(true);
    expect(linkMark()).toBeUndefined();
  });

  it('insertImage：光标处插入带占位 src 的图片，未注册类型返回 false', () => {
    const editor = createEditor();
    selectFirstText(editor);
    const { to } = firstTextRange(editor);
    editor.dispatch(
      editor.editorState.tr.setSelection(TextSelection.create(editor.editorState.doc, to)),
    );

    expect(run(editor, insertImage({ alt: '插图' }))).toBe(true);
    const image = firstLeafBlock(editor)?.[1];
    expect(image?.type).toBe(NODE_TYPES.IMAGE);
    expect(image?.attrs?.alt).toBe('插图');
    expect(typeof image?.attrs?.src).toBe('string');

    expect(run(editor, insertAtomicNode('no-such-node'))).toBe(false);
  });

  it('insertCodeBlock：叶块后插入代码块且光标进入块内', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, insertCodeBlock('ts'))).toBe(true);
    const blocks = firstLeafBlock(editor);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[1]?.type).toBe(NODE_TYPES.CODE_BLOCK);
    expect(blocks?.[1]?.attrs?.language).toBe('ts');
    expect(editor.editorState.selection.$from.parent.type.name).toBe(NODE_TYPES.CODE_BLOCK);
  });

  it('insertTable / tableAddRow：插入表格与追加行', () => {
    const editor = createEditor();
    selectFirstText(editor);

    expect(run(editor, insertTable(2, 3))).toBe(true);
    const blocks = firstLeafBlock(editor);
    expect(blocks).toHaveLength(2);
    expect(blocks?.[1]?.type).toBe(NODE_TYPES.TABLE);
    expect(blocks?.[1]?.children).toHaveLength(2);
    expect(blocks?.[1]?.children?.[0]?.children).toHaveLength(3);

    // 光标移入首单元格：表格紧随原叶块，从其开标签处 near 前探即落入首格段落
    const { to } = firstTextRange(editor);
    const $table = TextSelection.near(editor.editorState.doc.resolve(to + 1));
    editor.dispatch(editor.editorState.tr.setSelection($table));
    expect(run(editor, tableAddRow())).toBe(true);
    const table = firstLeafBlock(editor)?.[1];
    expect(table?.type).toBe(NODE_TYPES.TABLE);
    expect(table?.children).toHaveLength(3);
  });

  it('undo / redo：历史回退与重放', () => {
    const editor = createEditor();
    const before = editor.getDocument();
    const { from } = firstTextRange(editor);

    editor.dispatch(editor.editorState.tr.insertText('注', from));
    expect(editor.getDocument()).not.toEqual(before);

    expect(run(editor, undoCommand)).toBe(true);
    expect(editor.getDocument()).toEqual(before);

    expect(run(editor, redoCommand)).toBe(true);
    expect(editor.getDocument()).not.toEqual(before);
  });
});

describe('编辑插件与键位', () => {
  it('createBookEditorKeymap：包含标记 / 历史 / 段落级别绑定', () => {
    const schema = buildEditorSchema();
    const bindings = createBookEditorKeymap(schema);

    expect(bindings['Mod-b']).toBeDefined();
    expect(bindings['Mod-i']).toBeDefined();
    expect(bindings['Mod-u']).toBeDefined();
    expect(bindings['Mod-z']).toBeDefined();
    expect(bindings['Shift-Mod-z']).toBeDefined();
    expect(bindings['Mod-Alt-0']).toBeDefined();
    expect(bindings['Mod-Alt-3']).toBeDefined();
    expect(bindings['Enter']).toBeDefined();
  });

  it('createBookEditorPlugins：返回 history、keymap 与粘贴增强插件', () => {
    const schema = buildEditorSchema();
    const plugins = createBookEditorPlugins(schema);
    expect(plugins).toHaveLength(3);
    // history 插件提供 state 字段；keymap 与粘贴插件提供 props
    expect(plugins[0]?.spec.state).toBeDefined();
    expect(plugins[1]?.spec.props).toBeDefined();
    // 粘贴插件注册 handlePaste（接管 Markdown 纯文本粘贴）
    expect((plugins[2]?.spec.props as { handlePaste?: unknown } | undefined)?.handlePaste).toBeInstanceOf(Function);
  });

  it('BookEditor 携带插件后仍可正常载入与导出文档', () => {
    const editor = createEditor();
    editor.loadDocument(sampleDoc());
    expect(editor.getDocument()).toEqual(sampleDoc());
  });
});
