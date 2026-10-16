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

底层工具 `openDatabase` / `requestToPromise` / `transactionDone` 亦从本包导出，
供**自定义适配器**实现复用；属内部工具，常规使用无需直接调用。

## 典型用法：编辑保存 + 书架列表

> **保存策略（大文档必读）**：`save` 是整本 `put`（结构化克隆，成本与文档规模成正比，实测
> 1.8 MB 文档约 27 ms），**不要**在每个变更回调里直接整本写——那会把一个几十毫秒的
> 主线程任务压到输入帧上，表现为「打字一停手就卡一下」。正确做法：节流合并 + 放到空闲
> 时段 + 单飞去重，快照走 `getSharedDocument()`（共享 IR，未变子树零转换）。

```ts
import { IndexedDbAdapter } from '@bibliotype/adapter-indexeddb';

const storage = new IndexedDbAdapter();
const BOOK_ID = 'lunyu-jijie';

let timer: ReturnType<typeof setTimeout> | undefined;

/** 取快照并落盘：快照与保存基准在同一同步帧完成，await 期间的新编辑仍是「未保存」 */
async function persist(): Promise<void> {
  const snapshot = editor.getSharedDocument();   // 共享 IR：未变子树零转换
  editor.markSaved();                            // 基准对齐（先对齐再 await）
  await storage.save(BOOK_ID, snapshot);
}

/* 变更订阅只做排队；真正的写库放到空闲时段（无该 API 时回退下一个宏任务） */
const off = editor.onChange(() => {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    const run = (): void => void persist();
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, 1200);
});

/* 手动保存 / 卸载兜底：取消排队立即写一轮 */
async function saveNow(): Promise<void> {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  await persist();
}

/* 书架页 */
for (const { id, title, updatedAt } of await storage.list()) {
  console.log(id, title, new Date(updatedAt).toLocaleString());
}

off();
```

> 完整实现（节流合并 / 空闲落盘 / 上限兜底 / 单飞去重 / 失败重试 / 状态机）见示例应用
> [`apps/demo/src/composables/use-draft-autosave.ts`](../apps/demo/src/composables/use-draft-autosave.ts)，
> 演示入口在 `apps/demo/src/App.vue`。

## 规划中的适配器

- `@bibliotype/adapter-sqlite`：Electron 端（数据库）；
- `@bibliotype/adapter-http`：远端（自建服务）。

两者均只需实现同一 `StorageAdapter` 契约，consume 方代码无需改动。

## 相关

- 包参考：[`@bibliotype/adapter-indexeddb`](../packages/adapter-indexeddb/README.md)
- IR 序列化约束：[01 数据模型](01-document-model.md)
- 协同同步：[09 协同编辑](09-collab.md)
