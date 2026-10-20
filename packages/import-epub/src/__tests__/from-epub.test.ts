// @vitest-environment happy-dom
/**
 * epubToBookDocument 测试（happy-dom 环境：XHTML → IR 复用 import 的 HTML 通路，需 DOM）
 *
 * 端到端「导出 ↔ 导入往返」：Markdown → BookDocument → exportEpub 字节 → epubToBookDocument，
 * 断言回收为合法 BookDocument（book 根含标题 / 段落、正文文本保留、metadata 确定性）。
 */
import { NODE_TYPES, type BookNode } from '@bibliotype/core';
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

describe('epubToBookDocument', () => {
  it('端到端产出合法 BookDocument：book 根含标题与段落', () => {
    const doc = epubToBookDocument(sampleBytes, schema, { title: '导入' });
    const children = doc.root.children ?? [];
    expect(doc.root.type).toBe(NODE_TYPES.BOOK);
    expect(children.some((c) => c.type === NODE_TYPES.HEADING)).toBe(true);
    expect(children.some((c) => c.type === NODE_TYPES.PARAGRAPH)).toBe(true);
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
    expect(doc.schemaVersion).toBe('0.2.0');
  });

  it('空字节 → 抛出指向明确的 RangeError', () => {
    expect(() => epubToBookDocument(new Uint8Array([]), schema, { title: 'x' })).toThrow(/epub 数据为空/);
  });
});
