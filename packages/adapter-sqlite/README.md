# @bibliotype/adapter-sqlite

SQLite 存储适配器：文档分片、资产 BLOB、书架摘要与历史版本。
**包本身不安装、不打包任何 SQLite 引擎**——驱动由宿主安装并注入（Electron 主进程、
Node 服务、浏览器 WASM 均可），适配器只读取端口。

能力与 `@bibliotype/adapter-indexeddb` 持平：`StorageAdapter` + `AssetStore` +
`BookLibraryStore` + `BookSummaryStore` + `DocumentVersionStore`。

## 安装

```bash
pnpm add @bibliotype/adapter-sqlite @bibliotype/core

# 宿主自选一个引擎（二选一，包不会替你装）
pnpm add better-sqlite3     # Node / Electron 主进程
pnpm add sql.js             # 浏览器 / 无原生编译环境
```

## 快速上手

```ts
/* Node / Electron 主进程 */
import Database from 'better-sqlite3';
import { createBetterSqliteDriver, SqliteAdapter, SqliteAssetStore, SqliteVersionStore }
  from '@bibliotype/adapter-sqlite';

const driver = createBetterSqliteDriver(new Database('library.db'));
const storage = new SqliteAdapter({ driver });
const assets = new SqliteAssetStore({ driver });
const versions = new SqliteVersionStore({ driver });

await storage.save('lunyu', document, { updatedAt: Date.now() });
const restored = await storage.load('lunyu');
const page = await storage.query({ text: '朱熹', sortBy: 'recentRead' });
await storage.updateSummary('lunyu', { progress: 0.32, lastOpenedAt: Date.now() });
```

```ts
/* 浏览器 / 测试：sql.js（WASM） */
import initSqlJs from 'sql.js';
import { createSqlJsDriver, SqliteAdapter } from '@bibliotype/adapter-sqlite';

const SQL = await initSqlJs();
const storage = new SqliteAdapter({ driver: createSqlJsDriver(new SQL.Database()) });
```

`SqliteAdapterOptions`：`driver`、`epoch?`（片 id 前缀，测试注入固定值）、
`now?`（时间源）。同一 `driver` 可同时供文档、资产、版本、KV 使用，迁移只跑一次。

## API 概览

| 分组 | 导出 |
| --- | --- |
| 驱动端口 | `SqliteDriver`（`name` / `exec` / `prepare` / `transaction` / `close`）、`SqliteStatement`、`SqlValue`、`SqlParams` |
| 驱动包装 | `createBetterSqliteDriver(db)`、`createSqlJsDriver(db)`；`BetterSqliteDatabaseLike` / `SqlJsDatabaseLike` |
| 迁移 | `ensureSchema(driver)`、`SQLITE_SCHEMA_VERSION`、`resetSchemaCache(driver)` |
| 文档 / 书架 | `SqliteAdapter`：`save` / `load` / `list` / `delete` / `clear` / `close` / `query` / `updateSummary`、`driverName` |
| 资产 | `SqliteAssetStore`：`putAsset` / `getAsset` / `listAssets` / `deleteAsset` |
| 历史版本 | `SqliteVersionStore`：`listVersions` / `saveVersion` / `loadVersion` / `deleteVersion` / `pruneVersions` |
| 小载荷 KV | `SqliteKeyValueStore`：`get` / `set` / `remove` / `entries` |

## 表结构（`PRAGMA user_version = 1`）

| 表 | 说明 |
| --- | --- |
| `documents` | 骨架 + 书架摘要 + 元数据；`list()` 只读摘要，不解析正文 |
| `chunks` | 片内容，`ON DELETE CASCADE` 随文档删除 |
| `assets` | 资产 BLOB + 元信息（kind / mediaType / name / hash / 长度） |
| `versions` | 历史快照（meta + snapshot + createdAt） |
| `settings` | 样式 / 偏好小载荷 |

首次打开自动建表建索引，重复打开幂等；库版本高于适配器支持时直接报错。

## 与 IndexedDbAdapter 的差异

- `clear()` 只清 `documents`（级联 `chunks`），**资产与历史版本保留**；
- `close()` 为空操作：不关闭宿主驱动，之后仍可继续读写；
- 版本仓与文档同库不同表（IndexedDB 用独立数据库）；
- 并发写依赖 SQLite 自身写锁，不要用多个写连接做长事务。

## 事务与错误

- 单次 `save` 在一个事务内完成：upsert 文档、写变更片、删孤儿片，失败整体回滚；
- 驱动端口不支持嵌套事务（嵌套直接抛错），多步写入请合并到同一个回调；
- 缺片 / 脏 JSON 视为记录损坏：`load()` 返回 `undefined`，不返回半截文档；
- BLOB 读出统一归一化为 `Uint8Array`，兼容 better-sqlite3 的 Buffer。

## 测试

公共契约套件在 `@bibliotype/core/testing`（测试专用子入口）：

```ts
import { runStorageContractTests } from '@bibliotype/core/testing';

runStorageContractTests({ name: 'SqliteAdapter', create: () => new SqliteAdapter({ driver }) });
```

包内测试用 `sql.js`（devDependency）跑真实 SQL、分片增量、事务回滚与 1 MB BLOB 往返。

## 相关

- 功能参考：[docs/10-storage-adapters.md](../../docs/10-storage-adapters.md)
- 分片内核：[`@bibliotype/core`](../core/README.md)
- 仓库主页：[bibliotype](../../README.md)
