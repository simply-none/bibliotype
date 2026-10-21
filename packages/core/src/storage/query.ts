/**
 * 书架查询：检索、排序、分组（纯函数）+ 可选存储端口
 *
 * 设计要点：
 * - 摘要列表体量在「上千本」量级，全量过滤 O(n) 足够，故不引入索引结构；
 * - 检索为**全部关键词命中**（AND），每个关键词对标题 / 作者 / ISBN / 标签做子串匹配，忽略大小写；
 * - 排序比较使用码位比较（不依赖 `Intl.Collator` 与运行环境 locale），保证跨环境确定性；
 * - 端口用「可选能力 + 运行期探测」扩展，不改 `StorageAdapter` 必选方法。
 */
import type { DocumentSummary, DocumentSummaryPatch } from './types.js';

/** 排序键常量 */
export const DOCUMENT_SORT_KEYS = {
  /** 最近阅读（缺 `lastOpenedAt` 时回落到 `updatedAt`） */
  RECENT_READ: 'recentRead',
  /** 最后更新时间 */
  UPDATED: 'updated',
  /** 标题 */
  TITLE: 'title',
  /** 字数 */
  WORD_COUNT: 'wordCount',
} as const;

/** 排序键联合 */
export type DocumentSortKey = (typeof DOCUMENT_SORT_KEYS)[keyof typeof DOCUMENT_SORT_KEYS];

/** 排序方向常量 */
export const SORT_DIRECTIONS = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

/** 排序方向联合 */
export type SortDirection = (typeof SORT_DIRECTIONS)[keyof typeof SORT_DIRECTIONS];

/** 分组键常量 */
export const DOCUMENT_GROUP_KEYS = {
  /** 不分组（单组） */
  NONE: 'none',
  /** 按标签（一本书可出现在多个标签组） */
  TAG: 'tag',
  /** 按作者 */
  AUTHOR: 'author',
} as const;

/** 分组键联合 */
export type DocumentGroupKey = (typeof DOCUMENT_GROUP_KEYS)[keyof typeof DOCUMENT_GROUP_KEYS];

/** 书架查询条件（全部字段可选，缺省按最近阅读降序） */
export interface DocumentQuery {
  /** 检索词（空白分隔视为多个关键词，全部命中才算匹配） */
  text?: string;
  /** 标签筛选（命中任一即保留） */
  tags?: readonly string[];
  /** 排序键（默认 `recentRead`） */
  sortBy?: DocumentSortKey;
  /** 排序方向（默认：title 升序，其余降序） */
  direction?: SortDirection;
  /** 分组键（默认 `none`） */
  groupBy?: DocumentGroupKey;
  /** 分页长度（缺省不分页） */
  limit?: number;
  /** 分页偏移（缺省 0） */
  offset?: number;
}

/** 分组结果 */
export interface DocumentSummaryGroup {
  /** 分组键（`none` 分组为 `''`） */
  key: string;
  /** 展示名（标签名 / 作者名 / 「全部」） */
  label: string;
  /** 组内条目（沿用整体排序） */
  items: DocumentSummary[];
}

/** 查询结果 */
export interface BookQueryResult {
  /** 当前页条目 */
  items: DocumentSummary[];
  /** 命中总数（分页前） */
  total: number;
  /** 分组结果（`groupBy: 'none'` 时为单组） */
  groups: DocumentSummaryGroup[];
}

/**
 * 书架查询端口（可选能力）
 *
 * 实现方在 `StorageAdapter` 之上补「按条件查摘要」能力；远端适配器可用
 * `list()` + `queryDocumentSummaries` 实现，服务端无需新增端点。
 * 调用方必须先经 `isBookLibraryStore` 探测，不得假定所有适配器都实现。
 */
export interface BookLibraryStore {
  /** 适配器名称（与 `StorageAdapter.name` 一致） */
  readonly name: string;
  /** 按条件查询摘要 */
  query(query?: DocumentQuery): Promise<BookQueryResult>;
}

/**
 * 书架摘要补丁端口（可选能力，与查询端口分开探测）
 *
 * 只有能持久化「摘要附加字段」的适配器才实现（如内存 / IndexedDB）；
 * HTTP 适配器无对应端点，因此不实现本端口，调用方需回落到整本 `save`。
 */
export interface BookSummaryStore {
  /** 适配器名称（与 `StorageAdapter.name` 一致） */
  readonly name: string;
  /**
   * 局部更新摘要（如阅读进度、最近阅读时间、标签、封面缩略图）
   *
   * @returns 更新后的摘要；文档不存在时返回 undefined
   */
  updateSummary(id: string, patch: DocumentSummaryPatch): Promise<DocumentSummary | undefined>;
}

/** 运行期判定对象是否实现了书架查询端口 */
export function isBookLibraryStore(value: unknown): value is BookLibraryStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<BookLibraryStore>;
  return typeof candidate.name === 'string' && typeof candidate.query === 'function';
}

/** 运行期判定对象是否实现了摘要补丁端口 */
export function isBookSummaryStore(value: unknown): value is BookSummaryStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<BookSummaryStore>;
  return typeof candidate.name === 'string' && typeof candidate.updateSummary === 'function';
}

