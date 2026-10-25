# 33 Electron 宿主接入

> 涉及位置：`apps/demo/src/host/`、`apps/demo/electron/main/module/bibliotype-store.ts`、
> `@bibliotype/adapter-sqlite`
> 相关篇目：[10 存储适配器](10-storage-adapters.md) · [15 SSR 与 Node 同构](15-ssr-and-node.md) ·
> [06 Vue 集成](06-vue-integration.md)

同一份 bibliotype 应用代码，既要跑 Web（IndexedDB），又要跑 Electron（SQLite），
且 demo 需要**频繁复制**进宿主项目运行调试。本篇说明 demo 侧的宿主适配层、
复制同步模型与 IPC 契约。

## 一、设计原则：单一上源 + host 适配层

- **单一上源**：demo 源码是唯一上源；宿主项目里的副本只做「复制 + 接线」，行为改动回传 demo；
- **通用代码零分叉**：所有环境差异（存储引擎、文件下载、localStorage 键名）收敛到
  `src/host/`；业务代码只写 `import { host } from '../host/index.js'`；
- **入口切换**：Web 侧 `host/index.ts` 只有一行 `export * from './web.js'`；
  复制到 Electron 时用 `host/electron.ts` 覆盖 `host/index.ts`——通用代码一行不改；
- **web 零回归**：web 实现是改造前逻辑的原样搬迁（同一数据库名 / store 名 / 无前缀键），
  Web demo 行为与接入前一致。

```text
通用代码（组件 / composables / 页面）
        │  import { host } from '../host/index.js'
        ▼
   host/index.ts  ──web──→  host/web.ts      (IndexedDB + Blob 下载 + 原键名)
                  ──electron（复制期替换）──→  host/index.ts ← host/electron.ts
```

## 二、HostEnvironment 端口

定义在 `src/host/types.ts`，是通用代码与运行环境之间**唯一的接缝**。

| 成员 | 说明 |
| --- | --- |
| `hostName` | 链路名（`indexeddb` / `sqlite`），设置面板展示用 |
| `createLibraryStores()` | 返回 `{ adapter: StorageAdapter, versionStore: DocumentVersionStore }` |
| `createDraftStore()` | 编辑草稿存储（单条记录，键固定 `current`） |
| `createStyleSettingsStore()` | 样式快照 / 预设存储（`StyleSettingsStore`） |
| `downloadBytes(bytes, filename)` | 二进制导出（EPUB 等） |
| `downloadText(text, filename, mime?)` | 文本导出（DublinCore / CNMARC 等，`mime` 缺省 `text/plain`） |
| `storageKey(key)` | 包装 localStorage 键（Web 原样返回，Electron 加 `bt:` 前缀） |

调用点分布在 `use-demo-library`、`use-edit-session`、`use-layout-tokens`、`use-export`、
`use-settings-snapshot`、`use-toc-prefs`、`style-settings-persist`、`AnnotationPanel.vue`、
`BookInfoDialog.vue`——这些文件两侧完全一致，不含任何 `electron` / `indexedDB` 判断分支。

## 三、目录与复制映射

| demo 源 | 宿主目标 | 规则 |
| --- | --- | --- |
| `apps/demo/src/**`（除下列排除项） | `src/views/bibliotypeStudio/**` | 双向同步（demo 为上源） |
| `apps/demo/src/host/electron.ts` | `src/views/bibliotypeStudio/host/index.ts` | **复制期替换入口** |
| `apps/demo/electron/main/module/bibliotype-store.ts` | `electron/main/module/bibliotype-store.ts` | 双向同步 |
| —（宿主维护） | wrapper 页面、路由 / 菜单注册、主进程 `initBibliotypeStore()` 调用、依赖声明 | 接线文件，禁止复制 |

**排除项**（不复制）：`host/index.ts`（web 入口，electron 侧被替换）、`host/web.ts`（无人引用）、
`main.ts` / `index.html` / `vite.config.ts` / `vitest.config.ts`（宿主自有入口）、`src/__tests__/`
（宿主不跑 demo 测试）。

