/**
 * 内存存储适配器
 *
 * 用途：单元测试、SSR/无 IDB 环境回退、临时草稿。
 * 数据仅存于进程内存，close 后可继续使用。
 *
 * 同时实现书架可选端口 `BookLibraryStore`（查询 / 摘要补丁），
 * 摘要随 `save` 一并构建，避免列表页重解析正文。
 */
import {
  buildDocumentSummary,
  carryOverSummaryFields,
  countDocumentStats,
  mergeDocumentSummary,
  queryDocumentSummaries,
} from '@bibliotype/core';
import type {
  BookDocument,
  BookLibraryStore,
  BookQueryResult,
  BookSummaryStore,
  DocumentQuery,
  DocumentSummary,
  DocumentSummaryPatch,
  SaveOptions,
  StorageAdapter,
} from '@bibliotype/core';

/** 内存记录（正文 + 摘要同仓，保证一致） */
interface MemoryRecord {
  /** IR 文档 */
  document: BookDocument;
  /** 最后更新时间 */
  updatedAt: number;
  /** 书架摘要 */
  summary: DocumentSummary;
}

/** 内存存储适配器 */
export class MemoryAdapter implements StorageAdapter, BookLibraryStore, BookSummaryStore {
  readonly name = 'memory';

  private readonly records = new Map<string, MemoryRecord>();

  async save(id: string, document: BookDocument, options: SaveOptions = {}): Promise<void> {
    const updatedAt = options.updatedAt ?? Date.now();
    const previous = this.records.get(id)?.summary;
    const computed = buildDocumentSummary({
      id,
      metadata: document.metadata,
      updatedAt,
      wordCount: countDocumentStats(document).characters,
    });
    this.records.set(id, {
      document,
      updatedAt,
      summary: carryOverSummaryFields(previous, computed),
    });
  }

  async load(id: string): Promise<BookDocument | undefined> {
    return this.records.get(id)?.document;
  }

  async list(): Promise<DocumentSummary[]> {
    return [...this.records.values()]
      .map((record) => ({ ...record.summary }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async close(): Promise<void> {
    // 内存实现无需释放资源
  }

  async query(query: DocumentQuery = {}): Promise<BookQueryResult> {
    return queryDocumentSummaries(await this.list(), query);
  }

  async updateSummary(
    id: string,
    patch: DocumentSummaryPatch,
  ): Promise<DocumentSummary | undefined> {
    const record = this.records.get(id);
    if (record === undefined) {
      return undefined;
    }
    const summary = mergeDocumentSummary(record.summary, patch);
    const updatedAt = patch.updatedAt ?? record.updatedAt;
    this.records.set(id, { document: record.document, updatedAt, summary });
    return { ...summary };
  }
}
