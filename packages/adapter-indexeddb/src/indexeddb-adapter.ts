/**
 * IndexedDB 存储适配器（Web 端持久化，D4/D9）
 *
 * 零依赖封装：
 * - 延迟打开数据库（首次操作时 open，升级时自动建仓）；
 * - save 为整体覆盖（put），list 按 updatedAt 降序；
 * - close 释放连接后仍可再次使用（自动重开）。
 *
 * 非浏览器环境（Node/SSR）请使用 MemoryAdapter 或注入 fake-indexeddb。
 */
import type {
  BookDocument,
  DocumentSummary,
  SaveOptions,
  StorageAdapter,
  StoredDocument,
} from '@bibliotype/core';
import { openDatabase, requestToPromise, transactionDone } from './idb-helpers.js';

/** 适配器配置 */
export interface IndexedDbAdapterOptions {
  /** 数据库名（默认 'bibliotype'） */
  databaseName?: string;
  /** 对象仓库名（默认 'documents'） */
  storeName?: string;
  /** 数据库版本（默认 1，结构升级时递增） */
  version?: number;
  /** 注入 IDB 工厂（测试用 fake-indexeddb；默认取全局 indexedDB） */
  factory?: IDBFactory;
}

/** IndexedDB 存储适配器 */
export class IndexedDbAdapter implements StorageAdapter {
  readonly name = 'indexeddb';

  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly version: number;
  private readonly factory: IDBFactory | undefined;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbAdapterOptions = {}) {
    this.databaseName = options.databaseName ?? 'bibliotype';
    this.storeName = options.storeName ?? 'documents';
    this.version = options.version ?? 1;
    this.factory = options.factory;
  }

  /** 获取（或延迟打开）数据库连接 */
  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise === undefined) {
      const factory = this.factory ?? globalThis.indexedDB;
      if (factory === undefined) {
        return Promise.reject(
          new Error('当前环境没有 indexedDB，请使用 MemoryAdapter 或注入 factory。'),
        );
      }
      this.dbPromise = openDatabase(factory, this.databaseName, this.version, this.storeName);
    }
    return this.dbPromise;
  }

  async save(id: string, document: BookDocument, options: SaveOptions = {}): Promise<void> {
    const db = await this.openDb();
    const record: StoredDocument = {
      id,
      document,
      metadata: document.metadata,
      updatedAt: options.updatedAt ?? Date.now(),
    };
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).put(record);
    await transactionDone(tx);
  }

  async load(id: string): Promise<BookDocument | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const record = await requestToPromise<StoredDocument | undefined>(
      tx.objectStore(this.storeName).get(id) as IDBRequest<StoredDocument | undefined>,
    );
    return record?.document;
  }

  async list(): Promise<DocumentSummary[]> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const records = await requestToPromise<StoredDocument[]>(
      tx.objectStore(this.storeName).getAll() as IDBRequest<StoredDocument[]>,
    );
    return records
      .map((record) => ({
        id: record.id,
        title: record.metadata.title,
        updatedAt: record.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(id: string): Promise<boolean> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    const existing = await requestToPromise<StoredDocument | undefined>(
      store.get(id) as IDBRequest<StoredDocument | undefined>,
    );
    if (existing === undefined) {
      // 不存在则不产生写操作（事务自然完成）
      return false;
    }
    store.delete(id);
    await transactionDone(tx);
    return true;
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).clear();
    await transactionDone(tx);
  }

  /** 关闭连接（下次操作自动重开） */
  async close(): Promise<void> {
    const pending = this.dbPromise;
    this.dbPromise = undefined;
    if (pending !== undefined) {
      const db = await pending;
      db.close();
    }
  }
}