/** 拆分检索词（空白分隔、去空、转小写） */
export function splitQueryTokens(text: string | undefined): string[] {
  if (text === undefined) {
    return [];
  }
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '');
}

/** 单本摘要的可检索文本（标题 / 作者 / ISBN / 标签） */
function searchableFields(summary: DocumentSummary): string[] {
  const fields: string[] = [summary.title];
  if (summary.author !== undefined) {
    fields.push(summary.author);
  }
  if (summary.isbn !== undefined) {
    fields.push(summary.isbn);
  }
  if (summary.tags !== undefined) {
    fields.push(...summary.tags);
  }
  return fields.map((field) => field.toLowerCase());
}

/** 判断摘要是否命中查询（检索词 AND、标签 OR） */
export function matchesDocumentQuery(summary: DocumentSummary, query: DocumentQuery = {}): boolean {
  const tokens = splitQueryTokens(query.text);
  if (tokens.length > 0) {
    const fields = searchableFields(summary);
    for (const token of tokens) {
      if (!fields.some((field) => field.includes(token))) {
        return false;
      }
    }
  }
  const wantedTags = query.tags;
  if (wantedTags !== undefined && wantedTags.length > 0) {
    const owned = summary.tags ?? [];
    if (!wantedTags.some((tag) => owned.includes(tag))) {
      return false;
    }
  }
  return true;
}

/** 缺省排序方向：标题升序，其余降序 */
export function defaultDirection(sortBy: DocumentSortKey): SortDirection {
  return sortBy === DOCUMENT_SORT_KEYS.TITLE ? SORT_DIRECTIONS.ASC : SORT_DIRECTIONS.DESC;
}

/** 取排序比较值（数值键缺失按 -Infinity，字符串键缺失按空串） */
function sortValue(summary: DocumentSummary, sortBy: DocumentSortKey): number | string {
  switch (sortBy) {
    case DOCUMENT_SORT_KEYS.TITLE:
      return summary.title;
    case DOCUMENT_SORT_KEYS.WORD_COUNT:
      return summary.wordCount ?? -1;
    case DOCUMENT_SORT_KEYS.UPDATED:
      return summary.updatedAt;
    case DOCUMENT_SORT_KEYS.RECENT_READ:
    default:
      return summary.lastOpenedAt ?? summary.updatedAt;
  }
}

/** 码位比较（确定性，不依赖 locale） */
function compareValues(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  const leftText = String(left);
  const rightText = String(right);
  if (leftText === rightText) {
    return 0;
  }
  return leftText < rightText ? -1 : 1;
}

/** 排序摘要（返回新数组，稳定排序：同值按 id 升序） */
export function sortDocumentSummaries(
  items: readonly DocumentSummary[],
  query: DocumentQuery = {},
): DocumentSummary[] {
  const sortBy = query.sortBy ?? DOCUMENT_SORT_KEYS.RECENT_READ;
  const direction = query.direction ?? defaultDirection(sortBy);
  const factor = direction === SORT_DIRECTIONS.ASC ? 1 : -1;
  return [...items].sort((left, right) => {
    const primary = compareValues(sortValue(left, sortBy), sortValue(right, sortBy));
    if (primary !== 0) {
      return primary * factor;
    }
    return compareValues(left.id, right.id);
  });
}

/** 按标签 / 作者分组（组顺序按排序结果首次出现；一本书可落入多个标签组） */
export function groupDocumentSummaries(
  items: readonly DocumentSummary[],
  groupBy: DocumentGroupKey = DOCUMENT_GROUP_KEYS.NONE,
): DocumentSummaryGroup[] {
  if (groupBy === DOCUMENT_GROUP_KEYS.NONE) {
    return [{ key: '', label: '全部', items: [...items] }];
  }
  const groups = new Map<string, DocumentSummaryGroup>();
  for (const summary of items) {
    const keys =
      groupBy === DOCUMENT_GROUP_KEYS.TAG
        ? summary.tags ?? []
        : [summary.author ?? '未署名'];
    for (const key of keys) {
      let group = groups.get(key);
      if (group === undefined) {
        group = { key, label: key, items: [] };
        groups.set(key, group);
      }
      group.items.push(summary);
    }
  }
  if (groups.size === 0) {
    return [{ key: '', label: '全部', items: [] }];
  }
  return [...groups.values()];
}

/** 对摘要列表执行完整查询（过滤 → 排序 → 分组 → 分页） */
export function queryDocumentSummaries(
  items: readonly DocumentSummary[],
  query: DocumentQuery = {},
): BookQueryResult {
  const matched = items.filter((summary) => matchesDocumentQuery(summary, query));
  const sorted = sortDocumentSummaries(matched, query);
  const offset = query.offset !== undefined && query.offset > 0 ? Math.floor(query.offset) : 0;
  const limit =
    query.limit !== undefined && query.limit >= 0 ? Math.floor(query.limit) : undefined;
  const paged = limit === undefined ? sorted.slice(offset) : sorted.slice(offset, offset + limit);
  return {
    items: paged,
    total: sorted.length,
    groups: groupDocumentSummaries(sorted, query.groupBy ?? DOCUMENT_GROUP_KEYS.NONE),
  };
}
