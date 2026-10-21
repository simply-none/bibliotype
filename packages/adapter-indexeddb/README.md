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

await adapter.save('lunyu', document);      // 分片增量保存（只写变更片）
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
| `storeName` | `'documents'` | 对象仓库名（分片仓派生为 `<name>-meta` / `<name>-chunks`） |
| `version` | `2` | 数据库版本（结构升级时递增；v1 旧库自动升级建仓） |
| `factory` | 全局 `indexedDB` | 注入 IDB 工厂（测试用 `fake-indexeddb`） |

另导出 IDB 原生封装（供自定义适配器复用）：`openDatabase`、`requestToPromise`、`transactionDone`。

## 分片落盘（为什么 `save` 不是整本 `put`）

整本 `put` 的结构化克隆在主线程同步执行，成本与文档体积成正比——大书每次保存都是一次
几十毫秒的卡顿。本适配器把文档切成「骨架 + 片」：

| 仓 | 内容 | 说明 |
| --- | --- | --- |
| `<storeName>-meta` | 骨架 | 文档元信息 + 结构树，被切出的子树为 `{ $chunk: id }` 占位 |
| `<storeName>-chunks` | 片 | 一条记录 = 一组连续兄弟节点（估算体积 ≤ 32 KiB） |
| `<storeName>` | 旧格式 | 仅在读取旧数据时命中，下次写入自动迁移并删除 |

**增量判定靠对象引用**：IR 快照走结构共享（`getSharedDocument`），未改子树与上一轮是同一
对象引用 → 复用片 id 且跳过写入；结构变化（增删块）时用「片首节点引用」对齐旧片，
只重切变化的那棵子树。写库只发生在真正变化的片上（通常 1 片、几 KB）。

分片切分器 `buildChunkedSnapshot` / `fromSkeleton`（及 `CHUNK_BUDGET_BYTES`）也单独导出，
供 SQLite / 文件系统等自定义适配器复用同一套增量策略。

## 契约摘要（`StorageAdapter`）

- `save(id, document, options?)`：整体覆盖语义；`options.updatedAt` 可注入以获得确定性；
- `load(id)`：未命中返回 `undefined`；
- `list()`：摘要（`id` / `title` / `updatedAt`）按更新时间降序；
- `delete(id)` / `clear()` / `close()`。

存储记录含冗余元数据（列表页免解析全文），并保留 `updatedAt`；Electron（SQLite）与远端（HTTP）
适配器可循同一契约另行实现（如 `@bibliotype/adapter-sqlite`、`@bibliotype/adapter-http`）。

## 可选能力：书架摘要与历史版本

`IndexedDbAdapter` 与 `MemoryAdapter` 在必选方法之外实现两个可选端口（调用方需先探测）：

```ts
import { isBookLibraryStore, isBookSummaryStore } from '@bibliotype/core';
import { IndexedDbVersionStore } from '@bibliotype/adapter-indexeddb';

if (isBookLibraryStore(adapter)) {
  const page = await adapter.query({ text: '朱熹', sortBy: 'recentRead', groupBy: 'tag' });
}

/* 只改摘要、不重写正文：阅读进度 / 最近阅读 / 封面 / 标签 */
if (isBookSummaryStore(adapter)) {
  await adapter.updateSummary('lunyu', { progress: 0.32, lastOpenedAt: Date.now() });
}

/* 历史快照：独立数据库（默认 bibliotype-versions），复合主键 [documentId, version] */
const versions = new IndexedDbVersionStore();
await versions.saveVersion(snapshot);
await versions.pruneVersions('lunyu', { maxCount: 20, now: Date.now() });
```

- 摘要字段全部可选，旧记录缺字段由 `mergeDocumentSummary` 回退，**不升库版本、不重写旧记录**；
- 字数在 `save` 时用 `countDocumentStats` 算一次落库，书架渲染不再遍历 IR；
- 版本仓与文档库分开，避免快照把正文库撑大；`MemoryVersionStore` 供测试与 SSR 使用；
- 存储实现只执行删除，保留策略的「该删哪些」由 core 的 `selectExpiredSnapshots` 决定。

两个适配器共用 `src/__tests__/storage-contract.ts` 的公共契约套件（含可选能力探测），
新增适配器建议直接复用该套件。

## 相关

- 功能参考：[docs/10-storage-adapters.md](../../docs/10-storage-adapters.md)
- 契约定义：[`@bibliotype/core`](../core/README.md)
- 仓库主页：[bibliotype](../../README.md)
