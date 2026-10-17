/**
 * epub → BookDocument（组合层：epub → 正文 HTML → IR）
 *
 * 依赖方向：import-epub → import（htmlToBookDocument）、core（类型）、prosemirror-model（类型）。
 * 包结构与 XHTML 解析（`epub-package`）浏览器/Node 同构、不依赖 DOM；最终 XHTML → IR 复用
 * `@bibliotype/import` 的 HTML 通路（其 `parseDOM` 规则 + `pmNodeToIr` 回收），与 docx 通路一致。
 */
import type { BookDocument, BookMetadata } from '@bibliotype/core';
import { htmlToBookDocument } from '@bibliotype/import';
import type { Schema } from 'prosemirror-model';
import { type EpubInput, type EpubToHtmlOptions, epubToHtml } from './epub-package.js';

/**
 * 将 `.epub` 字节导入为 BookDocument
 *
 * @param input epub 原始字节（浏览器 `ArrayBuffer` / Node `Uint8Array`）
 * @param schema 编辑器 schema（topNode 应为 `book`；需与后续载入的编辑器同款）
 * @param metadata 书目元数据（由调用方注入，包内不读当前时间，红线 §四.6）
 * @param options 可选的图片内联开关（默认内联为 data URI，见 EpubToHtmlOptions）
 * @throws epub 为空 / 损坏 / 无正文时抛中文 `RangeError`；HTML 回收失败时由 import 抛出
 */
export function epubToBookDocument(
  input: EpubInput,
  schema: Schema,
  metadata: BookMetadata,
  options: EpubToHtmlOptions = {},
): BookDocument {
  const html = epubToHtml(input, options);
  return htmlToBookDocument(html, schema, metadata);
}

export type { EpubInput };
