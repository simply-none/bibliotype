/**
 * @bibliotype/adapter-sqlite 统一导出入口
 *
 * 生产包零 SQLite 运行时依赖：驱动由宿主安装并注入（better-sqlite3 / sql.js / 自建封装）。
 * 与 `IndexedDbAdapter` 能力对齐：StorageAdapter + AssetStore + BookLibraryStore +
 * BookSummaryStore + DocumentVersionStore。
 */

/* ---------- 驱动端口与包装 ---------- */
export {
  createBetterSqliteDriver,
  createSqlJsDriver,
} from './driver.js';
export type {
  BetterSqliteDatabaseLike,
  BetterSqliteStatementLike,
  SqlJsDatabaseLike,
  SqlJsStatementLike,
  SqlParams,
  SqliteDriver,
  SqliteRunResult,
  SqliteStatement,
  SqlValue,
} from './driver.js';

/* ---------- 迁移 ---------- */
export { SQLITE_SCHEMA_VERSION, ensureSchema, resetSchemaCache } from './schema.js';

/* ---------- 文档 / 书架 ---------- */
export { SqliteAdapter } from './sqlite-adapter.js';
export type { SqliteAdapterOptions } from './sqlite-adapter.js';

/* ---------- 资产 ---------- */
export { SqliteAssetStore } from './asset-store.js';
export type { SqliteAssetStoreOptions } from './asset-store.js';

/* ---------- 历史版本 ---------- */
export { SqliteVersionStore } from './version-store.js';
export type { SqliteVersionStoreOptions } from './version-store.js';

/* ---------- 小载荷 KV ---------- */
export { SqliteKeyValueStore } from './key-value.js';
export type { SqliteKeyValueStoreOptions } from './key-value.js';

/* ---------- 样式设置 ---------- */
export { SQLiteStyleStore } from './style-store.js';
export type { SQLiteStyleStoreOptions } from './style-store.js';
