/**
 * markdownToBookDocument 测试（复用 editor 转换层，node 环境）
 */
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { describe, expect, it } from 'vitest';
import { markdownToBookDocument } from '../from-markdown.js';

const schema = buildEditorSchema();
const metadata = { title: 'MD 导入' };

/** 递归收集节点文本 */
function collectText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) {
    return node.text ?? '';
  }
  return (node.children ?? []).map(collectText).join('');
}

/** 收集某节点下文本叶子的标记名 */
function marksIn(node: BookNode): string[] {
  const out: string[] = [];
  const walk = (n: BookNode): void => {
    if (n.type === NODE_TYPES.TEXT) {
      for (const m of n.marks ?? []) {
        out.push(m.type);
      }
    }
    for (const c of n.children ?? []) {
      walk(c);
    }
  };
  walk(node);
  return out;
}

describe('markdownToBookDocument', () => {
  it('标题落到 heading（level 由 attrs 描述）', () => {
    const doc = markdownToBookDocument('# 学而时习之', schema, metadata);
    const heading = doc.root.children?.[0] as BookNode;
    expect(heading.type).toBe(NODE_TYPES.HEADING);
    expect(collectText(heading)).toBe('学而时习之');
  });

  it('列表落到 list / list-item，引用落到 quote', () => {
    const doc = markdownToBookDocument('- 甲\n- 乙\n\n> 引用内容', schema, metadata);
    const types = (doc.root.children ?? []).map((c) => c.type);
    expect(types).toContain(NODE_TYPES.LIST);
    expect(types).toContain(NODE_TYPES.QUOTE);
    const list = (doc.root.children ?? []).find((c) => c.type === NODE_TYPES.LIST) as BookNode;
    const items = list.children ?? [];
    expect(items.every((i) => i.type === NODE_TYPES.LIST_ITEM)).toBe(true);
  });

  it('粗体文本携带 strong 标记', () => {
    const doc = markdownToBookDocument('这是**重点**内容', schema, metadata);
    const paragraph = doc.root.children?.[0] as BookNode;
    expect(marksIn(paragraph)).toContain('strong');
  });

  it('metadata 原样注入（确定性，不读当前时间）', () => {
    const doc = markdownToBookDocument('正文', schema, metadata);
    expect(doc.metadata).toEqual(metadata);
    expect(doc.schemaVersion).toBe('0.3.0');
  });

  it('空 Markdown 产出空 book 根', () => {
    const doc = markdownToBookDocument('', schema, metadata);
    expect(doc.root).toEqual({ type: NODE_TYPES.BOOK });
  });
});
