// @vitest-environment happy-dom
/**
 * @bibliotype/import-docx 测试（happy-dom 环境：docxToBookDocument 复用 import 的 DOM 解析）
 *
 * 覆盖范围（据实说明）：
 * - 端到端：以内联的最小合法 .docx 夹具（含 Heading 1 样式 + 两个正文段落）走完整链路
 *   docx → mammoth HTML → import.htmlToBookDocument → BookDocument，断言标题 / 段落回收与 metadata 确定性；
 * - 边界：docxToHtml 产出标准 HTML；空字节 / 非 zip 垃圾字节走中文 RangeError 错误路径。
 * mammoth 自身 docx→HTML 属上游能力（其仓库有完备测试），本包不重复验证其二进制解析细节。
 */
import { IR_SCHEMA_VERSION, NODE_TYPES, type BookNode } from '@bibliotype/core';
import { buildEditorSchema } from '@bibliotype/editor';
import { describe, expect, it } from 'vitest';
import { docxToHtml } from '../docx-html.js';
import { docxToBookDocument } from '../from-docx.js';

const schema = buildEditorSchema();
const metadata = { title: 'docx 导入' };

/** 最小合法 .docx：Heading 1「为政」+ 两段正文（JSZip 构造后经 mammoth 验证产出 <h1>/<p>） */
const SAMPLE_DOCX_BASE64 =
  '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';

/** base64 → Uint8Array（happy-dom / 浏览器提供 atob，避免依赖 Node Buffer） */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

const sampleDocx = base64ToBytes(SAMPLE_DOCX_BASE64);

/** 递归收集节点文本 */
function collectText(node: BookNode): string {
  if (node.type === NODE_TYPES.TEXT) {
    return node.text ?? '';
  }
  return (node.children ?? []).map(collectText).join('');
}

describe('docxToHtml', () => {
  it('最小 .docx → 标准 HTML（Heading 1 → h1，正文 → p）', async () => {
    const html = await docxToHtml(sampleDocx);
    expect(html).toContain('<h1>为政</h1>');
    expect(html).toContain('<p>子曰：为政以德，譬如北辰。</p>');
  });

  it('空字节 → 抛出指向明确的 RangeError', async () => {
    await expect(docxToHtml(new Uint8Array([]))).rejects.toThrow(/docx 数据为空/);
  });

  it('非 zip 垃圾字节 → 抛出解析失败 RangeError', async () => {
    await expect(docxToHtml(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow(/docx 解析失败/);
  });
});

describe('docxToBookDocument', () => {
  it('端到端产出合法 BookDocument：book 根含标题与段落', async () => {
    const doc = await docxToBookDocument(sampleDocx, schema, metadata);
    const children = doc.root.children ?? [];
    expect(doc.root.type).toBe(NODE_TYPES.BOOK);
    expect(children.some((c) => c.type === NODE_TYPES.HEADING)).toBe(true);
    expect(children.filter((c) => c.type === NODE_TYPES.PARAGRAPH).length).toBeGreaterThanOrEqual(2);
  });

  it('正文文本完整回收', async () => {
    const doc = await docxToBookDocument(sampleDocx, schema, metadata);
    const allText = collectText(doc.root);
    expect(allText).toContain('为政');
    expect(allText).toContain('居其所而众星共之');
  });

  it('metadata 原样注入、schemaVersion 固定（确定性红线）', async () => {
    const doc = await docxToBookDocument(sampleDocx, schema, metadata);
    expect(doc.metadata).toEqual(metadata);
    expect(doc.schemaVersion).toBe(IR_SCHEMA_VERSION);
  });

  it('空字节经组合入口同样抛错', async () => {
    await expect(docxToBookDocument(new Uint8Array([]), schema, metadata)).rejects.toThrow(/docx 数据为空/);
  });
});
