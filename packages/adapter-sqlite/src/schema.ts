/**
 * SQLite 表结构与迁移（H2）
 *
 * 版本通过 `PRAGMA user_version` 记录，迁移按版本递进、幂等：
 * - 新建库：一次建表并写入版本号；
 * - 已有库：只在版本落后时补迁移，不重写数据；
 * - 版本高于本适配器支持时直接报错（避免旧代码写坏新库）。
 *
 * 表分工：
 * - `documents`：骨架 + 书架摘要 + 元数据（list 不读 chunks）；
 * - `chunks`：片内容，`ON DELETE CASCADE` 随文档级联删除；
 * - `assets`：资产 BLOB（与文档生命周期独立）；
 * - `versions`：历史快照（与文档库分开，清空书库不影响历史）；
 * - `settings`：宿主小载荷（样式 / 偏好），由 `SqliteKeyValueStore` 使用。
 */
import type { SqliteDriver } from './driver.js';

/** 当前 schema 版本 */
export const SQLITE_SCHEMA_VERSION = 1;

/** v1 建表语句（逐条执行，便于定位失败语句） */
const SCHEMA_V1: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    metadata TEXT NOT NULL,
    summary TEXT NOT NULL,
    skeleton TEXT NOT NULL,
    chunk_ids TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents (updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS chunks (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    nodes TEXT NOT NULL,
    PRIMARY KEY (doc_id, chunk_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    media_type TEXT NOT NULL,
    name TEXT,
    byte_length INTEGER NOT NULL,
    hash TEXT NOT NULL,
    data BLOB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS versions (
    doc_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    meta TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_versions_created_at ON versions (doc_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

/** 已迁移的驱动（弱引用，驱动释放后自动回收） */
const migrated = new WeakSet<SqliteDriver>();

/** 读取当前 schema 版本 */
async function readUserVersion(driver: SqliteDriver): Promise<number> {
  const row = await driver.prepare('PRAGMA user_version').get<{ user_version: number }>();
  const value = row?.user_version;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 确保表结构就绪（幂等）
 *
 * 同一驱动只跑一次；`PRAGMA foreign_keys` 是连接级设置，每次都要打开，
 * 但重复执行无副作用，故随迁移一起设置。
 */
export async function ensureSchema(driver: SqliteDriver): Promise<void> {
  if (migrated.has(driver)) return;
  await driver.exec('PRAGMA foreign_keys = ON');
  const current = await readUserVersion(driver);
  if (current > SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `SQLite 数据库版本 ${current} 高于当前适配器支持的 ${SQLITE_SCHEMA_VERSION}，请升级 @bibliotype/adapter-sqlite。`,
    );
  }
  if (current < 1) {
    for (const statement of SCHEMA_V1) {
      await driver.exec(statement);
    }
    await driver.exec('PRAGMA user_version = 1');
  }
  migrated.add(driver);
}

/** 显式重置迁移缓存（测试在同一个驱动上重建库时使用） */
export function resetSchemaCache(driver: SqliteDriver): void {
  migrated.delete(driver);
}
