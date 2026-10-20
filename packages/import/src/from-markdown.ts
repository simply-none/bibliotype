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
import { parseFrontMatter } from './front-matter.js';

/**
 * 合并 front-matter 与调用方元数据
 *
 * 规则：调用方显式值优先；调用方未提供（或书名 / 语言 / 作者为空）时用
 * front-matter 补位。嵌套对象做浅合并，避免整块覆盖。
 */
function mergeMetadata(
  fromFrontMatter: Partial<BookMetadata>,
  explicit: BookMetadata,
): BookMetadata {
  const title =
    explicit.title.trim() !== '' ? explicit.title : (fromFrontMatter.title ?? explicit.title);
  const publication =
    fromFrontMatter.publication === undefined && explicit.publication === undefined
      ? undefined
      : { ...fromFrontMatter.publication, ...explicit.publication };
  const extra =
    fromFrontMatter.extra === undefined && explicit.extra === undefined
      ? undefined
      : { ...fromFrontMatter.extra, ...explicit.extra };

  const merged: BookMetadata = {
    ...fromFrontMatter,
    ...explicit,
    title,
    ...(publication === undefined ? {} : { publication }),
    ...(extra === undefined ? {} : { extra }),
  };

  /* 显式空数组视为「清空」，否则用 front-matter 补位 */
  if (explicit.contributors === undefined || explicit.contributors.length === 0) {
    if (fromFrontMatter.contributors !== undefined) {
      merged.contributors = fromFrontMatter.contributors;
    }
  }
  if (explicit.language === undefined || explicit.language === '') {
    if (fromFrontMatter.language !== undefined) merged.language = fromFrontMatter.language;
  }
  return merged;
}

/**
 * 将 Markdown 文本导入为 BookDocument
 *
 * 开头 `---` 包裹的 front-matter 会被解析并剥离：其中字段用于补全书目元数据，
 * 调用方显式传入的 `metadata` 优先。
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
  const { metadata: fromFrontMatter, body } = parseFrontMatter(markdown);
  const merged = mergeMetadata(fromFrontMatter, metadata);
  return nodesToBookDocument(markdownToNodes(body, schema), schema, merged);
}
