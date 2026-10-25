# bibliotype Demo × 渐离App（Electron）兼容改造清单

> 目标：把 `c:\cod\note_npm` 仓库的 `apps/demo`（Vue 3 源码）**以代码融合**（非打包产物）方式并入 `c:\cod\jianli\jianli-app`（Electron + Vue3 + sqlite3），主窗口新增普通路由页承载；web 端 demo 继续在 note_npm 仓库正常使用与开发。
> 本文是**决策完整**的改造清单：每项含精确文件路径、接口签名、验收标准，可直接开工。
> 阅读前置：[开发规范.md](开发规范.md)（note_npm 工程铁律）· jianli-app `.workbuddy/skills/jianli-app/SKILL.md`（宿主红线）。

---

## §0 背景与目标

### 0.1 现状

- jianli-app 已通过「独立窗口 + 构建产物拷贝」接入 bibliotype：`electron/main/module/bibliotype.ts`（`bibliotype:export-*` 矢量 PDF 会话协议）+ `scripts/copy-bibliotype-demo.cjs`（产物拷贝）。
- 本次改为**源码融合**：demo 源码并入 jianli-app 渲染工程，主窗口普通路由页呈现；**现有独立工作台窗口与产物拷贝机制保留不动**（两形态并存）。
- demo 需要**频繁复制**到 electron 项目运行与修改，因此所有依赖 electron 的内容必须收敛在 demo 仓库的专属目录内维护——note_npm demo 是**唯一上源**，通用代码两侧 100% 一致。

### 0.2 核心架构：单一上源 + host 适配层

```text
┌─ note_npm 仓库（唯一上源）─────────────────────────────────────┐
│  apps/demo/src/**            ← 通用代码（web / electron 完全一致） │
│  apps/demo/src/host/          ← 宿主适配层                        │
│    ├─ types.ts                ← HostEnvironment 端口（通用）        │
│    ├─ web.ts                  ← web 实现（现状逻辑，缺省）           │
│    ├─ electron.ts             ← electron 实现（IPC sqlite + 导出）   │
│    └─ index.ts                ← web 入口（export * from './web.js'）│
│  apps/demo/electron/main/module/bibliotype-store.ts ← 主进程模块     │
└───────────────┬─────────────────────────────────────┘
                │ 复制（映射见 §1.4；electron.ts 替换为 host/index.ts）
┌───────────────▼─ jianli-app 仓库（消费方 + 接线文件）──────────────┐
│  src/views/bibliotypeStudio/**      ← 通用代码副本（与上源一致）      │
│  src/views/bibliotypeStudio.vue     ← wrapper（jianli 维护，不复制） │
│  electron/main/module/bibliotype-store.ts ← 主进程模块副本          │
│  路由 / 菜单 / main index init / package.json ← 接线（jianli 维护）  │
└──────────────────────────────────────────────────────────────────┘
```

环境差异全部经 host 层隔离：通用代码只 `import ... from '../host/index.js'`，web 构建解析到 web 实现，复制到 electron 后入口被替换为 electron 实现——**通用代码零分叉**。

### 0.3 决策记录（已拍板）

| # | 决策 | 内容 |
| --- | --- | --- |
| 1 | 融合形态 | 主窗口新增普通路由页（菜单四件套注册）；现有独立工作台窗口不变不删 |
| 2 | 依赖引入 | jianli-app `npm install` 已发包；note_npm 改造后增量发版 |
| 3 | 样式设置存储 | `@bibliotype/adapter-sqlite` 新增 `SQLiteStyleStore`（走 changeset 发版） |
| 4 | 偏好小数据 | 保留 localStorage（electron 侧键加 `bt:` 前缀防碰撞） |
| 5 | 上源模型 | electron 专属内容收敛在 demo 仓库专属目录；通用代码复制同步，demo 为唯一上源 |

---

## §1 复制同步模型（核心）

### 1.1 demo 仓库新增目录

