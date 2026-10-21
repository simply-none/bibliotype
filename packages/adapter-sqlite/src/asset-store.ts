/**
 * SQLite 资产存储（H2）
 *
 * 二进制（插图 / 封面 / 字体 / 朗读音频）以 BLOB 落库：
 * - 写入返回含内容哈希的元信息，便于去重与打包校验；
 * - 读出统一归一化为 `Uint8Array`（better-sqlite3 返回 Buffer，未显式包驱动时也能用）；
 * - `putAsset` 为覆盖语义，`getAsset` 未命中返回 undefined。
 */
import {
  hashAssetBytes,
  resolveAssetKind,
  type AssetKind,
  type AssetPayload,
  type AssetRef,
  type AssetStore,
  type PutAssetOptions,
} from '@bibliotype/core';
import type { SqliteDriver } from './driver.js';
import { ensureSchema } from './schema.js';

/** 资产存储选项 */
export interface SqliteAssetStoreOptions {
  /** 宿主注入的驱动（可与文档适配器共用） */
  driver: SqliteDriver;
}

/** `assets` 行 */
interface AssetRow {
  id: string;
  kind: string;
  media_type: string;
  name: string | null;
  byte_length: number;
  hash: string;
  data: unknown;
}

/** 把驱动返回的 BLOB 归一化为独立字节数组 */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

/** 行 → 元信息 */
function toRef(row: Omit<AssetRow, 'data'>): AssetRef {
  const ref: AssetRef = {
    id: row.id,
    kind: row.kind as AssetKind,
    mediaType: row.media_type,
    byteLength: row.byte_length,
    hash: row.hash,
  };
  if (row.name !== null && row.name !== '') ref.name = row.name;
  return ref;
}

/** SQLite 资产存储 */
export class SqliteAssetStore implements AssetStore {
  readonly name = 'sqlite-assets';

  private readonly driver: SqliteDriver;

  constructor(options: SqliteAssetStoreOptions) {
    this.driver = options.driver;
  }

  async putAsset(
    id: string,
    payload: AssetPayload,
    options: PutAssetOptions = {},
  ): Promise<AssetRef> {
    await ensureSchema(this.driver);
    const kind = options.kind ?? resolveAssetKind(payload.mediaType);
    const hash = hashAssetBytes(payload.data);
    const name = payload.name ?? null;

    await this.driver
      .prepare(
        `INSERT INTO assets (id, kind, media_type, name, byte_length, hash, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           media_type = excluded.media_type,
           name = excluded.name,
           byte_length = excluded.byte_length,
           hash = excluded.hash,
           data = excluded.data`,
      )
      .run([id, kind, payload.mediaType, name, payload.data.byteLength, hash, payload.data]);

    const ref: AssetRef = {
      id,
      kind,
      mediaType: payload.mediaType,
      byteLength: payload.data.byteLength,
      hash,
    };
    if (payload.name !== undefined && payload.name !== '') ref.name = payload.name;
    return ref;
  }

  async getAsset(id: string): Promise<AssetPayload | undefined> {
    await ensureSchema(this.driver);
    const row = await this.driver
      .prepare('SELECT id, kind, media_type, name, byte_length, hash, data FROM assets WHERE id = ?')
      .get<AssetRow>([id]);
    if (row === undefined) return undefined;
    const payload: AssetPayload = {
      mediaType: row.media_type,
      data: toBytes(row.data),
    };
    if (row.name !== null && row.name !== '') payload.name = row.name;
    return payload;
  }

  async listAssets(): Promise<AssetRef[]> {
    await ensureSchema(this.driver);
    const rows = await this.driver
      .prepare('SELECT id, kind, media_type, name, byte_length, hash FROM assets ORDER BY id ASC')
      .all<Omit<AssetRow, 'data'>>();
    return rows.map((row) => toRef(row));
  }

  async deleteAsset(id: string): Promise<boolean> {
    await ensureSchema(this.driver);
    const result = await this.driver.prepare('DELETE FROM assets WHERE id = ?').run([id]);
    return result.changes > 0;
  }
}
