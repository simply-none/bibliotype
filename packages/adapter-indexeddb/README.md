# @bibliotype/adapter-indexeddb

[`@bibliotype/core`](../core/README.md) 存储契约（`StorageAdapter`）的 Web 实现：
`IndexedDbAdapter`（浏览器持久化）与 `MemoryAdapter`（内存 / SSR / 测试）。

零依赖封装，非浏览器环境（Node / SSR）请使用内存实现或注入 `factory`（如 `fake-indexeddb`）。

## 安装

```bash
pnpm add @bibliotype/adapter-indexeddb @bibliotype/core
```

## 快速上手

```ts
import { IndexedDbAdapter, MemoryAdapter } from '@bibliotype/adapter-indexeddb';

const adapter = new IndexedDbAdapter({ databaseName: 'my-ebooks' });

await adapter.save('lunyu', document);      // 整体覆盖保存（IR 全量持久化）
const doc = await adapter.load('lunyu');    // 未命中返回 undefined（不抛错）
const list = await adapter.list();          // 文档摘要，按 updatedAt 降序
await adapter.delete('lunyu');              // 存在并已删除返回 true
await adapter.clear();                      // 清空全部文档
await adapter.close();                      // 释放连接（仍可再次使用，自动重开）

/* Node / SSR / 测试：同接口的内存实现 */
const memory = new MemoryAdapter();
```

### `IndexedDbAdapterOptions`

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `databaseName` | `'bibliotype'` | 数据库名 |
| `storeName` | `'documents'` | 对象仓库名 |
| `version` | `1` | 数据库版本（结构升级时递增） |
| `factory` | 全局 `indexedDB` | 注入 IDB 工厂（测试用 `fake-indexeddb`） |

另导出 IDB 原生封装（供自定义适配器复用）：`openDatabase`、`requestToPromise`、`transactionDone`。

## 契约摘要（`StorageAdapter`）

- `save(id, document, options?)`：整体覆盖语义；`options.updatedAt` 可注入以获得确定性；
- `load(id)`：未命中返回 `undefined`；
- `list()`：摘要（`id` / `title` / `updatedAt`）按更新时间降序；
- `delete(id)` / `clear()` / `close()`。

存储记录含冗余元数据（列表页免解析全文），并保留 `updatedAt`；Electron（SQLite）与远端（HTTP）
适配器可循同一契约另行实现（如 `@bibliotype/adapter-sqlite`、`@bibliotype/adapter-http`）。

## 相关

- 功能参考：[docs/10-storage-adapters.md](../../docs/10-storage-adapters.md)
- 契约定义：[`@bibliotype/core`](../core/README.md)
- 仓库主页：[bibliotype](../../README.md)
