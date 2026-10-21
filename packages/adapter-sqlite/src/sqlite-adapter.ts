/**
 * SQLite 存储适配器（H2）
 *
 * 与 `IndexedDbAdapter` 同构：
 * - 文档按「骨架 + 片」落盘，只重写引用变化的片；
 * - 摘要随正文保存在 `documents.summary`，`list()` 不解析正文；
 * - 缺片视为记录损坏，`load()` 返回 undefined（不返回半截文档）；
 * - `clear()` 只清文档与片（资产、历史版本独立保留）；
 * - `close()` 不关闭宿主驱动（生命周期归宿主）。
 */
import {
  buildChunkedSnapshot,
  buildDocumentSummary,
  carryOverSummaryFields,
  countDocumentStats,
  fromSkeleton,
  isDocumentSummary,
  mergeDocumentSummary,
  queryDocumentSummaries,
  type BookDocument,
  type BookLibraryStore,
  type BookMetadata,
  type BookNode,
  type BookQueryResult,
  type BookSummaryStore,
  type ChunkSlice,
  type DocumentQuery,
  type DocumentSummary,
  type DocumentSummaryPatch,
  type SaveOptions,
  type SkeletonNode,
  type StorageAdapter,
} from '@bibliotype/core';
import type { SqliteDriver } from './driver.js';
import { ensureSchema } from './schema.js';

/** 适配器选项 */
export interface SqliteAdapterOptions {
  /** 宿主注入的驱动 */
  driver: SqliteDriver;
  /** 片 id 的 epoch 前缀（缺省取当前时间；测试可注入固定值） */
  epoch?: number;
  /** 时间源（缺省 Date.now；测试注入固定值） */
  now?: () => number;
}

/** `documents` 行（含正文骨架，保存路径使用） */
interface DocumentRow {
  id: string;
  title: string;
  updated_at: number;
  schema_version: string;
  metadata: string;
  summary: string;
  skeleton: string;
  chunk_ids: string;
}

/** `documents` 行（读取路径） */
interface ContentRow {
  schema_version: string;
  metadata: string;
  skeleton: string;
}

/** `documents` 行（列表 / 摘要路径） */
interface SummaryRow {
  id: string;
  updated_at: number;
  metadata: string;
  summary: string;
}

/** `chunks` 行 */
interface ChunkRow {
  chunk_id: string;
  nodes: string;
}

/** 分片记忆（跨保存复用，避免整本重切） */
interface SliceMemo {
  root: ChunkSlice;
  chunkIds: Set<string>;
}

