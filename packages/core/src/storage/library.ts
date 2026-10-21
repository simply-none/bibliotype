/**
 * 书架摘要：构建、合并与旧数据回退
 *
 * 摘要只存「书架要用的一层元信息」，避免列表页解析整本 IR：
 * - 责任者 / ISBN / 标签从 `BookMetadata` 派生，派生口径集中在本文件；
 * - 字数由调用方（保存侧）用 `countDocumentStats` 算好传入，本模块不做遍历；
 * - 旧记录缺字段时由 `mergeDocumentSummary` 回退，不补默认值、不抛错。
 *
 * 全部为纯函数，不读写存储、不取当前时间。
 */
import type { BookMetadata } from '../ir/metadata.js';
import type { DocumentSummary, DocumentSummaryPatch } from './types.js';

/** 构建摘要的输入（时间与字数均由调用方注入，保证确定性） */
export interface BuildDocumentSummaryInput {
  /** 文档标识 */
  id: string;
  /** 书目元数据 */
  metadata: BookMetadata;
  /** 最后更新时间（epoch ms） */
  updatedAt: number;
  /** 正文字数（缺省不写该字段） */
  wordCount?: number;
  /** 阅读进度 0–1（缺省不写该字段） */
  progress?: number;
  /** 封面缩略图（data URI 或 `asset:<id>`） */
  coverThumbnail?: string;
  /** 显式标签（缺省改读 `metadata.extra.tags`） */
  tags?: readonly string[];
  /** 最近阅读时间（epoch ms） */
  lastOpenedAt?: number;
}

/** 标签最大长度上限（超出截断，避免异常输入撑爆摘要） */
const MAX_TAG_LENGTH = 32;
/** 标签数量上限 */
const MAX_TAG_COUNT = 20;

/** 从元数据取责任者（首位贡献者姓名） */
export function summaryAuthor(metadata: BookMetadata): string | undefined {
  const name = metadata.contributors?.[0]?.name;
  if (typeof name !== 'string') {
    return undefined;
  }
  const trimmed = name.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 从元数据取 ISBN（首个 `scheme === 'isbn'` 的标识符） */
export function summaryIsbn(metadata: BookMetadata): string | undefined {
  const identifiers = metadata.identifiers;
  if (!Array.isArray(identifiers)) {
    return undefined;
  }
  for (const identifier of identifiers) {
    if (identifier.scheme === 'isbn') {
      const value = identifier.value.trim();
      if (value !== '') {
        return value;
      }
    }
  }
  return undefined;
}

/** 从元数据的扩展字段读取标签（`extra.tags`，非数组或非字符串项忽略） */
export function summaryTagsFromMetadata(metadata: BookMetadata): string[] | undefined {
  const raw = metadata.extra?.['tags'];
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      tags.push(item);
    }
  }
  return normalizeTags(tags);
}

/**
 * 规范化标签：去首尾空白、丢弃空串、去重（保持首次出现顺序）、截断超长与超量
 *
 * @returns 空列表返回 undefined（不把空数组写进摘要）
 */
export function normalizeTags(tags: readonly string[] | undefined): string[] | undefined {
  if (tags === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed === '') {
      continue;
    }
    const clipped =
      trimmed.length > MAX_TAG_LENGTH ? trimmed.slice(0, MAX_TAG_LENGTH) : trimmed;
    if (seen.has(clipped)) {
      continue;
    }
    seen.add(clipped);
    result.push(clipped);
    if (result.length >= MAX_TAG_COUNT) {
      break;
    }
  }
  return result.length === 0 ? undefined : result;
}

/** 归一并夹取阅读进度到 0–1（非法值返回 undefined，不擅自补 0） */
export function clampProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

