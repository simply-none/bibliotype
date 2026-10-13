/**
 * schema 注册表与标准规格表测试
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import { buildEditorSchema, createDefaultEditorSchemaRegistry } from '../default-schema.js';
import {
  EditorSchemaRegistry,
  EditorSpecConflictError,
} from '../schema-registry.js';

describe('默认 schema', () => {
  it('以 book 为根并登记全部标准节点与标记', () => {
    const schema = buildEditorSchema();
    expect(schema.topNodeType.name).toBe(NODE_TYPES.BOOK);

    for (const type of Object.values(NODE_TYPES)) {
      expect(schema.nodes[type], `节点 ${type} 未登记`).toBeDefined();
    }
    for (const type of Object.values(MARK_TYPES)) {
      expect(schema.marks[type], `标记 ${type} 未登记`).toBeDefined();
    }
  });

  it('可创建合法嵌套结构（书 > 卷 > 章 > 标题/段落）', () => {
    const schema = buildEditorSchema();
    const heading = schema.node('heading', { level: 1 }, schema.text('学而第一'));
    const paragraph = schema.node('paragraph', null, schema.text('学而时习之'));
    const chapter = schema.node('chapter', { title: '学而第一' }, [heading, paragraph]);
    const book = schema.node('book', null, [schema.node('volume', null, [chapter])]);

    expect(book.textContent).toBe('学而第一学而时习之');
  });

  it('段落可混排行内公式与文本（inline group）', () => {
    const schema = buildEditorSchema();
    const formula = schema.nodes['math-inline'].create({ tex: 'x^2' });
    const paragraph = schema.node('paragraph', null, [schema.text('公式 '), formula]);
    expect(paragraph.childCount).toBe(2);
  });

  it('未提供 toDOM / parseDOM 的规格获得默认 DOM 表现（bt- 类名约定）', () => {
    const schema = buildEditorSchema();
    const paragraph = schema.nodes[NODE_TYPES.PARAGRAPH];
    expect(paragraph?.spec.toDOM).toBeDefined();
    expect(paragraph?.spec.parseDOM?.[0]?.tag).toBe('div.bt-paragraph');

    const strong = schema.marks[MARK_TYPES.STRONG];
    expect(strong?.spec.toDOM).toBeDefined();
    expect(strong?.spec.parseDOM?.[0]?.tag).toBe('span.bt-strong');
  });

  it('默认 toDOM 将节点属性输出为 data-*（与序列化器对齐，供书册样式定向）', () => {
    const schema = buildEditorSchema();

    // 未声明属性经 rawAttrs 兜底 → 展开为 data-role
    const cover = schema.node(NODE_TYPES.PARAGRAPH, { rawAttrs: { role: 'cover-title' } }, schema.text('论语集解'));
    const coverDom = cover.type.spec.toDOM!(cover) as [string, Record<string, string>, number];
    expect(coverDom[1]['data-role']).toBe('cover-title');
    expect(coverDom[1]['class']).toBe('bt-paragraph');

    // 声明属性非默认值 → data-level；等于默认值 → 规范化省略
    const h2 = schema.node(NODE_TYPES.HEADING, { level: 2 }, schema.text('章'));
    const h2Dom = h2.type.spec.toDOM!(h2) as [string, Record<string, string>, number];
    expect(h2Dom[1]['data-level']).toBe('2');
    const h1 = schema.node(NODE_TYPES.HEADING, { level: 1 }, schema.text('章'));
    const h1Dom = h1.type.spec.toDOM!(h1) as [string, Record<string, string>, number];
    expect(h1Dom[1]['data-level']).toBeUndefined();
  });
});

describe('EditorSchemaRegistry', () => {
  it('注册自定义节点后可在 schema 中使用', () => {
    const registry = createDefaultEditorSchemaRegistry();
    registry.registerNode({
      type: 'custom-box',
      namespace: 'test',
      spec: { group: 'block', content: 'block*' },
    });

    const schema = registry.buildSchema();
    const box = schema.node('custom-box', null, [schema.node('paragraph', null, schema.text('注'))]);
    const book = schema.node('book', null, [box]);
    expect(book.childCount).toBe(1);
  });

  it('重复注册抛出 EditorSpecConflictError', () => {
    const registry = createDefaultEditorSchemaRegistry();
    expect(() => registry.registerNode({ type: NODE_TYPES.PARAGRAPH, spec: {} })).toThrow(
      EditorSpecConflictError,
    );
    expect(() => registry.registerMark({ type: MARK_TYPES.STRONG, spec: {} })).toThrow(
      EditorSpecConflictError,
    );
  });

  it('registerAll 原子：任一冲突则整体回滚', () => {
    const registry = new EditorSchemaRegistry();
    expect(() =>
      registry.registerAll({
        nodes: [
          { type: 'a-node', spec: {} },
          { type: 'b-node', spec: {} },
          { type: 'a-node', spec: {} }, // 内部冲突
        ],
      }),
    ).toThrow(EditorSpecConflictError);

    expect(registry.hasNode('a-node')).toBe(false);
    expect(registry.hasNode('b-node')).toBe(false);
  });

  it('支持单个注销与按命名空间注销（节点 + 标记）', () => {
    const registry = new EditorSchemaRegistry();
    registry.registerAll({
      nodes: [
        { type: 'x-1', spec: {}, namespace: 'demo' },
        { type: 'x-2', spec: {}, namespace: 'demo' },
      ],
      marks: [{ type: 'm-1', spec: {}, namespace: 'demo' }],
    });

    expect(registry.unregisterNode('x-1')).toBe(true);
    expect(registry.unregisterNode('x-1')).toBe(false);

    // 剩余 x-2 + m-1 一并注销
    expect(registry.unregisterByNamespace('demo')).toBe(2);
    expect(registry.hasNode('x-2')).toBe(false);
    expect(registry.hasMark('m-1')).toBe(false);
  });

  it('根节点未注册时 buildSchema 抛错', () => {
    const registry = new EditorSchemaRegistry();
    registry.registerNode({ type: 'only-node', spec: {} });
    expect(() => registry.buildSchema()).toThrow(RangeError);
  });
});