/** 安全 JSON 解析（失败返回 undefined，由调用方按损坏处理） */
function parseJson<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** 解析片 id 列表（过滤非法项） */
function parseChunkIds(raw: string): string[] {
  const parsed = parseJson<unknown>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

/** SQLite 存储适配器（文档 + 书架摘要 + 摘要补丁） */
export class SqliteAdapter implements StorageAdapter, BookLibraryStore, BookSummaryStore {
  readonly name = 'sqlite';

  private readonly driver: SqliteDriver;
  private readonly chunkEpoch: number;
  private readonly now: () => number;
  private readonly chunkIds = new WeakMap<BookNode, string>();
  private readonly slices = new Map<string, SliceMemo>();
  private chunkSeq = 0;

  constructor(options: SqliteAdapterOptions) {
    this.driver = options.driver;
    this.chunkEpoch = options.epoch ?? Date.now();
    this.now = options.now ?? Date.now;
  }

  /** 底层驱动名称（诊断用） */
  get driverName(): string {
    return this.driver.name;
  }

  /** 分配新片 id（epoch 前缀 + 自增，跨会话不重号） */
  private nextChunkId(): string {
    this.chunkSeq += 1;
    return `c${this.chunkEpoch}-${this.chunkSeq}`;
  }

  /** 读保存路径所需的整行（无则 undefined） */
  private async readDocumentRow(id: string): Promise<DocumentRow | undefined> {
    return this.driver
      .prepare(
        `SELECT id, title, updated_at, schema_version, metadata, summary, skeleton, chunk_ids
         FROM documents WHERE id = ?`,
      )
      .get<DocumentRow>([id]);
  }

  /** 取行内摘要（旧记录 / 脏 JSON 时用元数据即时构建，不写回） */
  private summaryOf(row: { id: string; metadata: string; updated_at: number; summary: string }): DocumentSummary {
    const parsed = parseJson<unknown>(row.summary);
    if (isDocumentSummary(parsed)) return { ...parsed };
    const metadata = parseJson<BookMetadata>(row.metadata) ?? { title: row.id };
    return buildDocumentSummary({
      id: row.id,
      metadata,
      updatedAt: row.updated_at,
    });
  }

  /** 读某文档全部片 */
  private async readChunks(id: string): Promise<Map<string, BookNode[]>> {
    const rows = await this.driver
      .prepare('SELECT chunk_id, nodes FROM chunks WHERE doc_id = ?')
      .all<ChunkRow>([id]);
    const map = new Map<string, BookNode[]>();
    for (const row of rows) {
      const nodes = parseJson<BookNode[]>(row.nodes);
      if (Array.isArray(nodes)) map.set(row.chunk_id, nodes);
    }
    return map;
  }

  async save(id: string, document: BookDocument, options: SaveOptions = {}): Promise<void> {
    await ensureSchema(this.driver);
    const prev = await this.readDocumentRow(id);
    const memo = this.slices.get(id);
    /* 旧片集合：库内记录 ∪ 内存记忆（内存可能更新），避免漏删或误留 */
    const previousIds = new Set<string>([
      ...(prev !== undefined ? parseChunkIds(prev.chunk_ids) : []),
      ...(memo?.chunkIds ?? []),
    ]);

    const snapshot = buildChunkedSnapshot(
      document.root,
      memo?.root,
      this.chunkIds,
      () => this.nextChunkId(),
    );

    const updatedAt = options.updatedAt ?? this.now();
    const summary = carryOverSummaryFields(
      prev !== undefined ? this.summaryOf(prev) : undefined,
      buildDocumentSummary({
        id,
        metadata: document.metadata,
        updatedAt,
        wordCount: countDocumentStats(document).characters,
      }),
    );
    const skeleton = JSON.stringify(snapshot.skeleton);
    const chunkIds = JSON.stringify([...snapshot.chunkIds]);
    const metadata = JSON.stringify(document.metadata);

    await this.driver.transaction(async (tx) => {
      await tx
        .prepare(
          `INSERT INTO documents (id, title, updated_at, schema_version, metadata, summary, skeleton, chunk_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             updated_at = excluded.updated_at,
             schema_version = excluded.schema_version,
             metadata = excluded.metadata,
             summary = excluded.summary,
             skeleton = excluded.skeleton,
             chunk_ids = excluded.chunk_ids`,
        )
        .run([
          id,
          document.metadata.title,
          updatedAt,
          document.schemaVersion,
          metadata,
          JSON.stringify(summary),
          skeleton,
          chunkIds,
        ]);

      for (const write of snapshot.writes) {
        await tx
          .prepare(
            `INSERT INTO chunks (doc_id, chunk_id, nodes) VALUES (?, ?, ?)
             ON CONFLICT(doc_id, chunk_id) DO UPDATE SET nodes = excluded.nodes`,
          )
          .run([id, write.chunkId, JSON.stringify(write.nodes)]);
      }

      for (const stale of previousIds) {
        if (snapshot.chunkIds.has(stale)) continue;
        await tx.prepare('DELETE FROM chunks WHERE doc_id = ? AND chunk_id = ?').run([id, stale]);
      }
    });

    this.slices.set(id, { root: snapshot.root, chunkIds: snapshot.chunkIds });
  }

  async load(id: string): Promise<BookDocument | undefined> {
    await ensureSchema(this.driver);
    const row = await this.driver
      .prepare('SELECT schema_version, metadata, skeleton FROM documents WHERE id = ?')
      .get<ContentRow>([id]);
    if (row === undefined) return undefined;

    const skeleton = parseJson<SkeletonNode>(row.skeleton);
    const metadata = parseJson<BookMetadata>(row.metadata);
    if (skeleton === undefined || metadata === undefined) return undefined;

    const chunks = await this.readChunks(id);
    const root = fromSkeleton(skeleton, chunks);
    /* 缺片 = 记录损坏：不返回半截文档 */
    if (root === undefined) return undefined;

    return { schemaVersion: row.schema_version, metadata, root };
  }

  async list(): Promise<DocumentSummary[]> {
    await ensureSchema(this.driver);
    const rows = await this.driver
      .prepare(
        `SELECT id, updated_at, metadata, summary FROM documents ORDER BY updated_at DESC`,
      )
      .all<SummaryRow>();
    return rows.map((row) => this.summaryOf(row));
  }

  async query(query: DocumentQuery = {}): Promise<BookQueryResult> {
    return queryDocumentSummaries(await this.list(), query);
  }

  async updateSummary(
    id: string,
    patch: DocumentSummaryPatch,
  ): Promise<DocumentSummary | undefined> {
    await ensureSchema(this.driver);
    const row = await this.driver
      .prepare('SELECT id, updated_at, metadata, summary FROM documents WHERE id = ?')
      .get<SummaryRow>([id]);
    if (row === undefined) return undefined;

    const summary = mergeDocumentSummary(this.summaryOf(row), patch);
    await this.driver
      .prepare('UPDATE documents SET summary = ?, updated_at = ? WHERE id = ?')
      .run([JSON.stringify(summary), summary.updatedAt, id]);
    return summary;
  }

  async delete(id: string): Promise<boolean> {
    await ensureSchema(this.driver);
    const result = await this.driver.prepare('DELETE FROM documents WHERE id = ?').run([id]);
    this.slices.delete(id);
    return result.changes > 0;
  }

  /** 清空文档与片（资产、历史版本、设置保留） */
  async clear(): Promise<void> {
    await ensureSchema(this.driver);
    await this.driver.exec('DELETE FROM documents');
    this.slices.clear();
  }

  /** 关闭适配器：不关闭宿主驱动（下次操作仍可用） */
  async close(): Promise<void> {
    /* 驱动生命周期归宿主：这里刻意不做任何事，也不清分片记忆 */
  }
}
