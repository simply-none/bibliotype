/**
 * SQLite 历史版本仓（H2 / C7 能力对齐）
 *
 * 与 `IndexedDbVersionStore` 同构：
 * - 快照元信息与正文分列（`meta` / `snapshot`），列表只读元信息；
 * - 同文档同版本覆盖；
 * - 清理只删 `selectExpiredSnapshots` 选出的版本，非法策略抛 `RangeError`。
 *
 * 表在文档库同一个数据库里，但 `clear()` 不会清 versions（历史与书库解耦）。
 */
import {
  selectExpiredSnapshots,
  type DocumentSnapshot,
  type DocumentSnapshotMeta,
  type DocumentVersionStore,
  type SnapshotRetentionPolicy,
} from '@bibliotype/core';
import type { SqliteDriver } from './driver.js';
import { ensureSchema } from './schema.js';

/** 版本仓选项 */
export interface SqliteVersionStoreOptions {
  /** 宿主注入的驱动（可与文档适配器共用） */
  driver: SqliteDriver;
}

/** `versions` 行（列表用） */
interface VersionMetaRow {
  meta: string;
}

/** `versions` 行（读取用） */
interface VersionRow {
  snapshot: string;
}

/** 从完整快照提取元信息 */
function metaOf(snapshot: DocumentSnapshot): DocumentSnapshotMeta {
  const meta: DocumentSnapshotMeta = {
    documentId: snapshot.documentId,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
  };
  if (snapshot.label !== undefined && snapshot.label !== '') meta.label = snapshot.label;
  if (snapshot.wordCount !== undefined) meta.wordCount = snapshot.wordCount;
  return meta;
}

/** 校验元信息结构（脏 JSON 直接丢弃，不让列表崩掉） */
function isMeta(value: unknown): value is DocumentSnapshotMeta {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['documentId'] === 'string' &&
    typeof record['version'] === 'number' &&
    Number.isFinite(record['version']) &&
    typeof record['createdAt'] === 'number' &&
    Number.isFinite(record['createdAt'])
  );
}

/** SQLite 版本仓 */
export class SqliteVersionStore implements DocumentVersionStore {
  readonly name = 'sqlite-versions';

  private readonly driver: SqliteDriver;

  constructor(options: SqliteVersionStoreOptions) {
    this.driver = options.driver;
  }

  async listVersions(documentId: string): Promise<DocumentSnapshotMeta[]> {
    await ensureSchema(this.driver);
    const rows = await this.driver
      .prepare('SELECT meta FROM versions WHERE doc_id = ? ORDER BY version ASC')
      .all<VersionMetaRow>([documentId]);
    const metas: DocumentSnapshotMeta[] = [];
    for (const row of rows) {
      try {
        const parsed: unknown = JSON.parse(row.meta);
        if (isMeta(parsed)) metas.push({ ...parsed });
      } catch {
        /* 脏元信息直接跳过：列表保持可用 */
      }
    }
    return metas.sort((left, right) => left.version - right.version);
  }

  async saveVersion(snapshot: DocumentSnapshot): Promise<DocumentSnapshotMeta> {
    await ensureSchema(this.driver);
    const meta = metaOf(snapshot);
    await this.driver
      .prepare(
        `INSERT INTO versions (doc_id, version, meta, snapshot, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(doc_id, version) DO UPDATE SET
           meta = excluded.meta,
           snapshot = excluded.snapshot,
           created_at = excluded.created_at`,
      )
      .run([
        snapshot.documentId,
        snapshot.version,
        JSON.stringify(meta),
        JSON.stringify(snapshot),
        snapshot.createdAt,
      ]);
    return meta;
  }

  async loadVersion(documentId: string, version: number): Promise<DocumentSnapshot | undefined> {
    await ensureSchema(this.driver);
    const row = await this.driver
      .prepare('SELECT snapshot FROM versions WHERE doc_id = ? AND version = ?')
      .get<VersionRow>([documentId, version]);
    if (row === undefined) return undefined;
    try {
      return JSON.parse(row.snapshot) as DocumentSnapshot;
    } catch {
      return undefined;
    }
  }

  async deleteVersion(documentId: string, version: number): Promise<boolean> {
    await ensureSchema(this.driver);
    const result = await this.driver
      .prepare('DELETE FROM versions WHERE doc_id = ? AND version = ?')
      .run([documentId, version]);
    return result.changes > 0;
  }

  async pruneVersions(
    documentId: string,
    policy: SnapshotRetentionPolicy,
  ): Promise<number[]> {
    await ensureSchema(this.driver);
    const metas = await this.listVersions(documentId);
    const expired = selectExpiredSnapshots(metas, policy);
    if (expired.length === 0) return [];
    const versions = expired.map((meta) => meta.version);

    await this.driver.transaction(async (tx) => {
      for (const version of versions) {
        await tx
          .prepare('DELETE FROM versions WHERE doc_id = ? AND version = ?')
          .run([documentId, version]);
      }
    });
    return versions;
  }
}
