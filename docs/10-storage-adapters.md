# 10 存储适配器

> 涉及包：`@bibliotype/adapter-indexeddb`（core 定义契约）　·　相关：[01 数据模型](01-document-model.md)、[09 协同编辑](09-collab.md)

存储采用**端口-适配器**结构：`@bibliotype/core` 定义 `StorageAdapter` 契约（Port），
各 `adapter-*` 包提供实现。IR 为纯 JSON，可直接序列化持久化。

## StorageAdapter 契约（core）

```ts
interface StorageAdapter {
  readonly name: string;                                              // 'indexeddb' / 'memory' / …
  save(id: string, document: BookDocument, options?: SaveOptions): Promise<void>;
  load(id: string): Promise<BookDocument | undefined>;
  list(): Promise<DocumentSummary[]>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
```

约定：

- `save` 为**整体覆盖**语义（IR 全量持久化）；
- `load` 未命中返回 `undefined`（不抛错）；
- `list` 按 `updatedAt` 降序返回摘要（`{ id, title, updatedAt }`）；
- `delete` 返回是否存在并已删除；`close` 释放底层资源，调用后仍可再次使用（延迟重开）。

辅助类型：

```ts
interface StoredDocument { id: string; document: BookDocument; metadata: BookMetadata; updatedAt: number; }
interface DocumentSummary { id: string; title: string; updatedAt: number; }
interface SaveOptions { updatedAt?: number; }   // 注入时间以获得确定性（测试）
```

## MemoryAdapter（内存实现）

零依赖、同步数据的内存实现，适合测试与 SSR；随 `@bibliotype/adapter-indexeddb` 一并导出。

## IndexedDbAdapter（Web 持久化）

```ts
import { IndexedDbAdapter } from '@bibliotype/adapter-indexeddb';

const storage = new IndexedDbAdapter({
  databaseName: 'bibliotype',   // 默认 'bibliotype'
  storeName: 'documents',       // 默认 'documents'
  version: 1,                   // 结构升级时递增（升级自动建仓）
  factory,                      // 注入 IDB 工厂（测试用 fake-indexeddb）；默认取全局 indexedDB
});

await storage.save('lunyu', document);
const loaded = await storage.load('lunyu');     // BookDocument | undefined
const summaries = await storage.list();         // 按 updatedAt 降序
await storage.delete('lunyu');                  // 是否删除成功
await storage.close();                          // 释放连接（之后可再用，自动重开）
```

实现要点：

- 延迟打开数据库（首次操作时 `open`）；
- `save` 以 `put` 整体覆盖，记录含冗余 `metadata`（列表页免解析全文）；
- 非浏览器环境抛错提示——请使用 `MemoryAdapter` 或注入 `factory`。

## 典型用法：编辑保存 + 书架列表

```ts
import { IndexedDbAdapter } from '@bibliotype/adapter-indexeddb';

const storage = new IndexedDbAdapter();
const off = editor.onChange(async (doc) => {
  await storage.save('lunyu-jijie', doc);       // 每次变更整体覆盖
});

/* 书架页 */
for (const { id, title, updatedAt } of await storage.list()) {
  console.log(id, title, new Date(updatedAt).toLocaleString());
}

off();
```

## 规划中的适配器

- `@bibliotype/adapter-sqlite`：Electron 端（数据库）；
- `@bibliotype/adapter-http`：远端（自建服务）。

两者均只需实现同一 `StorageAdapter` 契约，consume 方代码无需改动。

## 相关

- 包参考：[`@bibliotype/adapter-indexeddb`](../packages/adapter-indexeddb/README.md)
- IR 序列化约束：[01 数据模型](01-document-model.md)
- 协同同步：[09 协同编辑](09-collab.md)
