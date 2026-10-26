// @vitest-environment happy-dom
/**
 * epubToBookDocument 测试（happy-dom 环境：XHTML → IR 复用 import 的 HTML 通路，需 DOM）
 *
 * 端到端「导出 ↔ 导入往返」：Markdown → BookDocument → exportEpub 字节 → epubToBookDocument，
 * 断言回收为合法 BookDocument（book 根含标题 / 段落、正文文本保留、metadata 确定性）。
 */
import { IR_SCHEMA_VERSION, NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { exportEpub } from '@bibliotype/exporter-epub';
import { markdownToBookDocument } from '@bibliotype/import';
import { describe, expect, it } from 'vitest';
import { epubToBookDocument } from '../from-epub.js';

const schema = buildEditorSchema();

/** Markdown → BookDocument → exportEpub 字节（往返夹具） */
function epubFromMarkdown(md: string, title: string): Uint8Array {
  const doc = markdownToBookDocument(md, schema, { title });
  return exportEpub(doc);
}

const sampleBytes = epubFromMarkdown(
  '# 为政\n\n子曰：为政以德，譬如北辰。\n\n居其所而众星共之。',
  '论语',
);

/** 递归收集节点文本 */
function collectText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) {
    return node.text ?? '';
  }
  return (node.children ?? []).map(collectText).join('');
}

/** 递归判定子树是否包含某类型 */
function hasType(node: BookNode, type: string): boolean {
  if (node.type === type) return true;
  return (node.children ?? []).some((c) => hasType(c, type));
}

/** 递归查找首个含指定文本的标题节点 */
function findHeading(node: BookNode, text: string): BookNode | undefined {
  if (node.type === NODE_TYPES.HEADING && collectText(node).includes(text)) return node;
  for (const c of node.children ?? []) {
    const found = findHeading(c, text);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('epubToBookDocument', () => {
  it('端到端产出合法 BookDocument：标题与段落完整回收（含卷/章结构）', () => {
    const doc = epubToBookDocument(sampleBytes, schema, { title: '导入' });
    expect(doc.root.type).toBe(NODE_TYPES.BOOK);
    /* 含 NCX 的 epub 会被结构化为 卷/章，标题与段落位于结构节点内部，需整树查找 */
    expect(hasType(doc.root, NODE_TYPES.HEADING)).toBe(true);
    expect(hasType(doc.root, NODE_TYPES.PARAGRAPH)).toBe(true);
    expect(hasType(doc.root, NODE_TYPES.VOLUME) || hasType(doc.root, NODE_TYPES.CHAPTER)).toBe(true);
  });

  it('章节标题正确回收（标题文本保留，并归入卷/章结构）', () => {
    const doc = epubToBookDocument(sampleBytes, schema, { title: '导入' });
    const heading = findHeading(doc.root, '为政');
    expect(heading).toBeDefined();
    expect(collectText(heading as BookNode)).toBe('为政');
  });

  it('正文文本完整回收', () => {
    const doc = epubToBookDocument(sampleBytes, schema, { title: '导入' });
    const allText = collectText(doc.root);
    expect(allText).toContain('为政');
    expect(allText).toContain('居其所而众星共之');
  });

  it('metadata 原样注入、schemaVersion 固定（确定性红线）', () => {
    const doc = epubToBookDocument(sampleBytes, schema, { title: '导入' });
    expect(doc.metadata).toEqual({ title: '导入' });
    expect(doc.schemaVersion).toBe(IR_SCHEMA_VERSION);
  });

  it('空字节 → 抛出指向明确的 RangeError', () => {
    expect(() => epubToBookDocument(new Uint8Array([]), schema, { title: 'x' })).toThrow(/epub 数据为空/);
  });
});
