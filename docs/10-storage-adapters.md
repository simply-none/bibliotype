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
  storeName: 'documents',       // 默认 'documents'（分片仓派生为 documents-meta / documents-chunks）
  version: 2,                   // 结构升级时递增（升级自动建仓）
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
- **分片落盘**（`version >= 2`）：`save` 把文档切成「骨架 + 片」——骨架存在
  `<storeName>-meta`（文档元信息 + 结构树，被切出的子树用 `{ $chunk }` 占位），片存在
  `<storeName>-chunks`（一条记录 = 一组连续兄弟节点，估算体积 ≤ 32 KiB）；
- **增量判定靠引用**：IR 快照走结构共享（`getSharedDocument`），未改子树与上一轮是同一
  对象引用 → 该片 id 不变且跳过写入。纯文本编辑只写「改动所在的那一片」，
  一轮落盘从「整本结构化克隆（1.8 MB ≈ 27 ms）」降到「几 KB」；
- 旧格式（整本记录）仍可读，读到后**下次保存自动迁移**为分片格式；
- 记录里含冗余 `metadata`（列表页免解析全文）；
- 非浏览器环境抛错提示——请使用 `MemoryAdapter` 或注入 `factory`。

> 分片切分器（`buildChunkedSnapshot` / `fromSkeleton`）也单独导出，供自定义适配器
> （如 Electron 的 SQLite / 文件系统）复用同一套增量策略。

底层工具 `openDatabase` / `requestToPromise` / `transactionDone` 亦从本包导出，
供**自定义适配器**实现复用；属内部工具，常规使用无需直接调用。

## 典型用法：编辑保存 + 书架列表

> **保存策略（大文档必读）**：`save` 一次的结构化克隆成本与「本次写入的体积」成正比。
> 分片落盘后单次通常只有几 KB，但**仍不要在每次按键回调里同步触发**——排队、合流、
> 放到后台 / 空闲时段，才能保证落盘永远不落在输入帧上。快照必须走
> `getSharedDocument()`（共享 IR，未变子树零转换），否则增量判定失效、退回整本重写。

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

/* 变更订阅只做排队；真正的写库放到后台 / 空闲时段 */
const off = editor.onChange(() => {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    const run = (): void => void persist();
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 8000 });
    else run();
  }, 2500);
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

## 书架摘要与查询（H3）

`DocumentSummary` 只在必备字段（`id` / `title` / `updatedAt`）之外**追加可选字段**：
`author` / `isbn` / `tags` / `coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`。
旧库记录缺字段不报错，读取侧用 `mergeDocumentSummary` 回退。

> 兼容红线：**不要给 `StorageAdapter` 加必选方法**。书架能力拆成两个可选端口，
> 调用方必须先探测再使用，避免存量实现与宿主 autosave 被破坏。

```ts
import {
  isBookLibraryStore,   // name + query
  isBookSummaryStore,   // name + updateSummary
  queryDocumentSummaries,
} from '@bibliotype/core';

const summaries = isBookLibraryStore(storage)
  ? (await storage.query({ text: '朱熹', sortBy: 'recentRead', groupBy: 'tag' })).items
  : queryDocumentSummaries(await storage.list(), { text: '朱熹' });
```

| 端口 | 方法 | 实现 |
| --- | --- | --- |
| `BookLibraryStore` | `query(DocumentQuery)` | IndexedDB / 内存 / HTTP（`list` + 纯函数） |
| `BookSummaryStore` | `updateSummary(id, patch)` | IndexedDB / 内存（HTTP 无端点，不实现） |

查询口径（`core/src/storage/query.ts`，纯函数）：

- 检索词按空白切分，**全部命中**才算匹配，覆盖标题 / 作者 / ISBN / 标签；
- 标签筛选为**命中任一**；
- 排序键：`recentRead`（缺 `lastOpenedAt` 回落 `updatedAt`）/ `updated` / `title` / `wordCount`；
  标题用码位比较，跨环境确定性；
- 分组：`none` / `tag`（一本可进多组）/ `author`（缺省「未署名」）。

字数在 `save` 时用 `countDocumentStats().characters` 算一次写进摘要；保存正文时
`carryOverSummaryFields` 会保留进度 / 最近阅读 / 封面 / 显式标签。

## `.btbook` 单书档（H3）

一本书 = `manifest.json` + `document.json` + `annotations.json`（可选）+ `assets/<id>`（可选）。

```ts
import { packBookArchive, unpackBookArchive, isBookPackCodec } from '@bibliotype/core';

const bytes = await packBookArchive(
  { id, document, createdAt: Date.now(), summary, annotations },
  codec, // 宿主注入：zip(files) / unzip(bytes)
);
const { manifest, document: restored, summary: restoredSummary } = await unpackBookArchive(bytes, codec);
```