```text
apps/demo/
 ├─ src/host/
 │   ├─ types.ts       HostEnvironment 端口定义（web/electron 共用契约）
 │   ├─ web.ts         web 实现：IndexedDB 工厂 + Blob 下载 + 无前缀键
 │   ├─ electron.ts    electron 实现：IPC sqlite 驱动 + sendSync 导出 + bt: 前缀键
 │   └─ index.ts       入口：export * from './web.js'   ← 复制时被替换
 ├─ electron/
 │   └─ main/module/bibliotype-store.ts   主进程 IPC SQLite 执行器（见 N3）
 └─ scripts/
     └─ sync-to-jianli.mjs               可选同步脚本（见 1.5）
```

> `apps/demo/electron/` 置于 demo `tsconfig.json` include 之外（不参与 web typecheck / 构建 / vitest），文件头注释注明复制目标与接线方式。

### 1.2 HostEnvironment 端口（`src/host/types.ts`）

```ts
import type { StorageAdapter, StyleSettingsStore, DocumentVersionStore } from '@bibliotype/core';

/** 宿主环境适配端口：通用代码与运行环境（web / electron）之间唯一的接缝 */
export interface HostEnvironment {
  /** 存储链路名（设置面板「存储适配器」显示用，如 'indexeddb' / 'sqlite'） */
  readonly hostName: string;
  /** 书库存储：文档适配器 + 历史版本仓（供 useDemoLibrary 组装） */
  createLibraryStores(): {
    adapter: StorageAdapter;
    versionStore: DocumentVersionStore;
  };
  /** 编辑草稿存储适配器（useEditSession 用） */
  createDraftStore(): StorageAdapter;
  /** 样式设置存储（useStyleSettings 的 store 注入） */
  createStyleSettingsStore(): StyleSettingsStore;
  /** 二进制下载（EPUB / 整库备份 / PDF 浏览器兜底） */
  downloadBytes(bytes: Uint8Array, filename: string): void;
  /** 文本下载（编目 DC JSON / CNMARC 等） */
  downloadText(text: string, filename: string): void;
  /** localStorage 键包装（electron 侧加前缀防碰撞；web 侧原样返回） */
  storageKey(key: string): string;
}
```

> `DocumentVersionStore` 若 core 未导出该端口名，以实际导出为准（`IndexedDbVersionStore` / `SqliteVersionStore` 实现的接口），落地时先查 `packages/core/src/storage/types.ts`。

### 1.3 双实现要点对照

| 能力 | web.ts（缺省） | electron.ts |
| --- | --- | --- |
| hostName | `'indexeddb'` | `'sqlite'` |
| createLibraryStores | `new IndexedDbAdapter({databaseName:'bibliotype-demo-library', storeName:'books'})` + `new IndexedDbVersionStore()`（现状逻辑搬迁） | `new SqliteAdapter({driver})` + `new SqliteVersionStore({driver})`，driver 来自 `createIpcSqliteDriver()` |
| createDraftStore | `new IndexedDbAdapter({databaseName:'bibliotype-demo', storeName:'drafts'})`（现状逻辑搬迁） | 同一 driver 的 `new SqliteAdapter({driver})` |
| createStyleSettingsStore | `createStyleStore()`（adapter-indexeddb 自动降级，现状逻辑） | `new SQLiteStyleStore({driver})`（N2 交付） |
| downloadBytes / downloadText | `Blob` + `URL.createObjectURL` + `<a download>`（现状 `downloadBytes` 逻辑搬迁） | `window.ipcRenderer.sendSync('export-buffer-to-cache', {base64, filename})` / `('export-text-to-cache', {text, filename})`；返回 `{success, path}` → toast 展示路径，点击经 `open-file-in-assets-manager` 通道定位文件 |
| storageKey | `(key) => key` | `(key) => \`bt:${key}\`` |

**electron.ts 自包含边界（硬约束）**：只准使用 `window.ipcRenderer` 全局（复用 `use-export.ts` 既有 `declare global` 声明）、`@bibliotype/*` 已发包、web 标准 API；**禁止 import jianli-app 模块或 `@/` alias**——保证 note_npm 侧 `vue-tsc` 可解析、复制即用。base64 编码在渲染端完成（`btoa` + 二进制转字符串，或 `FileReader.readAsDataURL` 剥前缀）。

### 1.4 复制映射表

