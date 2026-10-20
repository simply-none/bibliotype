/**
 * docx → BookDocument（组合层：docx → HTML → IR）
 *
 * 依赖方向：import-docx → import（htmlToBookDocument）、core（类型）、prosemirror-model（类型）。
 * 本包不自建文档组装逻辑：二进制经 `docxToHtml` 归一为标准 HTML 后，
 * 直接复用 `@bibliotype/import` 的 HTML 通路（其 `parseDOM` 规则 + `pmNodeToIr` 回收）产出 BookDocument。
 */
import type { BookDocument, BookMetadata, NamedStyleSet } from '@bibliotype/core';
import { htmlToBookDocument } from '@bibliotype/import';
import type { Schema } from 'prosemirror-model';
import { docxToHtml, type DocxInput, type DocxToHtmlOptions } from './docx-html.js';
import { parseDocxStyleInfo } from './docx-styles.js';

/**
 * 将 `.docx` 字节导入为 BookDocument
 *
 * @param input docx 原始字节（浏览器 `ArrayBuffer` / Node `Uint8Array`·`Buffer`）
 * @param schema 编辑器 schema（topNode 应为 `book`；需与后续载入的编辑器同款）
 * @param metadata 书目元数据（由调用方注入，包内不读当前时间，红线 §四.6）
 * @param options 可选样式映射与图片策略（透传给 `docxToHtml`）
 * @throws docx 为空 / 损坏 / 无正文时抛中文 `RangeError`；HTML 回收失败时由 import 抛出
 */
export async function docxToBookDocument(
  input: DocxInput,
  schema: Schema,
  metadata: BookMetadata,
  options: DocxToHtmlOptions = {},
): Promise<BookDocument> {
  const html = await docxToHtml(input, options);
  return htmlToBookDocument(html, schema, metadata);
}

/** DOCX 导入结果（文档 + 正文实际用到的命名样式） */
export interface DocxImportResult {
  document: BookDocument;
  /** 供宿主合并进书籍样式设置；未引用样式已过滤 */
  namedStyles: NamedStyleSet;
}

/**
 * 将 `.docx` 导入为 BookDocument，并返回命名样式
 *
 * 相比 `docxToBookDocument`，额外解析 `word/styles.xml`：
 * - 段落带上 `rawAttrs.styleId`（渲染 / 导出沿用命名样式 CSS 链路）；
 * - 返回正文实际引用的 `<code>NamedStyleSet</code>`，由宿主决定是否并入书籍样式设置。
 *
 * @param input docx 原始字节
 * @param schema 编辑器 schema
 * @param metadata 书目元数据（调用方注入）
 * @param options 可选样式映射与图片策略（用户 styleMap 优先于自动生成的规则）
 */
export async function docxToBookDocumentWithStyles(
  input: DocxInput,
  schema: Schema,
  metadata: BookMetadata,
  options: DocxToHtmlOptions = {},
): Promise<DocxImportResult> {
  const styleInfo = parseDocxStyleInfo(input);
  const userStyleMap =
    options.styleMap === undefined
      ? []
      : Array.isArray(options.styleMap)
        ? options.styleMap
        : [options.styleMap];

  const html = await docxToHtml(input, {
    ...options,
    styleMap: [...userStyleMap, ...styleInfo.styleMap],
  });
  return {
    document: htmlToBookDocument(html, schema, metadata),
    namedStyles: styleInfo.namedStyles,
  };
}