- **core 不引压缩库**：`BookPackCodec` 由宿主提供（Node 可用 `zlib`，浏览器可用 `fflate`；
  示例应用给了一份零依赖 STORE 实现，见 `apps/demo/src/zip-codec.ts`）；
- 结构校验：`parseBookPackManifest` / `parseBookPackFiles` 抛 `BookPackError`（稳定 `code`：
  `INVALID_MANIFEST` / `INVALID_FORMAT` / `UNSUPPORTED_VERSION` / `INVALID_DOCUMENT` / `MISSING_ASSET`）；
- 语义校验（IR）不在打包层做，由导入 / 恢复链路调用 `validateDocument`。

## 整库备份与迁移（H4）

备份包复用同一套格式：`manifest.json` + 每本 `books/<id>.btbook` + `settings.json` / `styles.json`。

```ts
import { buildLibraryBackupFiles, restoreLibrary, BACKUP_CONFLICT_STRATEGIES } from '@bibliotype/core';

const files = buildLibraryBackupFiles({ createdAt: Date.now(), books, settings, styles });
const result = await restoreLibrary({
  files,
  codec,
  target: storage,
  strategy: BACKUP_CONFLICT_STRATEGIES.KEEP_BOTH,
  onProgress: (item) => console.log(item.current, item.total, item.title),
});
// result: { restored, skipped, copies, failures, settings, styles }
```

| 策略 | 同 id 冲突时 |
| --- | --- |
| `merge`（默认） | 保留 `updatedAt` 较新的一份 |
| `overwrite` | 以备份内容为准 |
| `keep-both` | 导入件另存为 `<id>-copy`、`<id>-copy-2`… |

恢复原则：逐书串行；先 `validateDocument` 再落库；单本失败只进 `failures`（`code` + 中文原因），
不中断整批；`onBookRestored` 供宿主补写注记等域外数据。

`restoreLibrary` 接受 `validateOptions`（`ValidateOptions` 透传）：**恢复路径默认把未知节点 / 标记类型
降级为 warning**，含古籍插件标记的文档不会被整本拒绝；`onBookValidated(context)` 可在每本恢复成功时
回传 warning 级问题（未知类型等）供诊断。需要严格口径时传 `unknownTypesAsWarning: false`。

## 历史版本（C7）

端口 `DocumentVersionStore`（可选能力，`isDocumentVersionStore` 探测）：
`listVersions` / `saveVersion` / `loadVersion` / `deleteVersion` / `pruneVersions`。

- 适配器实现：`IndexedDbVersionStore`（默认独立库 `bibliotype-versions`，复合主键
  `[documentId, version]`，不动文档库版本号）与 `MemoryVersionStore`；
- 快照带内容校验和（FNV-1a）：回滚先验校验和，再 `validateDocument`，双失败都拒绝并给出原因；
  `restoreSnapshot(snapshot, { validateOptions })` 与备份恢复同口径——未知插件类型默认降级为 warning，
  结构性错误仍拒绝；成功分支可回传 `warnings`。
- 保留策略由 `selectExpiredSnapshots` 选择（`maxCount` / `maxAgeDays` 取更严格者），
  存储实现只执行删除；非法策略直接抛 `RangeError`，避免误清历史。

## 存储层加密（H5）

**装饰而非改造**：`createEncryptedStorageAdapter({ inner, cipher })` 在 `save` / `load` 边界
加解密；底层适配器只见密文。

```ts
import { createStringCipher, createEncryptedStorageAdapter, deriveKeyPbkdf2 } from '@bibliotype/core';

const key = await deriveKeyPbkdf2({ password, salt });       // PBKDF2-SHA256，默认 21 万次
const cipher = createStringCipher(key);                       // AES-GCM 256
const secure = createEncryptedStorageAdapter({ inner: storage, cipher });
```

- 信封：`{ v: 1, iv, data }`（base64）；加密态文档仍是合法 IR（`schemaVersion: 'sealed-v1'`，
  信封存 `metadata.extra.__btSealedDocument`）；
- 错误码稳定：`WRONG_KEY` / `CORRUPT_PAYLOAD` / `NOT_SUPPORTED` / `INVALID_PARAMETER`，
  信息为中文并给出修复指向；**禁止静默降级为明文**；
- 已知限制：加密态 `list()` 只给占位标题，因此加密适配器不实现 `BookLibraryStore`；
  混合状态（明文记录）读取会明确报错，提示关闭加密或从备份恢复；