| demo 仓库源 | jianli-app 目标 | 规则 |
| --- | --- | --- |
| `apps/demo/src/**`（除下三行排除项） | `src/views/bibliotypeStudio/**` | 双向同步（以 demo 为上源，见 1.5） |
| `apps/demo/src/host/electron.ts` | `src/views/bibliotypeStudio/host/index.ts` | **复制期替换入口**（覆盖 web 入口） |
| `apps/demo/electron/main/module/bibliotype-store.ts` | `electron/main/module/bibliotype-store.ts` | 双向同步 |
| —（jianli 维护，不复制） | `src/views/bibliotypeStudio.vue`（wrapper）、路由与菜单注册、main index 的 `initBibliotypeStore()` 行、`package.json` 依赖 | 接线文件，禁止从 demo 同步 |

**排除项**（不复制）：`host/index.ts`（web 入口，electron 侧被替换）、`host/web.ts`（web 实现，electron 侧无人引用）、`main.ts` / `index.html` / `vite.config.ts` / `vitest.config.ts`（jianli 自有入口）、`src/__tests__/`（宿主不跑 demo 测试）。

### 1.5 回传约定（单一上源闭环）

- electron 侧允许修改的文件 = 「通用代码副本」+「electron 专属文件副本」（`host/index.ts` 与 `bibliotype-store.ts`）；**改完必须回传** demo 对应路径，再由 demo 侧跑全量测试确认不破坏 web。
- 通用代码里的行为改动照常走 note_npm 流程：测试 + changeset（涉及发包行为时）+ 文档（开发规范第六/七/九节）。
- 禁止在 jianli 侧把改动散落到映射表之外的新文件（会产生第二上源，破坏一致性）。

### 1.6 同步脚本（可选，推荐）

`apps/demo/scripts/sync-to-jianli.mjs`：node 脚本执行 §1.4 映射 + 入口替换，支持 `--dry-run`；排除项内置；复制后打印「需手工确认的接线项」（依赖安装 / init 行 / 菜单注册）。减少频繁手工复制的失误。

---

## §2 note_npm 侧改造（demo 仓库）

### N1 host 适配层与通用代码依赖点收敛

#### N1.1 新建 host 四文件

§1.1 目录中的 `types.ts` / `web.ts` / `electron.ts` / `index.ts`，契约见 §1.2/§1.3。文件头中文 JSDoc 说明模块职责与复制语义（开发规范第二节）。

#### N1.2 通用代码改造点明细