/** 由元数据与统计结果构建书架摘要 */
export function buildDocumentSummary(input: BuildDocumentSummaryInput): DocumentSummary {
  const summary: DocumentSummary = {
    id: input.id,
    title: input.metadata.title,
    updatedAt: input.updatedAt,
  };
  const author = summaryAuthor(input.metadata);
  if (author !== undefined) {
    summary.author = author;
  }
  const isbn = summaryIsbn(input.metadata);
  if (isbn !== undefined) {
    summary.isbn = isbn;
  }
  const tags = normalizeTags(input.tags) ?? summaryTagsFromMetadata(input.metadata);
  if (tags !== undefined) {
    summary.tags = tags;
  }
  if (input.coverThumbnail !== undefined && input.coverThumbnail !== '') {
    summary.coverThumbnail = input.coverThumbnail;
  }
  if (input.wordCount !== undefined && input.wordCount >= 0) {
    summary.wordCount = input.wordCount;
  }
  const progress = clampProgress(input.progress);
  if (progress !== undefined) {
    summary.progress = progress;
  }
  if (input.lastOpenedAt !== undefined) {
    summary.lastOpenedAt = input.lastOpenedAt;
  }
  return summary;
}

/**
 * 合并摘要补丁
 *
 * 语义：补丁中为 `undefined` 的键表示「不修改」；`tags` 传空数组表示清空。
 * 返回新对象，不修改入参（便于存储层做「读 → 改 → 写」）。
 */
export function mergeDocumentSummary(
  base: DocumentSummary,
  patch: DocumentSummaryPatch,
): DocumentSummary {
  const next: DocumentSummary = { ...base };
  if (patch.title !== undefined) {
    next.title = patch.title;
  }
  if (patch.updatedAt !== undefined) {
    next.updatedAt = patch.updatedAt;
  }
  if (patch.author !== undefined) {
    next.author = patch.author;
  }
  if (patch.isbn !== undefined) {
    next.isbn = patch.isbn;
  }
  if (patch.tags !== undefined) {
    if (patch.tags.length === 0) {
      delete next.tags;
    } else {
      next.tags = [...patch.tags];
    }
  }
  if (patch.coverThumbnail !== undefined) {
    if (patch.coverThumbnail === '') {
      delete next.coverThumbnail;
    } else {
      next.coverThumbnail = patch.coverThumbnail;
    }
  }
  if (patch.wordCount !== undefined) {
    next.wordCount = patch.wordCount;
  }
  if (patch.progress !== undefined) {
    const progress = clampProgress(patch.progress);
    if (progress === undefined) {
      delete next.progress;
    } else {
      next.progress = progress;
    }
  }
  if (patch.lastOpenedAt !== undefined) {
    next.lastOpenedAt = patch.lastOpenedAt;
  }
  return next;
}

/**
 * 保存时把「非派生字段」从旧摘要延续到新摘要
 *
 * 派生字段（title / author / isbn / updatedAt / wordCount）由文档内容决定，
 * 阅读进度 / 最近阅读时间 / 封面缩略图 / 显式标签属于用户侧状态，保存正文时
 * 不应被抹掉；元数据未提供标签时保留旧标签。
 */
export function carryOverSummaryFields(
  previous: DocumentSummary | undefined,
  next: DocumentSummary,
): DocumentSummary {
  if (previous === undefined) {
    return next;
  }
  const merged: DocumentSummary = { ...next };
  if (merged.tags === undefined && previous.tags !== undefined) {
    merged.tags = [...previous.tags];
  }
  if (merged.coverThumbnail === undefined && previous.coverThumbnail !== undefined) {
    merged.coverThumbnail = previous.coverThumbnail;
  }
  if (merged.progress === undefined && previous.progress !== undefined) {
    merged.progress = previous.progress;
  }
  if (merged.lastOpenedAt === undefined && previous.lastOpenedAt !== undefined) {
    merged.lastOpenedAt = previous.lastOpenedAt;
  }
  return merged;
}

/** 判断对象是否至少具备摘要的必备字段（用于存储层反序列化校验） */
export function isDocumentSummary(value: unknown): value is DocumentSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<DocumentSummary>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.updatedAt === 'number'
  );
}
