/**
 * nodesToBookDocument 测试（纯函数，node 环境）
 */
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema, markdownToNodes } from '@bibliotype/editor';
import { describe, expect, it } from 'vitest';
import { nodesToBookDocument } from '../book-document.js';

const schema = buildEditorSchema();
const metadata = { title: '组装测试', createdAt: '2020-01-01T00:00:00.000Z' };

describe('nodesToBookDocument', () => {
  it('块节点合成 book 根，schemaVersion 与 metadata 原样注入', () => {
    const nodes = markdownToNodes('# 标题\n\n正文', schema);
    const doc = nodesToBookDocument(nodes, schema, metadata);
    expect(doc.schemaVersion).toBe('0.3.0');
    expect(doc.metadata).toEqual(metadata);
    expect(doc.root.type).toBe(NODE_TYPES.BOOK);
    expect(doc.root.children?.length).toBeGreaterThan(0);
  });

  it('空节点数组产出无 children 的 book 根（规范化省略）', () => {
    const doc = nodesToBookDocument([], schema, metadata);
    expect(doc.root).toEqual({ type: NODE_TYPES.BOOK });
  });

  it('metadata 未被改写（不注入当前时间，保证确定性）', () => {
    const doc = nodesToBookDocument(markdownToNodes('段落', schema), schema, metadata);
    expect(doc.metadata.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect('updatedAt' in doc.metadata).toBe(false);
  });

  it('产出合法 BookNode 结构：首块标题节点带文本子级', () => {
    const doc = nodesToBookDocument(markdownToNodes('# 学而', schema), schema, metadata);
    const first = doc.root.children?.[0] as BookNode;
    expect(first.type).toBe(NODE_TYPES.HEADING);
    const text = (first.children ?? [])
      .filter((c) => c.type === NODE_TYPES.TEXT)
      .map((c) => c.text ?? '')
      .join('');
    expect(text).toBe('学而');
  });
});
