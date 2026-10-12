/**
 * 内存存储适配器
 *
 * 用途：单元测试、SSR/无 IDB 环境回退、临时草稿。
 * 数据仅存于进程内存，close 后可继续使用。
 */
import type {
  BookDocument,
  DocumentSummary,
  SaveOptions,
  StorageAdapter,
  StoredDocument,
} from '@bibliotype/core';

/** 内存存储适配器 */
export class MemoryAdapter implements StorageAdapter {
  readonly name = 'memory';

  private readonly records = new Map<string, StoredDocument>();

  async save(id: string, document: BookDocument, options: SaveOptions = {}): Promise<void> {
    this.records.set(id, {
      id,
      document,
      metadata: document.metadata,
      updatedAt: options.updatedAt ?? Date.now(),
    });
  }

  async load(id: string): Promise<BookDocument | undefined> {
    return this.records.get(id)?.document;
  }

  async list(): Promise<DocumentSummary[]> {
    return [...this.records.values()]
      .map((record) => ({
        id: record.id,
        title: record.metadata.title,
        updatedAt: record.updatedAt,
      }))
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
}
