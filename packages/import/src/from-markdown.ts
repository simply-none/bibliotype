/**
 * Markdown → BookDocument（复用 editor 的 Markdown 转换层）
 *
 * 依赖方向：import → editor（markdownToNodes）→ 本包 nodesToBookDocument 组装。
 * 转换在 editor 侧完成（PM 块节点），此处仅做文档级组装，不重复实现解析。
 */
import type { BookDocument, BookMetadata } from '@bibliotype/core';
import { markdownToNodes } from '@bibliotype/editor';
import type { Schema } from 'prosemirror-model';
import { nodesToBookDocument } from './book-document.js';

/**
 * 将 Markdown 文本导入为 BookDocument
 *
 * @param markdown Markdown 全文
 * @param schema 编辑器 schema
 * @param metadata 书目元数据（由调用方注入）
 */
export function markdownToBookDocument(
  markdown: string,
  schema: Schema,
  metadata: BookMetadata,
): BookDocument {
  return nodesToBookDocument(markdownToNodes(markdown, schema), schema, metadata);
}