| 文件:位置 | 现状 | 改造 |
| --- | --- | --- |
| [use-demo-library.ts](apps/demo/src/composables/use-demo-library.ts#L158-L159) | `new IndexedDbAdapter(...)` + `new IndexedDbVersionStore()` 硬编码；`downloadBytes`（L104-112）内置 Blob | stores 改为 `host.createLibraryStores()`；`downloadBytes` 删除、导出改为转发 `host.downloadBytes`（对外签名不变，调用方零改动）；`CRYPTO_META_KEY` / `SEALED_DOC_KEY` 读写经 `host.storageKey()` |
| [use-edit-session.ts](apps/demo/src/composables/use-edit-session.ts#L64) | `new IndexedDbAdapter({databaseName:'bibliotype-demo', storeName:'drafts'})` 硬编码 | 改为 `host.createDraftStore()` |
| [use-layout-tokens.ts](apps/demo/src/composables/use-layout-tokens.ts#L66) | `useStyleSettings({ bookId: currentBookId, draft: true })` 未传 store（内部自动 IndexedDB） | 增补 `store: host.createStyleSettingsStore()` |
| [use-style-settings.ts](apps/demo/src/composables/use-style-settings.ts#L72) | `store = options.store ?? createStyleStore()` | 保留缺省链路不动（注入优先生效；web host 传入的就是原逻辑） |
| [use-export.ts](apps/demo/src/composables/use-export.ts#L269-L276) | `download()` 内置 Blob + `a[download]` | 改为经 host（EPUB 下载、浏览器 PDF 兜底共用）；PDF 双桥（`window.electronPdf` L329、`getDesktopIpc()` L340）**零改动** |
| [use-settings-snapshot.ts](apps/demo/src/composables/use-settings-snapshot.ts#L32-L36) | 导出常量 `POSITION_KEY` / `LAST_PAGE_KEY` / `SETTINGS_KEY`（`bibliotype-demo:*`） | 三键读写经 `host.storageKey()` 包装（常量名保留，值经包装） |
| [use-toc-prefs.ts](apps/demo/src/composables/use-toc-prefs.ts#L14) | `TOC_PREFS_KEY = 'bibliotype-demo:toc-prefs'` | 同上 |
| [ui-skin.ts](apps/demo/src/ui-skin.ts) | 皮肤键直接写 localStorage | 键经 `host.storageKey()` |
| [AnnotationPanel.vue](apps/demo/src/components/AnnotationPanel.vue#L31) | `` `bt-demo:annotations:${props.bookId}` `` | 键经 `host.storageKey()` |
| [BookInfoDialog.vue](apps/demo/src/components/BookInfoDialog.vue#L41-L48) | 组件本地 `downloadText`（Blob + `a[download]`，编目 DC/CNMARC 导出用） | 删除本地实现，改转发 `host.downloadText` |
| [style-settings-persist.ts](apps/demo/src/composables/style-settings-persist.ts#L17) | `bt-demo:settings` 旧版迁移键 | 经 `host.storageKey()`（迁移语义两侧一致） |

> localStorage 键全表（electron 侧经 `storageKey()` 后实际键 = `bt:` + 原键）：

| 原键 | 用途 |
| --- | --- |
| `bibliotype-demo:settings` / `:last-page` / `:position` | 界面偏好快照 / 阅读页码 / 阅读位置 |
| `bibliotype-demo:toc-prefs` | 目录面板偏好 |
| `bibliotype-demo-crypto-meta` / `bibliotype-demo-sealed-draft` | 加密元信息 / 封存标记 |
| `bt-demo:settings` | 旧版样式设置迁移来源 |
| `bt-demo:annotations:<bookId>` | demo 标注存储 |
| ui-skin 皮肤键（`ui-skin.ts` 内 `UI_SKINS` 表） | 界面皮肤 |

#### N1.3 缺省行为不变（零回归保证）

- `host/index.ts` = `export * from './web.js'`，web.ts 内含**现状逻辑搬迁**（IndexedDB 工厂、Blob 下载、无前缀键）——web demo 行为与改造前逐字节等价。
- 既有测试策略：`use-settings-persist` / `style-settings-*` / `toc-prefs` 等测试以注入 store / storage 替身为主，键包装为纯函数不破坏断言；个别直连 localStorage 的用例补 `host.storageKey` 期望值。
- `pnpm --filter @bibliotype/demo test` 全绿后 N1 完成。

### N2 adapter-sqlite 新增 SQLiteStyleStore

- **位置**：`packages/adapter-sqlite/src/style-store.ts`，导出入 `index.ts`（`SQLiteStyleStore` + `SQLiteStyleStoreOptions`）。
- **实现方案（定案）**：组合 `SqliteKeyValueStore`，**复用 `settings` 表、不升 schema 版本**。
  理由：① `StyleSettingsSnapshot` / `StylePreset` 均为 JSON 安全小载荷，schema.ts 注释对 `settings` 表的定位即「宿主小载荷（样式 / 偏好）」；② 键空间沿用 `LocalStorageStyleStore` 同款（`bt-style:snapshot:<scope>` / `bt-style:presets`），迁移心智一致；③ 免 `SQLITE_SCHEMA_VERSION` 升版（当前为 1，见 `schema.ts`），避免旧库兼容分支。
- **端口实现**（core `StyleSettingsStore`）：`name: 'sqlite'`、`load(scope)`（读 KV → `normalizeStyleSnapshot`）、`save(scope, snapshot)`、`delete(scope)`、`listPresets()` / `savePreset(preset)` / `deletePreset(id)`（presets 数组整体读写 + createdAt 降序）、`clear()`、`close()`（无资源）。
- **测试**：`src/__tests__/style-store.test.ts` 对照 `IndexedDbStyleStore` 语义（快照读写 / 预设排序 / 删除返回是否存在 / clear），驱动用现有测试的内存驱动形态（对照 `sqlite-adapter.test.ts` 的注入方式）。
- **规范动作**：中文 JSDoc 全覆盖；`packages/adapter-sqlite/README.md` 能力表补一行；验收 `pnpm --filter @bibliotype/adapter-sqlite test` + `pnpm typecheck`。

### N3 主进程模块 bibliotype-store.ts

- **位置**：`apps/demo/electron/main/module/bibliotype-store.ts`（复制目标：jianli `electron/main/module/bibliotype-store.ts`）。
- **职责边界**：纯 SQL 执行器，**无 schema / 无业务逻辑**——`ensureSchema`（documents / chunks / assets / versions / settings 五表 + `PRAGMA user_version`）由渲染端 adapter-sqlite 经通道执行（`PRAGMA foreign_keys = ON` 每连接设置同样经通道）。
- **连接**：`sqlite3`（jianli 已装 `^6.0.1`）打开 `app.getPath('userData')/bibliotype.db`；启动时 `PRAGMA journal_mode = WAL`；`db.serialize()` 串行化全部语句。
- **通道**（`ipcMain.handle`，参数/返回经结构化克隆；渲染端经 `window.ipcRenderer.handlePromise` 调用）：

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `bibliotype:sql-exec` | `{sql}` | `{ok: true}` / `{error}` |
| `bibliotype:sql-run` | `{sql, params}` | `{changes}` / `{error}` |
| `bibliotype:sql-get` | `{sql, params}` | `{row}`（无行时 `row: null`） |
| `bibliotype:sql-all` | `{sql, params}` | `{rows: []}` |
| `bibliotype:sql-tx-begin` | `{}` | `{ok}`（已在事务中 → `{error: '不支持嵌套事务'}`） |
| `bibliotype:sql-tx-commit` / `bibliotype:sql-tx-rollback` | `{}` | `{ok}` |

- **语句执行**：sqlite3 `db.run/get/all(sql, ...params, cb)` 包 Promise；params 数组展平（命名参数对象也原样透传）；BLOB 参数 IPC 传来 `Uint8Array` → `Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)` 绑定；返回行中 BLOB（sqlite3 给 Buffer）结构化克隆原样回传（Buffer 是 Uint8Array 子类，渲染端零转换）。statement 每条 prepare（demo 规模可接受；预留 `Map<sql, Statement>` 缓存为后续优化点，注释标明）。
- **事务**：主进程单槽（`txActive` 标志 + begin 时间戳）：begin 已在事务 → 报错（对齐 adapter-sqlite `driver.ts` 嵌套拒绝语义）；commit/rollback 复位。**悬挂回收（推荐增强）**：每条非事务语句前检查 begin 时间戳超阈值（如 30s）自动 rollback，防渲染端崩溃后连接卡死。
- **注册**：导出 `initBibliotypeStore()`（jianli main index 调用，见 J3）；文件头中文注释说明复制来源、接线方式、通道契约。

### N4 changeset 与增量发版

- `@bibliotype/adapter-sqlite`：公开导出面新增（`SQLiteStyleStore`）——**必须附 changeset**（`pnpm changeset`，patch/minor 按 README 约定）。
- demo 为 private 包，不发布、不登记 changeset。
- 流程按 README「日常发布（增量）」：`pnpm changeset` → `pnpm version:rc` → `pnpm release:check`（可选）→ 提交打 tag（维护者执行）→ `pnpm release:rc`；转正式同 README §3。
- 不改 `.changeset/config.json`、发布脚本与 CI（开发规范第七节）。

### N5 文档回写（开发规范第九节铁律）

- `packages/adapter-sqlite/README.md`：能力表补 `SQLiteStyleStore`。
- `docs/` 新篇目「Electron 宿主接入」（编号顺延，如 `30-electron-host.md`）：host 适配层架构、复制同步模型（§1 内容沉淀）、IPC 驱动契约（§N3 通道表）、SQLiteStyleStore 用法。
- **三处索引同步**：`docs/README.md` 篇目表与阅读路线、根 `README.md` 文档表。
- `apps/demo/README.md`：补 host 目录与复制约定说明。
- 新踩坑（如 sqlite3 事务悬挂）按「现象 → 根因 → 处理」入 `docs/14-faq.md`。

### N6 note_npm 侧验证

```bash
pnpm --filter @bibliotype/adapter-sqlite test     # N2 单包
pnpm --filter @bibliotype/demo test               # N1 零回归
pnpm --filter @bibliotype/demo exec vue-tsc --noEmit  # host/electron.ts 类型可解析（无 jianli alias）
pnpm build && pnpm typecheck && pnpm test         # 全仓交付底线（turbo 全量回归）
```

---

## §3 jianli-app 侧改造（接线）

### J1 依赖安装

- `npm i`（按 npm 实际 dist-tag，rc 通道加 `@rc`）：`@bibliotype/core` `@bibliotype/editor` `@bibliotype/classical` `@bibliotype/layout` `@bibliotype/reader` `@bibliotype/vue` `@bibliotype/annotation` `@bibliotype/import` `@bibliotype/import-docx` `@bibliotype/import-epub` `@bibliotype/exporter-epub` `@bibliotype/exporter-pdf` `@bibliotype/adapter-sqlite`。
- `@bibliotype/vue` 的 `./style.css` 子导出按包 README 方式引入（wrapper 或全局）。
- vue 版本兼容：包 peer `^3.4.0`，jianli 3.4.21 满足；**检查项**：demo 源码是否用到 3.5 特性（如 `useId`、`onWatcherCleanup`、Reactive Props Destructure 默认开启行为）——命中则回退写法（通用代码侧改，回传 demo）。

### J2 复制与路由页

- 按 §1.4 映射表执行复制（或跑 `sync-to-jianli.mjs`）。
- jianli 维护 wrapper：`src/views/bibliotypeStudio.vue`——挂载 demo `App.vue` + 提供满高容器；demo 全局样式引入点在此收口（见 J4）。
- **菜单四件套**（SKILL.md 红线 8）：
  1. `src/router/index.ts`：`RouteNames` 加 key + `layoutRouters` 注册（lazy import wrapper）；
  2. `src/constants/menu.ts`：`menuGroupDefs` 对应分组（内容 / 数据类）`names` 加名——**唯一数据源**，严禁去侧栏与配置页分别加名单；
  3. 可选：`src/utils` 的 `iconMap` 加图标（书 / 阅读语义；先命令行验证图标存在，遵守 jianli 导入图标规则）。

### J3 主进程接线

- jianli `electron/main/index.ts`：调用 `initBibliotypeStore()`（一行）。
- 通道命名空间核对：`bibliotype:sql-*` 与既有 `bibliotype:export-*`（`bibliotype.ts`）无冲突；存储通道独立于 newSql（**不走 `new-sql:*`**，规避 db-pitfalls 三坑）；`open-file-in-assets-manager` / `export-buffer-to-cache` 为通用通道，直接复用。
- **改主进程须重启 Electron**（jianli 红线 2）。

### J4 样式共存

- 冲突面：demo `styles.css` + `styles/*.css`（app-shell / skins / settings-shell / scrollbars 等含**全局规则与 CSS 变量**）× jianli 全局（element-plus 主题 / 26 skins / 自有变量）。
- 排查表（落地时逐文件过）：demo 全局选择器清单 → 是否命中 jianli DOM；CSS 变量名冲突（`:root` 级）；`body`/滚动条/字体基线规则。
- 隔离方案（按成本递增，先做 a）：
  a. **路由级样式装卸**：demo 样式仅 wrapper 挂载时注入、卸载时移除（`import './styles.css'` 改为 wrapper 动态注入或 `<style>` 作用域化）；
  b. **容器命名空间**：demo 样式规则统一加 `.bt-studio` 前缀（改通用样式文件 → 回传 demo，web 侧无影响）；
  c. 变量冲突改名（同 b，回传）。
- jianli 主题（skins）不强制适配 demo 内观感——demo 自带皮肤体系，两套并存即可。

### J5 实机验证清单（`npm run dev`）

| # | 项 | 通过标准 |
| --- | --- | --- |
| 1 | 路由与菜单 | 路由页可达；侧栏菜单与路由配置页开关三处同步（menuGroupDefs 单源） |
| 2 | 书库存储 | 建书 / 保存 / 读取 / 列表正常；sqlite 工具查 `userData/bibliotype.db` 的 `documents` / `chunks` 表有数据；设置面板存储链路显示 `sqlite` |
| 3 | 草稿自动保存 | 编辑 → 等 2.5s 节流 + 空闲调度 → 落盘；刷新页面草稿恢复 |
| 4 | 历史版本 | 手动快照 / 版本列表 / 对比 / 清理正常（`versions` 表） |
| 5 | 样式设置 | 改样式 → 800ms 落盘 → 重进页面保持（`settings` 表 `bt-style:snapshot:*` 键） |
| 6 | EPUB 导出 | 导出落 fileCachePath，toast 路径可点定位（`open-file-in-assets-manager`）；epubcheck 校验提示照常 |
| 7 | PDF 导出 | 点「导出 PDF」打开分段弹窗（`bibliotype:export-*` 会话）→ 逐段落盘 `书名_00x.pdf`；中止可用 |
| 8 | 整库备份 | 导出 zip 落缓存目录；导入（file input）恢复正常 |
| 9 | 编目导出 | DC JSON / CNMARC 文本落缓存目录 |
| 10 | localStorage | DevTools 查看 `bt:` 前缀键就位；跨会话保持 |
| 11 | 加密 | 开启 / 解锁 / 封存草稿（PBKDF2 + AES-GCM，`crypto.subtle` 在 Electron secure context 可用）；失败则按 §5 排查 |
| 12 | 并存 | 现有独立工作台窗口（菜单入口）与新路由页同时可用；同时导出 PDF 的互踩限制已知（§5） |
| 13 | 标注 / TTS 外无涉 | demo 标注面板（localStorage 版）读写正常 |

### J6 jianli 模块文档

- [x] 更新 `.workbuddy/skills/jianli-app/references/modules/bibliotype.md`：新增「融合路由页形态（2026-10-25 接入批次）」章节——复制同步约定（映射表）、`bibliotype:sql-*` 通道契约（exec 无 params / 事务单槽无 txId / 悬挂 30s 回滚）、存储布局（bibliotype.db 五表 + `bt:` 前缀）、样式隔离方案、与独立窗口并存关系、实机验证清单。
- [x] 更新 `.workbuddy/skills/jianli-app/references/ipc-channels.md`：在「书籍排版」条目后追加 `bibliotype:sql-*` 七个通道说明。

---

## §4 实施顺序

```text
阶段一（note_npm）：
  N2 SQLiteStyleStore ─→ N1 host 适配层 + 依赖点收敛 ─→ N3 主进程模块 ─→ N6 验证 ─→ N4 发版 ─→ N5 文档
阶段二（jianli-app）：
  J1 装包 ─→ §1.4 复制 ─→ J3 主进程接线（重启验证 sql 通道）─→ J2 wrapper + 菜单四件套
        ─→ J4 样式隔离 ─→ J5 实机验证 ─→ J6 模块文档
依赖关系：
  · jianli 复制动作依赖 N1 + N3 完成
  · J5 的 2/4/5 项（SQLiteStyleStore 链路）依赖 N4 发版上 npm
```

---

## §5 风险与注意事项

| # | 风险 / 注意 | 处理 |
| --- | --- | --- |
| 1 | sqlite3 回调式与 `SqliteDriver` 异步端口适配（serialize 串行、BLOB `Uint8Array↔Buffer`、get 单行） | N3 通道契约已覆盖；落地后用 `bibliotype.db` 实测（J5-2） |
| 2 | 事务跨 IPC 无原子性：渲染端崩溃 → 悬挂事务卡连接 | 主进程单槽 + 超时自动 rollback（N3 推荐增强，首发可先不做、注释标明） |
| 3 | 单连接串行吞吐上限 | demo 规模够用；后续并发需求升级路径：主进程换 better-sqlite3 + `createBetterSqliteDriver`（包内已支持），渲染端零改动 |
| 4 | `bibliotype:export-*` 会话单槽：路由页与独立工作台窗口同时导出互踩（exportId 覆盖） | 已知限制，J6 文档注明；体验上两入口短时不会同时导出 |
| 5 | vue 3.5 特性回落 | J1 检查项；命中在通用代码侧改并回传 demo |
| 6 | `host/electron.ts` 的 `window.ipcRenderer` / `electronPdf` 类型 | 复用 `use-export.ts` 既有 `declare global`，不重复声明（冲突会编译错） |
| 7 | electron host 自包含边界破坏（import jianli 模块） | §1.3 硬约束 + N6 的 `vue-tsc` 把关（alias 解析失败即编译错） |
| 8 | `crypto.subtle` secure context | Electron `file://` / localhost 均可信，预期可用；J5-11 实测兜底 |
| 9 | newSql 通道误用 | 存储一律走 `bibliotype:sql-*` 专用通道；jianli 红线：严禁裸 `new-sql:execute`（自动建表劫持 / PRAGMA 无结果 / SELECT 在 data.rows 三坑不适用于专用通道） |
| 10 | localStorage 键碰撞 | electron 侧 `bt:` 前缀；J5-10 核对 |
| 11 | preload `toCloneable` | 渲染端出站 IPC 已统一消毒（含 TypedArray 放行），host 侧无需再 `toPlain`；改 preload 须重启 |
| 12 | 版本通道 | adapter-sqlite 新版先 rc；jianli 安装 `@rc` 或等转正式 latest（按 README §3/§4 流程） |

---

## §6 验收清单

### note_npm（阶段一完成标准）

- [x] `pnpm --filter @bibliotype/adapter-sqlite test` 绿（含 style-store 新测试）
- [x] `pnpm --filter @bibliotype/demo test` 绿（零回归）
- [x] `pnpm --filter @bibliotype/demo exec vue-tsc --noEmit` 绿（host/electron.ts 可解析）
- [ ] 全量 `pnpm build` + `pnpm typecheck` + `pnpm test` 绿
- [ ] changeset 就位；`npm view @bibliotype/adapter-sqlite` 出现新版本
- [x] 文档四件回写：包 README / docs 新篇目 / 三处索引 / demo README

### jianli-app（阶段二完成标准）

- [x] `vue-tsc --noEmit` 绿（SKILL.md 沙箱自证，全项目）
- [ ] J5 实机 13 项逐项通过
- [ ] 复制同步演练一轮闭环：改 demo → 复制 → electron 生效 → electron 侧改动回传 demo → demo 侧测试绿
- [x] `references/modules/bibliotype.md` 更新

---

## 附：本文档依据的源码事实索引

| 事实 | 出处 |
| --- | --- |
| 书库 IndexedDB 硬编码 | `apps/demo/src/composables/use-demo-library.ts:158-159`（实例化点 `components/LibraryDrawer.vue:49`） |
| 草稿 IndexedDB 硬编码 | `apps/demo/src/composables/use-edit-session.ts:64` |
| 样式设置自动降级 | `apps/demo/src/composables/use-style-settings.ts:72`；生产调用点 `use-layout-tokens.ts:66` |
| PDF 双桥（electronPdf / handlePromise） | `apps/demo/src/composables/use-export.ts:48-70, 329-346, 413-429` |
| `bibliotype:export-*` 会话协议主进程实现 | `jianli-app/electron/main/module/bibliotype.ts`（`initBibliotype`，L569-581） |
| preload `handlePromise` + `toCloneable` | `jianli-app/electron/preload/index.ts:52-63` |
| `export-buffer-to-cache` / `export-text-to-cache` 通道 | `jianli-app/electron/main/module/dialog.ts:957-960`（sendSync 语义） |
| 文件定位通道 | `jianli-app/src/utils/fileNotify.ts`（`open-file-in-assets-manager` → `shell.showItemInFolder`） |
| `SqliteDriver` 异步端口 + 双同步引擎工厂 | `packages/adapter-sqlite/src/driver.ts` |
| adapter-sqlite 五表 schema（user_version=1） | `packages/adapter-sqlite/src/schema.ts` |
| `StyleSettingsStore` 端口与三实现 | `packages/core/src/settings/style-settings.ts` · `packages/adapter-indexeddb/src/style-store.ts` |
| sqlite3 依赖（^6.0.1，无双引擎） | `jianli-app/package.json:105` |
| 导出统一规范 / 菜单四件套 / newSql 红线 | `jianli-app/.workbuddy/skills/jianli-app/SKILL.md`（红线 3/8/10） |