**回传约定**：宿主侧允许修改的文件只有「通用代码副本 + `host/index.ts` + `bibliotype-store.ts`」，
改完必须回传 demo 对应路径，并在 demo 侧跑 `vue-tsc` 与 `vitest` 确认 web 不回归；
禁止在映射表之外新增文件（会形成第二上源）。

## 四、Web 实现（`host/web.ts`）

- 书库：`IndexedDbAdapter({ databaseName: 'bibliotype-demo-library', storeName: 'books' })`
  + `IndexedDbVersionStore`；
- 草稿：`IndexedDbAdapter({ databaseName: 'bibliotype-demo', storeName: 'drafts' })`；
- 样式设置：`@bibliotype/vue` 的 IndexedDB 实现（不可用时自动降级）；
- 下载：`Blob` + `<a download>` 触发浏览器保存；
- `storageKey`：恒等函数。

## 五、Electron 实现（`host/electron.ts`）

自包含边界（硬约束）：只使用宿主 preload 暴露的 `window.ipcRenderer`、已发布的
`@bibliotype/*` 与 Web 标准 API（`btoa` 等）；**不得** import 宿主模块或 `@/` alias，
保证在 demo 仓库内 `vue-tsc` 也能解析。

| 能力 | 实现 |
| --- | --- |
| 驱动 | `IpcSqliteDriver implements SqliteDriver`，把 `exec` / `prepare` / `transaction` 转发到主进程 |
| 事务 | 渲染端单槽 `inTransaction` 标记，嵌套直接抛错；失败自动 rollback，保留原始错误 |
| 连接 | 模块级 `sharedDriver`，书库 / 草稿 / 历史版本 / 样式共用同一连接 |
| 书库 | `SqliteAdapter` + `SqliteVersionStore`（同一库文件、同一驱动） |
| 草稿 | `SqliteAdapter`（`documents` 表，靠文档 id 区分） |
| 样式 | `SQLiteStyleStore`（`settings` 表 KV，见第七节） |
| 下载 | `sendSync('export-buffer-to-cache', { base64, filename })` / `sendSync('export-text-to-cache', { text, filename })`；失败仅 `console.warn`，不中断界面 |
| localStorage | `storageKey(key) → 'bt:' + key`，避免与宿主自身键冲突 |

Uint8Array 先在渲染端分块转 base64（`0x8000` 一段，避免 `String.fromCharCode(...)` 爆栈），
主进程解码落盘。

## 六、主进程 SQLite 执行器（`bibliotype-store.ts`）

**无 schema、无业务逻辑**：建表与迁移由渲染端 `@bibliotype/adapter-sqlite` 的 `ensureSchema`
经 `bibliotype:sql-exec` 执行，本模块只做语句转发，因此升级适配器不会与主进程版本脱节。

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `bibliotype:sql-exec` | `{ sql }` | `void` |
| `bibliotype:sql-run` | `{ sql, params? }` | `{ changes }` |
| `bibliotype:sql-get` | `{ sql, params? }` | `row \| null` |
| `bibliotype:sql-all` | `{ sql, params? }` | `row[]` |
| `bibliotype:sql-tx-begin` / `-commit` / `-rollback` | — | `void` |

- 库文件：缺省 `app.getPath('userData')/bibliotype.db`；宿主可通过
  `initBibliotypeStore({ dir, fileName })` 改到自己的数据目录（例如与主库 `db.sqlite` 同级、
  文件名加宿主前缀 `jianli-app-bibliotype.db`，便于统一备份与定位）。打开后 `WAL` +
  `busy_timeout = 5000`，并 `serialize()` 保证同连接语句按提交顺序执行；
- 参数 / 返回值走结构化克隆：BLOB 在渲染端是 `Uint8Array`，主进程内部转 `Buffer`，
  查询返回的 `Buffer` 再转回 `Uint8Array`；
- 事务单槽：`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`，嵌套报错；悬挂事务 **30s** 超时自动回滚
  （渲染端崩溃不会把库锁在写事务里）；
