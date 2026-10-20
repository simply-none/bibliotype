/**
 * 站点搜索索引
 *
 * 站点是静态的：没有服务端检索，故导出时预生成「节 → 正文纯文本」索引，
 * 由前端用子串 / 分词匹配（本包不绑定检索实现）。索引确定性输出（按 id 排序）。
 */
import { nodePlainText } from '@bibliotype/core';
import type { BookNode } from '@bibliotype/core';
import type { SiteSearchEntry } from './types.js';

/** 索引版本（结构变更时递增） */
export const SITE_SEARCH_INDEX_VERSION = '1.0.0';

/** 搜索索引 */
export interface SiteSearchIndex {
  /** 索引版本 */
  version: string;
  /** 条目（按 id 升序） */
  entries: SiteSearchEntry[];
}

/** 归一化检索文本：折叠空白、去首尾空格 */
export function normalizeSearchText(text: string): string {
  return text.replace(/[\s\u3000]+/g, ' ').trim();
}

/** 由节点构造索引条目 */
export function buildSearchEntry(
  id: string,
  title: string,
  path: string,
  node: BookNode,
): SiteSearchEntry {
  return { id, title, path, text: normalizeSearchText(nodePlainText(node)) };
}

/** 序列化索引（确定性：按 id 升序） */
export function serializeSearchIndex(entries: readonly SiteSearchEntry[]): string {
  const sorted = [...entries].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const index: SiteSearchIndex = { version: SITE_SEARCH_INDEX_VERSION, entries: sorted };
  return JSON.stringify(index);
}