- 资产用 `createEncryptedAssetStore({ inner, cipher: byteCipher })`，`mediaType` 与文件名
  随密文一起保存，底层只看到 `application/x-bt-sealed`。

## SqliteAdapter（H2，Electron / 本地优先）

**驱动由宿主安装并注入**：适配器包不依赖、不打包任何 SQLite 引擎，`package.json`
里没有 `better-sqlite3` / `sql.js`。宿主把自己装好的连接包装成 `SqliteDriver` 端口即可：

```ts
import Database from 'better-sqlite3';                     // 宿主自己的依赖
import { createBetterSqliteDriver, SqliteAdapter, SqliteAssetStore, SqliteVersionStore }
  from '@bibliotype/adapter-sqlite';

const driver = createBetterSqliteDriver(new Database('library.db'));
const storage = new SqliteAdapter({ driver });
const assets = new SqliteAssetStore({ driver });
const versions = new SqliteVersionStore({ driver });
```

```ts
/* 浏览器 / 测试：sql.js 的 WASM 引擎，同样走宿主注入 */
import initSqlJs from 'sql.js';
const SQL = await initSqlJs();
const driver = createSqlJsDriver(new SQL.Database());
```

两个工厂都只做「同步引擎 → 异步端口」的薄适配：变参绑定（better-sqlite3）与
`bind / step / getAsObject`（sql.js）由包内消化，适配器只面对 `exec / prepare / transaction`。
驱动生命周期归宿主，`adapter.close()` **不会**关闭连接。

### 表结构（`PRAGMA user_version = 1`）

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `documents` | `id` PK、`title`、`updated_at`、`schema_version`、`metadata`、`summary`、`skeleton`、`chunk_ids` | 骨架 + 书架摘要；`list()` 只读这里 |
| `chunks` | `(doc_id, chunk_id)` PK、`nodes` | 片内容，`ON DELETE CASCADE` 随文档删除 |
| `assets` | `id` PK、`kind`、`media_type`、`name`、`byte_length`、`hash`、`data BLOB` | 资产与文档生命周期独立 |
| `versions` | `(doc_id, version)` PK、`meta`、`snapshot`、`created_at` | 历史快照，`clear()` 不清 |
| `settings` | `key` PK、`value` | 样式 / 偏好小载荷（`SqliteKeyValueStore`） |

首次打开自动建表建索引，重复打开幂等；库版本高于适配器支持时直接报错，避免旧代码写坏新库。

### 与 IndexedDbAdapter 的同与异

| 维度 | 行为 |
| --- | --- |
| 分片 | 同构：复用 `@bibliotype/core` 的 `buildChunkedSnapshot` / `fromSkeleton`，只写引用变化的片 |
| 可选端口 | 全实现：`BookLibraryStore` / `BookSummaryStore` / `DocumentVersionStore` / `AssetStore` |
| 缺片 | 视为记录损坏，`load()` 返回 `undefined`，不返回半截文档 |
| 事务 | 单次保存 / 清理在 `BEGIN IMMEDIATE … COMMIT` 内，失败 `ROLLBACK` 保留原数据 |
| `clear()` | 只清 `documents`（级联 `chunks`），资产、历史版本、设置保留 |
| `close()` | 空操作（与 IndexedDB 的「关闭连接、下次重开」不同，驱动归宿主） |
| 版本仓位置 | 与文档同库不同表（IndexedDB 是独立数据库） |
| 多写者 | 依赖 SQLite 自身的写锁；同一数据库不要并发开多个写连接做长事务 |

### 契约测试

`memory` / `indexeddb` / `sqlite` 共用 `@bibliotype/core/testing` 的契约套件（测试专用子入口，
依赖 vitest，不进主入口）：

```ts
import { runStorageContractTests } from '@bibliotype/core/testing';

runStorageContractTests({ name: 'SqliteAdapter', create: () => new SqliteAdapter({ driver }) });
```

SQLite 侧用 `sql.js`（devDependency）跑真实 SQL 与 1 MB BLOB 往返；生产产物仍零引擎依赖。

## 远端适配器

`@bibliotype/adapter-http` 已实现（见 [29 远端适配器](29-adapter-http.md)），能力差异
（无 `BookSummaryStore`、`query` 客户端过滤）见该文。

## 相关

- 包参考：[`@bibliotype/adapter-indexeddb`](../packages/adapter-indexeddb/README.md)、[`@bibliotype/adapter-sqlite`](../packages/adapter-sqlite/README.md)
- IR 序列化约束：[01 数据模型](01-document-model.md)
- 协同同步：[09 协同编辑](09-collab.md)
