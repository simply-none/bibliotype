/**
 * classical → editor 注册集成测试（D8 单向依赖）
 *
 * 验证：注册/注销生命周期（命名空间清理）、schema 可用性
 * （注疏体例嵌套、行内注与标记混排）、含古籍节点的 IR ⇄ PM 无损往返。
 */
import { describe, expect, it } from 'vitest';
import { IR_SCHEMA_VERSION, NODE_TYPES, type BookNode } from '@bibliotype/core';
import {
  BookEditor,
  EditorSpecConflictError,
  createDefaultEditorSchemaRegistry,
  irNodeToPm,
  pmNodeToIr,
} from '@bibliotype/editor';
import { CLASSICAL_MARK_TYPES } from '../mark-types.js';
import { CLASSICAL_NODE_TYPES } from '../node-types.js';
import { buildClassicalEditorSchema, registerClassicalEditorSpecs } from '../editor.js';

/** 构造含古籍体例的样本文档（注疏、校勘符号、行内注、专名号） */
function sampleRoot(): BookNode {
  return {
    type: NODE_TYPES.BOOK,
    children: [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        attrs: { title: '学而第一' },
        children: [
          {
            type: NODE_TYPES.PARAGRAPH,
            children: [
              { type: 'text', text: '子曰：' },
              {
                type: 'text',
                text: '学而',
                marks: [{ type: CLASSICAL_MARK_TYPES.PROPER_NAME }],
              },
              {
                type: CLASSICAL_NODE_TYPES.INLINE_NOTE,
                children: [{ type: 'text', text: '夹注' }],
              },
              { type: CLASSICAL_NODE_TYPES.COLLATION_MARK, attrs: { symbol: '○' } },
              { type: 'text', text: '时习之。' },
            ],
          },
          {
            type: CLASSICAL_NODE_TYPES.DOUBLE_NOTE,
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [
                  {
                    type: 'text',
                    text: '注文',
                    marks: [{ type: CLASSICAL_MARK_TYPES.PROPER_NAME }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('古籍规格注册（D8）', () => {
  it('未注册时标准 schema 不含古籍节点与标记（隔离性）', () => {
    const schema = createDefaultEditorSchemaRegistry().buildSchema();
    expect(schema.nodes[CLASSICAL_NODE_TYPES.DOUBLE_NOTE]).toBeUndefined();
    expect(schema.nodes[CLASSICAL_NODE_TYPES.SEAL]).toBeUndefined();
    expect(schema.marks[CLASSICAL_MARK_TYPES.PROPER_NAME]).toBeUndefined();
  });

  it('buildClassicalEditorSchema 注册全部 13 个古籍节点与 7 个标记', () => {
    const schema = buildClassicalEditorSchema();
    expect(Object.keys(CLASSICAL_NODE_TYPES)).toHaveLength(13);
    for (const type of Object.values(CLASSICAL_NODE_TYPES)) {
      expect(schema.nodes[type], `节点 ${type} 未注册`).toBeDefined();
    }
    expect(Object.keys(CLASSICAL_MARK_TYPES)).toHaveLength(7);
    for (const mark of Object.values(CLASSICAL_MARK_TYPES)) {
      expect(schema.marks[mark], `标记 ${mark} 未注册`).toBeDefined();
    }
  });

  it('注销函数按 classical 命名空间清理，标准规格不受影响', () => {
    const registry = createDefaultEditorSchemaRegistry();
    const unregister = registerClassicalEditorSpecs(registry);

    expect(registry.hasNode(CLASSICAL_NODE_TYPES.DOUBLE_NOTE)).toBe(true);
    expect(registry.hasMark(CLASSICAL_MARK_TYPES.NOTE_REF)).toBe(true);

    unregister();

    expect(registry.hasNode(CLASSICAL_NODE_TYPES.DOUBLE_NOTE)).toBe(false);
    expect(registry.hasMark(CLASSICAL_MARK_TYPES.NOTE_REF)).toBe(false);
    expect(registry.hasNode(NODE_TYPES.PARAGRAPH)).toBe(true);
  });

  it('重复注册抛出 EditorSpecConflictError', () => {
    const registry = createDefaultEditorSchemaRegistry();
    registerClassicalEditorSpecs(registry);
    expect(() => registerClassicalEditorSpecs(registry)).toThrow(EditorSpecConflictError);
  });
});

describe('古籍规格可用性（IR → PM）', () => {
  it('双行小注嵌套章节、夹注与专名号在段落混排', () => {
    const schema = buildClassicalEditorSchema();
    const pm = irNodeToPm(sampleRoot(), schema);

    const chapter = pm.child(0);
    expect(chapter.type.name).toBe(NODE_TYPES.CHAPTER);
    expect(chapter.attrs.id).toBe('chap-1');

    const paragraph = chapter.child(0);
    expect(paragraph.child(1).marks[0]?.type.name).toBe(CLASSICAL_MARK_TYPES.PROPER_NAME);
    expect(paragraph.child(2).type.name).toBe(CLASSICAL_NODE_TYPES.INLINE_NOTE);
    expect(paragraph.child(2).textContent).toBe('夹注');
    expect(paragraph.child(3).type.name).toBe(CLASSICAL_NODE_TYPES.COLLATION_MARK);
    expect(paragraph.child(3).attrs.symbol).toBe('○');

    const doubleNote = chapter.child(1);
    expect(doubleNote.type.name).toBe(CLASSICAL_NODE_TYPES.DOUBLE_NOTE);
    expect(doubleNote.child(0).type.name).toBe(NODE_TYPES.PARAGRAPH);
  });

  it('含古籍节点的文档 IR → PM → IR 往返无损', () => {
    const schema = buildClassicalEditorSchema();
    const root = sampleRoot();
    expect(pmNodeToIr(irNodeToPm(root, schema))).toEqual(root);
  });
});

describe('BookEditor 集成', () => {
  it('以 registry 注入古籍规格后可加载与导出古籍文档', () => {
    const registry = createDefaultEditorSchemaRegistry();
    registerClassicalEditorSpecs(registry);

    const editor = new BookEditor({
      registry,
      document: {
        schemaVersion: IR_SCHEMA_VERSION,
        metadata: { title: '论语注疏（景宋本）' },
        root: sampleRoot(),
      },
    });

    expect(editor.bookSchema.nodes[CLASSICAL_NODE_TYPES.DOUBLE_NOTE]).toBeDefined();
    expect(editor.getDocument().root).toEqual(sampleRoot());
  });

  it('直挂文本的双行注 / 校勘记经编辑树包段，容器内可取到合法光标位（回归）', () => {
    const editor = new BookEditor({
      schema: buildClassicalEditorSchema(),
      document: {
        schemaVersion: IR_SCHEMA_VERSION,
        metadata: { title: '回归样本' },
        root: {
          type: NODE_TYPES.BOOK,
          children: [
            {
              type: NODE_TYPES.CHAPTER,
              children: [
                {
                  type: CLASSICAL_NODE_TYPES.DOUBLE_NOTE,
                  children: [{ type: 'text', text: '注：収、好，皆去声。' }],
                },
                {
                  type: CLASSICAL_NODE_TYPES.COLLATION_NOTE,
                  children: [
                    { type: 'text', text: '「说」，唐石经作「悦」' },
                    { type: CLASSICAL_NODE_TYPES.COLLATION_MARK, attrs: { symbol: '○' } },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    const doc = editor.editorState.doc;
    const chapter = doc.child(0);

    /* 双行注：裸文本聚合为段落 */
    const doubleNote = chapter.child(0);
    expect(doubleNote.type.name).toBe(CLASSICAL_NODE_TYPES.DOUBLE_NOTE);
    expect(doubleNote.child(0).type.name).toBe(NODE_TYPES.PARAGRAPH);

    /* 段落内位置可作为光标落点（inlineContent）——不包段则点击会回退到容器外 */
    let textPos = -1;
    doc.descendants((node, pos) => {
      if (
        textPos === -1 &&
        node.type.name === NODE_TYPES.PARAGRAPH &&
        node.textContent.startsWith('注：')
      ) {
        textPos = pos + 1;
        return false;
      }
      return true;
    });
    expect(textPos).toBeGreaterThan(0);
    const $pos = doc.resolve(textPos);
    expect($pos.parent.type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect($pos.parent.inlineContent).toBe(true);

    /* 校勘记：文本与校勘符号聚合进同一段落（不拆段） */
    const collationNote = chapter.child(1);
    expect(collationNote.childCount).toBe(1);
    expect(collationNote.child(0).type.name).toBe(NODE_TYPES.PARAGRAPH);
    expect(collationNote.child(0).child(1).type.name).toBe(CLASSICAL_NODE_TYPES.COLLATION_MARK);

    /* 导出 IR：已规范化为块容器 + 段落 */
    const round = editor.getDocument().root;
    const roundDoubleNote = round.children?.[0]?.children?.[0];
    expect(roundDoubleNote?.type).toBe(CLASSICAL_NODE_TYPES.DOUBLE_NOTE);
    expect(roundDoubleNote?.children?.[0]?.type).toBe(NODE_TYPES.PARAGRAPH);
  });
});
