// @vitest-environment happy-dom
/**
 * htmlToBookDocument 测试（标准 HTML → IR，happy-dom 环境）
 *
 * 覆盖方案 A 承诺：外部标准 HTML（p / h1-6 / ul / li / blockquote / strong / em / a）
 * 经 core/editor 扩充的 parseDOM 规则映射为合法 BookDocument。
 */
import { IR_SCHEMA_VERSION, NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { describe, expect, it } from 'vitest';
import { htmlToBookDocument } from '../from-html.js';

const schema = buildEditorSchema();
const metadata = { title: 'HTML 导入' };

/** 递归收集节点文本 */
function collectText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) {
    return node.text ?? '';
  }
  return (node.children ?? []).map(collectText).join('');
}

describe('htmlToBookDocument', () => {
  it('段落与标题映射为对应 IR 节点', () => {
    const doc = htmlToBookDocument('<h2>为政</h2><p>子曰：为政以德。</p>', schema, metadata);
    const children = doc.root.children ?? [];
    expect(doc.root.type).toBe(NODE_TYPES.BOOK);
    expect(children.some((c) => c.type === NODE_TYPES.HEADING)).toBe(true);
    expect(children.some((c) => c.type === NODE_TYPES.PARAGRAPH)).toBe(true);
  });

  it('列表与引用映射为 list / quote', () => {
    const doc = htmlToBookDocument('<ul><li>甲</li><li>乙</li></ul><blockquote>引用</blockquote>', schema, metadata);
    const types = (doc.root.children ?? []).map((c) => c.type);
    expect(types).toContain(NODE_TYPES.LIST);
    expect(types).toContain(NODE_TYPES.QUOTE);
  });

  it('粗体文本携带 strong 标记', () => {
    const doc = htmlToBookDocument('<p>这是<strong>重点</strong></p>', schema, metadata);
    const paragraph = (doc.root.children ?? [])[0] as BookNode;
    const hasStrong = (paragraph.children ?? []).some(
      (c) => c.type === NODE_TYPES.TEXT && (c.marks ?? []).some((m) => m.type === 'strong'),
    );
    expect(hasStrong).toBe(true);
    expect(collectText(paragraph)).toBe('这是重点');
  });

  it('表格：thead/th 识别为表头行，colspan / rowspan / 对齐不丢', () => {
    const doc = htmlToBookDocument(
      '<table><thead><tr><th>名称</th><th>值</th></tr></thead>' +
        '<tbody><tr><td colspan="2" rowspan="3" data-align="center">合并</td></tr></tbody></table>',
      schema,
      metadata,
    );
    const table = (doc.root.children ?? [])[0] as BookNode;
    expect(table.type).toBe(NODE_TYPES.TABLE);
    const rows = table.children ?? [];
    expect(rows[0]?.attrs?.['header']).toBe(true);
    const merged = rows[1]?.children?.[0];
    expect(merged?.attrs).toMatchObject({ colspan: 2, rowspan: 3, align: 'center' });
    expect(collectText(merged as BookNode)).toBe('合并');
  });

  it('表格：无 thead 时按 th 是否存在判定表头', () => {
    const doc = htmlToBookDocument(
      '<table><tr><th>甲</th></tr><tr><td>乙</td></tr></table>',
      schema,
      metadata,
    );
    const rows = ((doc.root.children ?? [])[0] as BookNode).children ?? [];
    expect(rows[0]?.attrs?.['header']).toBe(true);
    expect(rows[1]?.attrs?.['header']).toBeUndefined();
  });

  it('注入 container 时忽略 html 字符串（Node / epub 复用路径）', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>注入容器</p>';
    const doc = htmlToBookDocument('<p>被忽略</p>', schema, metadata, container);
    const paragraph = (doc.root.children ?? [])[0] as BookNode;
    expect(collectText(paragraph)).toBe('注入容器');
  });

  it('metadata 原样注入，schemaVersion 固定', () => {
    const doc = htmlToBookDocument('<p>正文</p>', schema, metadata);
    expect(doc.metadata).toEqual(metadata);
    expect(doc.schemaVersion).toBe(IR_SCHEMA_VERSION);
  });
});
