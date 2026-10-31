/**
 * 站点搜索索引
 *
 * 站点是静态的：没有服务端检索，故导出时预生成「节 → 正文纯文本」索引，
 * 由前端用子串 / 分词匹配（本包不绑定检索实现）。索引确定性输出（按 id 排序）。
 */
import { isTextNode, nodePlainText, resolveMarksForView } from '@bibliotype/core';
import type { BookNode, RevisionView } from '@bibliotype/core';
import type { SiteSearchEntry } from './types.js';

/** 索引版本（结构变更时递增） */
export const SITE_SEARCH_INDEX_VERSION = '1.0.0';

/** 索引缺省视图：与页面序列化一致（站点是发布物，缺省终稿） */
export const DEFAULT_SEARCH_VIEW: RevisionView = 'final';

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

/**
 * 按修订视图提取节点纯文本
 *
 * 与页面序列化口径一致：目标视图下不可见的文本（如 final 视图的删除文字）
 * 不进入索引，避免「页面搜不到、索引搜得到」。`marked` 视图等价 `nodePlainText`。
 */
export function nodePlainTextForView(node: BookNode, view: RevisionView): string {
  if (view === 'marked') {
    return nodePlainText(node);
  }
  if (isTextNode(node)) {
    const resolved = resolveMarksForView(node.marks, view);
    if (resolved.hidden) {
      return '';
    }
    return node.text ?? '';
  }
  let text = '';
  for (const child of node.children ?? []) {
    text += nodePlainTextForView(child, view);
  }
  return text;
}

/** 由节点构造索引条目（视图缺省 final，与页面缺省口径一致） */
export function buildSearchEntry(
  id: string,
  title: string,
  path: string,
  node: BookNode,
  view: RevisionView = DEFAULT_SEARCH_VIEW,
): SiteSearchEntry {
  return { id, title, path, text: normalizeSearchText(nodePlainTextForView(node, view)) };
}

/** 序列化索引（确定性：按 id 升序） */
export function serializeSearchIndex(entries: readonly SiteSearchEntry[]): string {
  const sorted = [...entries].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const index: SiteSearchIndex = { version: SITE_SEARCH_INDEX_VERSION, entries: sorted };
  return JSON.stringify(index);
}
