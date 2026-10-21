/**
 * IndexedDB 存储适配器（Web 端持久化，D4/D9）
 *
 * 零依赖封装：
 * - 延迟打开数据库（首次操作时 open，升级时自动建仓）；
 * - **分片落盘（P2）**：`save` 不再整本 `put`，而是切成「骨架 + 片」只写变更片
 *   （见 `chunked-store.ts`；IR 结构共享让「未变」判定退化为引用比较）；
 * - 兼容旧格式：整本记录仍可读，下次写入时自动迁移为分片格式；
 * - list 按 updatedAt 降序；
 * - close 释放连接后仍可再次使用（自动重开）。
 *
 * 非浏览器环境（Node/SSR）请使用 MemoryAdapter 或注入 fake-indexeddb。
 */
import {
  buildDocumentSummary,
  carryOverSummaryFields,
  countDocumentStats,
  isDocumentSummary,
  mergeDocumentSummary,
  queryDocumentSummaries,
} from '@bibliotype/core';
import type {
  BookDocument,
  BookLibraryStore,
  BookNode,
  BookQueryResult,
  BookSummaryStore,
  DocumentQuery,
  DocumentSummary,
  DocumentSummaryPatch,
  SaveOptions,
  StorageAdapter,
  StoredDocument,
} from '@bibliotype/core';
import {
  buildChunkedSnapshot,
  fromSkeleton,
  type ChunkSlice,
  type SkeletonNode,
} from './chunked-store.js';
import {
  openDatabase,
  requestToPromise,
  transactionDone,
  type StoreDefinition,
} from './idb-helpers.js';

/** 分片记录格式版本（骨架结构变更时递增） */
const CHUNK_FORMAT = 'chunked-v1';
/** 骨架仓后缀 */
const META_SUFFIX = '-meta';
/** 片仓后缀 */
const CHUNK_SUFFIX = '-chunks';
/** 片仓的文档归属索引名 */
const CHUNK_DOC_INDEX = 'byDoc';

/** 适配器配置 */
export interface IndexedDbAdapterOptions {
  /** 数据库名（默认 'bibliotype'） */
  databaseName?: string;
  /** 对象仓库名（默认 'documents'；分片仓自动派生为 `<name>-meta` / `<name>-chunks`） */
  storeName?: string;
  /** 数据库版本（默认 2，结构升级时递增） */
  version?: number;
  /** 注入 IDB 工厂（测试用 fake-indexeddb；默认取全局 indexedDB） */
  factory?: IDBFactory;
}

/** 分片文档骨架记录（meta 仓：文档级元信息 + 结构骨架） */
interface ChunkedDocumentRecord {
  /** 文档 id（主键） */
  id: string;
  /** 格式标记（用于版本演进识别） */
  format: typeof CHUNK_FORMAT;
  /** schema 版本 */
  schemaVersion: string;
  /** 文档元信息 */
  metadata: BookDocument['metadata'];
  /** 更新时间 */
  updatedAt: number;
  /** 结构骨架（子树切出处为 `{ $chunk }` 占位） */
  skeleton: SkeletonNode;
  /** 本记录引用的全部片 id（清理陈旧片用） */
  chunkIds: string[];
  /**
   * 书架摘要（可选）
   *
   * 旧版本写入的记录没有该字段，读取时回退为「元数据即时构建」。
   */
  summary?: DocumentSummary;
}

/** 片记录（chunk 仓：一条记录 = 一组连续兄弟节点，估算体积 ≤ 32KB） */
interface ChunkRecord {
  /** 文档 id（复合主键的第一段） */
  id: string;
  /** 片 id（复合主键的第二段） */
  chunkId: string;
  /** 片内节点（连续兄弟，恢复时按序展开） */
  nodes: BookNode[];
}

/** IndexedDB 存储适配器 */
export class IndexedDbAdapter implements StorageAdapter, BookLibraryStore, BookSummaryStore {
  readonly name = 'indexeddb';

  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly metaStore: string;
  private readonly chunkStore: string;
  private readonly version: number;
  private readonly factory: IDBFactory | undefined;
  private dbPromise: Promise<IDBDatabase> | undefined;

  /** 各文档上一轮的切片树（增量判定基准；进程内缓存） */
  private readonly slices = new Map<string, { root: ChunkSlice; chunkIds: Set<string> }>();
  /** 片根节点 → 片 id（同一对象引用永远映射同一 id） */
  private readonly chunkIds = new WeakMap<BookNode, string>();
  /** 片 id 序号（与时间戳前缀组合，避免跨会话重号覆盖旧片） */
  private chunkSeq = 0;
  /** 片 id 时间戳前缀（每次实例一组，重启不冲突） */
  private readonly chunkEpoch = Date.now().toString(36);

