/**
 * 索引词采集（K4）：xref 出口
 *
 * 采集与附录构造在 `@bibliotype/core`（导出器只能依赖 core/layout/reader），
 * 本模块只把「两遍排版的页码索引」接进采集器，保持 xref 的既有分工。
 */
import { buildIndexEntries, type BuildIndexEntriesOptions, type BookDocument, type BookNode, type IndexEntry } from '@bibliotype/core';
import type { PageIndex } from './types.js';

export { buildIndexAppendix, collectIndexTerms, formatIndexRanges } from '@bibliotype/core';
export type {
  BuildIndexAppendixOptions,
  IndexEntry,
  IndexTermOccurrence,
} from '@bibliotype/core';

/**
 * 用两遍排版的页码索引聚合索引条目
 *
 * @param document 书籍文档（或正文根节点）
 * @param pageIndex `buildPageIndex` 的产物（重排后重新构建即可更新页码）
 * @param options 排序选项
 */
export function buildIndexEntriesFromPageIndex(
  document: BookDocument | BookNode,
  pageIndex: PageIndex,
  options: BuildIndexEntriesOptions = {},
): IndexEntry[] {
  return buildIndexEntries(document, pageIndex.entries, options);
}
