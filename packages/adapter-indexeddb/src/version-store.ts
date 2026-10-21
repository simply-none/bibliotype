/**
 * 历史版本存储（C7）
 *
 * 实现 core 的 `DocumentVersionStore` 可选端口：
 * - IndexedDB：独立数据库（默认 `bibliotype-versions`），避免与文档库的
 *   版本升级互相牵制；复合主键 `[documentId, version]` + 按文档索引；
 * - 内存：单元测试与无 IDB 环境回退。
 *
 * 保留策略的「选择」在 core 纯函数 `selectExpiredSnapshots`，本实现只执行删除。
 */
import { selectExpiredSnapshots } from '@bibliotype/core';
import type {
  DocumentSnapshot,
  DocumentSnapshotMeta,
  DocumentVersionStore,
  SnapshotRetentionPolicy,
} from '@bibliotype/core';
import { openDatabase, requestToPromise, transactionDone, type StoreDefinition } from './idb-helpers.js';

/** 版本库默认数据库名 */
const DEFAULT_DATABASE = 'bibliotype-versions';
/** 版本库默认对象仓库名 */
const DEFAULT_STORE = 'versions';
/** 按文档查询的索引名 */
const DOC_INDEX = 'byDocument';

/** IndexedDB 版本存储选项 */
export interface IndexedDbVersionStoreOptions {
  /** 数据库名（默认 `bibliotype-versions`） */
  databaseName?: string;
  /** 对象仓库名（默认 `versions`） */
  storeName?: string;
  /** 数据库版本（默认 1） */
  version?: number;
  /** 注入 IDB 工厂（测试用 fake-indexeddb） */
  factory?: IDBFactory;
}

/** 版本记录（元信息与正文同仓，便于一次取全） */
interface VersionRecord {
  /** 文档 id */
  documentId: string;
  /** 版本号 */
  version: number;
  /** 元信息（列表用，避免读正文） */
  meta: DocumentSnapshotMeta;
  /** 完整快照 */
  snapshot: DocumentSnapshot;
}

/** 快照 → 元信息 */
function metaOf(snapshot: DocumentSnapshot): DocumentSnapshotMeta {
  const meta: DocumentSnapshotMeta = {
    documentId: snapshot.documentId,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
  };
  if (snapshot.label !== undefined) {
    meta.label = snapshot.label;
  }
  if (snapshot.wordCount !== undefined) {
    meta.wordCount = snapshot.wordCount;
  }
  return meta;
}

/** IndexedDB 版本存储 */
export class IndexedDbVersionStore implements DocumentVersionStore {
  readonly name = 'indexeddb-versions';

  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly version: number;
  private readonly factory: IDBFactory | undefined;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbVersionStoreOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE;
    this.storeName = options.storeName ?? DEFAULT_STORE;
    this.version = options.version ?? 1;
    this.factory = options.factory;
  }

  private storeDefinitions(): StoreDefinition[] {
    return [
      {
        name: this.storeName,
        keyPath: ['documentId', 'version'],
        indexes: [{ name: DOC_INDEX, keyPath: 'documentId' }],
      },
    ];
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise === undefined) {
      const factory = this.factory ?? globalThis.indexedDB;
      if (factory === undefined) {
        return Promise.reject(
          new Error('当前环境没有 indexedDB，请使用 MemoryVersionStore 或注入 factory。'),
        );
      }
      this.dbPromise = openDatabase(
        factory,
        this.databaseName,
        this.version,
        this.storeDefinitions(),
      );
    }
    return this.dbPromise;
  }

  async listVersions(documentId: string): Promise<DocumentSnapshotMeta[]> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const records = await requestToPromise<VersionRecord[]>(
      tx
        .objectStore(this.storeName)
        .index(DOC_INDEX)
        .getAll(documentId) as IDBRequest<VersionRecord[]>,
    );
    return records
      .map((record) => ({ ...record.meta }))
      .sort((left, right) => left.version - right.version);
  }

  async saveVersion(snapshot: DocumentSnapshot): Promise<DocumentSnapshotMeta> {
    const db = await this.openDb();
    const meta = metaOf(snapshot);
    const record: VersionRecord = {
      documentId: snapshot.documentId,
      version: snapshot.version,
      meta,
      snapshot,
    };
    const tx = db.transaction(this.storeName, 'readwrite');
    tx.objectStore(this.storeName).put(record);
    await transactionDone(tx);
    return { ...meta };
  }

  async loadVersion(documentId: string, version: number): Promise<DocumentSnapshot | undefined> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const record = await requestToPromise<VersionRecord | undefined>(
      tx.objectStore(this.storeName).get([documentId, version]) as IDBRequest<
        VersionRecord | undefined
      >,
    );
    return record?.snapshot;
  }

  async deleteVersion(documentId: string, version: number): Promise<boolean> {
    const db = await this.openDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    const existing = await requestToPromise<VersionRecord | undefined>(
      store.get([documentId, version]) as IDBRequest<VersionRecord | undefined>,
    );
    if (existing === undefined) {
      return false;
    }
    store.delete([documentId, version]);
    await transactionDone(tx);
    return true;
  }

  async pruneVersions(
    documentId: string,
    policy: SnapshotRetentionPolicy,
  ): Promise<number[]> {
    const metas = await this.listVersions(documentId);
    const expired = selectExpiredSnapshots(metas, policy);
    const removed: number[] = [];
    for (const meta of expired) {
      if (await this.deleteVersion(documentId, meta.version)) {
        removed.push(meta.version);
      }
    }
    return removed;
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

/** 内存版本存储（测试 / SSR 回退） */
export class MemoryVersionStore implements DocumentVersionStore {
  readonly name = 'memory-versions';

  private readonly records = new Map<string, Map<number, DocumentSnapshot>>();

  async listVersions(documentId: string): Promise<DocumentSnapshotMeta[]> {
    const versions = this.records.get(documentId);
    if (versions === undefined) {
      return [];
    }
    return [...versions.values()]
      .map((snapshot) => metaOf(snapshot))
      .sort((left, right) => left.version - right.version);
  }

  async saveVersion(snapshot: DocumentSnapshot): Promise<DocumentSnapshotMeta> {
    let versions = this.records.get(snapshot.documentId);
    if (versions === undefined) {
      versions = new Map<number, DocumentSnapshot>();
      this.records.set(snapshot.documentId, versions);
    }
    versions.set(snapshot.version, snapshot);
    return metaOf(snapshot);
  }

  async loadVersion(documentId: string, version: number): Promise<DocumentSnapshot | undefined> {
    return this.records.get(documentId)?.get(version);
  }

  async deleteVersion(documentId: string, version: number): Promise<boolean> {
    return this.records.get(documentId)?.delete(version) ?? false;
  }

  async pruneVersions(documentId: string, policy: SnapshotRetentionPolicy): Promise<number[]> {
    const versions = this.records.get(documentId);
    if (versions === undefined) {
      return [];
    }
    const metas = [...versions.values()].map((snapshot) => metaOf(snapshot));
    const expired = selectExpiredSnapshots(metas, policy);
    const removed: number[] = [];
    for (const meta of expired) {
      if (versions.delete(meta.version)) {
        removed.push(meta.version);
      }
    }
    return removed;
  }
}