  constructor(options: IndexedDbAdapterOptions = {}) {
    this.databaseName = options.databaseName ?? 'bibliotype';
    this.storeName = options.storeName ?? 'documents';
    this.metaStore = `${this.storeName}${META_SUFFIX}`;
    this.chunkStore = `${this.storeName}${CHUNK_SUFFIX}`;
    this.version = options.version ?? 2;
    this.factory = options.factory;
  }

  /** 需要确保存在的仓库（旧整本仓 + 骨架仓 + 片仓） */
  private storeDefinitions(): StoreDefinition[] {
    return [
      { name: this.storeName },
      { name: this.metaStore },
      {
        name: this.chunkStore,
        keyPath: ['id', 'chunkId'],
        indexes: [{ name: CHUNK_DOC_INDEX, keyPath: 'id' }],
      },
    ];
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
      this.dbPromise = openDatabase(
        factory,
        this.databaseName,
        this.version,
        this.storeDefinitions(),
      );
    }
    return this.dbPromise;
  }

  /** 分配新片 id（时间戳前缀 + 自增，跨会话不重号） */
  private nextChunkId(): string {
    this.chunkSeq += 1;
    return `c${this.chunkEpoch}-${this.chunkSeq}`;
  }

  /** 读骨架记录（无则 undefined） */
  private async readMetaRecord(
    db: IDBDatabase,
    id: string,
  ): Promise<ChunkedDocumentRecord | undefined> {
    const tx = db.transaction(this.metaStore, 'readonly');
    return requestToPromise<ChunkedDocumentRecord | undefined>(
      tx.objectStore(this.metaStore).get(id) as IDBRequest<ChunkedDocumentRecord | undefined>,
    );
  }

  /** 取记录的书架摘要（旧记录缺 `summary` 时用元数据即时构建，不写回） */
  private summaryOfMeta(record: ChunkedDocumentRecord): DocumentSummary {
    if (isDocumentSummary(record.summary)) {
      return { ...record.summary };
    }
    return buildDocumentSummary({
      id: record.id,
      metadata: record.metadata,
      updatedAt: record.updatedAt,
    });
  }

  /** 读某文档的全部片（按归属索引一次取回） */
  private async readChunks(db: IDBDatabase, id: string): Promise<Map<string, BookNode[]>> {
    const tx = db.transaction(this.chunkStore, 'readonly');
    const records = await requestToPromise<ChunkRecord[]>(
      tx
        .objectStore(this.chunkStore)
        .index(CHUNK_DOC_INDEX)
        .getAll(id) as IDBRequest<ChunkRecord[]>,
    );
    const map = new Map<string, BookNode[]>();
    for (const record of records) map.set(record.chunkId, record.nodes);
    return map;
  }

  async save(id: string, document: BookDocument, options: SaveOptions = {}): Promise<void> {
    const db = await this.openDb();
    const prevMeta = await this.readMetaRecord(db, id);
    const memo = this.slices.get(id);
    // 旧片集合：DB 记录 ∪ 内存记忆（内存可能比库新，取并集避免漏删 / 误留）
    const previousIds = new Set<string>([
      ...(prevMeta?.chunkIds ?? []),
      ...(memo?.chunkIds ?? []),
    ]);

    // 切片（同步、纯内存）：引用未变的子树整棵复用，只产出新片的写集合
    const snapshot = buildChunkedSnapshot(
      document.root,
      memo?.root,
      this.chunkIds,
      () => this.nextChunkId(),
    );

    const updatedAt = options.updatedAt ?? Date.now();
    const record: ChunkedDocumentRecord = {
      id,
      format: CHUNK_FORMAT,
      schemaVersion: document.schemaVersion,
      metadata: document.metadata,
      updatedAt,
      skeleton: snapshot.skeleton,
      chunkIds: [...snapshot.chunkIds],
      summary: carryOverSummaryFields(
        prevMeta !== undefined ? this.summaryOfMeta(prevMeta) : undefined,
        buildDocumentSummary({
          id,
          metadata: document.metadata,
          updatedAt,
          wordCount: countDocumentStats(document).characters,
        }),
      ),
    };

    const tx = db.transaction(
      [this.metaStore, this.chunkStore, this.storeName],
      'readwrite',
    );
    tx.objectStore(this.metaStore).put(record);
    const chunks = tx.objectStore(this.chunkStore);
    for (const write of snapshot.writes) {
      chunks.put({ id, chunkId: write.chunkId, nodes: write.nodes } satisfies ChunkRecord);
    }
    // 清理本轮不再引用的片（回删并段 / 结构变化留下的孤儿）
    for (const stale of previousIds) {
      if (!snapshot.chunkIds.has(stale)) chunks.delete([id, stale]);
    }
    // 迁移：同 id 的旧整本记录已由分片记录取代
    tx.objectStore(this.storeName).delete(id);
    await transactionDone(tx);

    this.slices.set(id, { root: snapshot.root, chunkIds: snapshot.chunkIds });
  }

  async load(id: string): Promise<BookDocument | undefined> {
    const db = await this.openDb();
    const meta = await this.readMetaRecord(db, id);
    if (meta !== undefined && meta.format === CHUNK_FORMAT) {
      const chunks = await this.readChunks(db, id);
      const root = fromSkeleton(meta.skeleton, chunks);
      if (root === undefined) {
        // 缺片 = 记录损坏：不返回半截文档，交由调用方按「无草稿」处理
        return undefined;
      }
      return { schemaVersion: meta.schemaVersion, metadata: meta.metadata, root };
    }
    // 旧格式（整本记录）
    const tx = db.transaction(this.storeName, 'readonly');
    const legacy = await requestToPromise<StoredDocument | undefined>(
      tx.objectStore(this.storeName).get(id) as IDBRequest<StoredDocument | undefined>,
    );
    return legacy?.document;
  }

  async list(): Promise<DocumentSummary[]> {
    const db = await this.openDb();
    const tx = db.transaction([this.metaStore, this.storeName], 'readonly');
    const metas = await requestToPromise<ChunkedDocumentRecord[]>(
      tx.objectStore(this.metaStore).getAll() as IDBRequest<ChunkedDocumentRecord[]>,
    );
    const legacy = await requestToPromise<StoredDocument[]>(
      tx.objectStore(this.storeName).getAll() as IDBRequest<StoredDocument[]>,
    );
    const merged = new Map<string, DocumentSummary>();
    for (const record of legacy) {
      merged.set(
        record.id,
        buildDocumentSummary({
          id: record.id,
          metadata: record.metadata,
          updatedAt: record.updatedAt,
        }),
      );
    }
    for (const record of metas) {
      merged.set(record.id, this.summaryOfMeta(record));
    }
    return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async query(query: DocumentQuery = {}): Promise<BookQueryResult> {
    return queryDocumentSummaries(await this.list(), query);
  }

  async updateSummary(
    id: string,
    patch: DocumentSummaryPatch,
  ): Promise<DocumentSummary | undefined> {
    const db = await this.openDb();
    const meta = await this.readMetaRecord(db, id);
    if (meta === undefined) {
      return undefined;
    }
    const summary = mergeDocumentSummary(this.summaryOfMeta(meta), patch);
    const tx = db.transaction(this.metaStore, 'readwrite');
    tx.objectStore(this.metaStore).put({ ...meta, summary, updatedAt: summary.updatedAt });
    await transactionDone(tx);
    return summary;
  }

  async delete(id: string): Promise<boolean> {
    const db = await this.openDb();
    const meta = await this.readMetaRecord(db, id);
    const tx = db.transaction(
      [this.metaStore, this.chunkStore, this.storeName],
      'readwrite',
    );
    const legacyStore = tx.objectStore(this.storeName);
    const existing = await requestToPromise<StoredDocument | undefined>(
      legacyStore.get(id) as IDBRequest<StoredDocument | undefined>,
    );
    const chunkIds = meta?.chunkIds ?? [];
    if (meta === undefined && existing === undefined && chunkIds.length === 0) {
      return false;
    }
    tx.objectStore(this.metaStore).delete(id);
    const chunks = tx.objectStore(this.chunkStore);
    for (const chunkId of chunkIds) chunks.delete([id, chunkId]);
    if (existing !== undefined) legacyStore.delete(id);
    await transactionDone(tx);
    this.slices.delete(id);
    return true;
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(
      [this.metaStore, this.chunkStore, this.storeName],
      'readwrite',
    );
    tx.objectStore(this.metaStore).clear();
    tx.objectStore(this.chunkStore).clear();
    tx.objectStore(this.storeName).clear();
    await transactionDone(tx);
    this.slices.clear();
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