- 接线：宿主主进程入口调用一次 `initBibliotypeStore()`（幂等；改动后需重启主进程）；
  传 `{ dir, fileName }` 可指定库位置（未传即 `userData/bibliotype.db`）。

## 七、样式设置落 SQLite

`@bibliotype/vue` 默认把样式快照 / 预设写 localStorage；桌面端改用 `SQLiteStyleStore`：

- 复用 `settings` 表小载荷 KV，**不新增表，不升 `PRAGMA user_version`**；
- 键：`bt-style:snapshot:<scope>` 与 `bt-style:presets`（预设整体一条 JSON，按 `createdAt` 降序）；
- `load()` 对脏数据走 `normalizeStyleSnapshot()`，不抛错；
- `clear()` 只删 `bt-style:*`，不影响宿主自身写入 `settings` 的数据；`close()` 为空操作。

偏好类小数据（阅读位置、上次页码、目录偏好、标注、加密元数据）仍留在 localStorage，
只经 `storageKey()` 加前缀——这类数据读写频繁、体量极小，放渲染端更直接。

## 八、宿主侧接线清单

1. 安装依赖：`@bibliotype/*`（core / vue / exporter-* / adapter-sqlite 等）与 `sqlite3`
   （渲染端不 import，仅主进程使用）；
2. 按第三节映射复制源码，`host/electron.ts` 覆盖为 `host/index.ts`；
3. 主进程入口调用 `initBibliotypeStore()` 并重启；
4. 注册 wrapper 路由页与菜单入口（宿主维护，不从 demo 同步）；
5. 首启动验证：库文件生成五表（`documents` / `chunks` / `assets` /
   `versions` / `settings`），保存文档后 `chunks` 有行（缺省 `userData/bibliotype.db`，
   传入 `{ dir, fileName }` 时以指定路径为准）。

## 九、导出链路

- EPUB / 文本类导出：`host.downloadBytes` / `host.downloadText` →
  `export-buffer-to-cache` / `export-text-to-cache`，直接写入宿主缓存目录并提示文件定位；
- PDF：沿用 demo 既有双桥（`window.electronPdf` 或 `window.ipcRenderer.handlePromise`
  的 `bibliotype:export-*` 会话），未接入宿主通道时自动回退浏览器 `window.print()`；
- 两条链路都不依赖 File System Access API。

## 十、排查

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 启动报「桌面宿主 IPC 不可用」 | preload 未暴露 `ipcRenderer`，或渲染页不在宿主窗口内 | 检查 preload 的 `contextBridge` 暴露与窗口 `webPreferences` |
| 所有读写都报「不支持嵌套事务」 | 某次 `save` 外层已开事务，内层又调 `transaction` | 把多步写入合并进同一回调；驱动端口本就不支持嵌套 |
| 保存后重启数据丢失 | 主进程未调用 `initBibliotypeStore()` 或数据库被写到了临时目录 | 确认调用点与实际库路径（`dir` / `fileName` 覆盖值或 `userData`），检查库文件是否生成 |
| 下载无文件 | `export-*-to-cache` 通道未注册或参数结构不符 | 对照第六节通道表；同步查看主进程日志中的 `success: false` |
| 样式设置不落库 | 未用 `createStyleSettingsStore()` 覆盖 vue 默认 localStorage 实现 | 在调用 `useStyleSettings` 处显式传 `store` |
| localStorage 键冲突 | 直写了未包装的键 | 所有读写必须经 `host.storageKey()` |

## 十一、已知边界

- 主进程执行器单连接、单槽事务：多窗口共享同一连接，长事务会阻塞其它写入；
- 事务超时 30s 为硬编码；超大文档的整本 `save` 若可能超时，应拆分写入或调大阈值
  （需同步修改两侧文件）；
- 渲染端不关闭连接（`close()` 空操作）：连接生命周期归主进程；
- demo `electron/` 目录在 `tsconfig` include 之外，web 构建与测试不会编译它；
  修改后需在宿主侧重启主进程验证。
