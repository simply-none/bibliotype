# 《Electron 兼容改造清单》执行计划（v2）

## Summary

产出一份**决策完整**的兼容改造清单 `c:\cod\note_npm\Electron兼容改造清单.md`，指导把 `apps/demo`（Vue 3 源码）融合进 jianli-app（Electron + sqlite3）。

**核心架构（用户反馈确定）**：demo 需要频繁复制到 electron 项目运行修改，且 web 端 demo 继续使用——因此凡依赖 electron 的内容（渲染端 host 适配 + 主进程 IPC 模块）**全部收敛在 demo 仓库的专属目录**里维护，note_npm demo 是**唯一上源**；通用代码在两侧 100% 一致，环境差异经「host 适配层」隔离（web/electron 双实现，复制期切换入口文件）。

## Current State Analysis（探索结论）

### demo 存储与导出触点

| 触点 | 文件:行 | 现状 | 目标 |
| --- | --- | --- | --- |
| 书库+版本快照+加密封存 | `use-demo-library.ts:158-159`（`LibraryDrawer.vue:49` 无参实例化） | `new IndexedDbAdapter` + `new IndexedDbVersionStore` 硬编码 | 经 host 工厂注入 |
| 编辑草稿 | `use-edit-session.ts:64` | `new IndexedDbAdapter(drafts)` 硬编码 | 经 host 工厂注入 |
| 样式设置 | `use-style-settings.ts:72`（生产调用点 `use-layout-tokens.ts:66` 未传 store） | `createStyleStore()`（IndexedDB→localStorage→内存） | 经 host 工厂注入 |
| localStorage 键组 | settings-snapshot（3 键）/ toc-prefs / ui-skin / AnnotationPanel / crypto-meta / bt-demo:settings 迁移键 | 无前缀 | 保留 localStorage，键经 host `storageKey()` 加前缀（web 无前缀、electron `bt:`） |
| EPUB/备份/编目下载 | `use-export.ts` download、`use-demo-library.ts` downloadBytes、BookInfoDialog 组件层 | Blob + `a[download]` | 经 host 下载函数注入（web: Blob；electron: `export-buffer-to-cache` sendSync） |
| PDF 导出 | `use-export.ts` | 已内置 `window.electronPdf` + `window.ipcRenderer.handlePromise`（`bibliotype:export-*` 会话）双桥，运行时探测 | **零改动** |
| 其余浏览器 API | scheduler.postTask/requestIdleCallback（autosave）、document.fonts.check、navigator.clipboard、crypto.subtle（PBKDF2/AES-GCM）、beforeunload/pagehide | Chromium 均支持 | 验证项（crypto.subtle 需 secure context，Electron 可用） |

### adapter-sqlite 能力与缺口

- 已有：`SqliteAdapter`（StorageAdapter+BookLibraryStore+BookSummaryStore，骨架+分片，自带 `ensureSchema`）、`SqliteAssetStore`、`SqliteVersionStore`、`SqliteKeyValueStore`。
- 驱动端口 `SqliteDriver`（`exec/prepare/transaction/close` **全异步**，`SqlValue = string|number|null|Uint8Array` 可结构化克隆）→ 天然适合 IPC 转发；内置工厂只包同步引擎（better-sqlite3/sql.js），jianli-app 用 `sqlite3@^6.0.1`（回调式）→ 宿主自实现 `SqliteDriver`（渲染端 IPC 驱动 + 主进程执行器）。
- **缺**：`StyleSettingsStore` 实现 → 在 adapter-sqlite 新增 `SQLiteStyleStore`（用户拍板，走 changeset 发版）。

### jianli-app 约束与既有能力

- preload 已暴露 `window.ipcRenderer.handlePromise`（出参经 `toCloneable` 消毒，TypedArray 放行）→ PDF 会话协议直接可用。
- `electron/main/module/bibliotype.ts` 已注册 `bibliotype:export-*` 全部通道（`ipcMain.handle` 进程级，主窗口路由页可直调）——**保留不动**。
- 导出统一规范：`export-buffer-to-cache` / `export-text-to-cache` 为通用 sendSync 通道（`dialog.ts:957/960`），electron host 可**自包含**调用（不 import jianli-app 模块）；文件定位复用 `open-file-in-assets-manager` 通道。
- 红线：渲染端禁 `import electron/*`；业务数据走 newSql、**严禁裸 `new-sql:execute`** → bibliotype 存储走专用通道（不复用 newSql）；改主进程须重启。
- 新路由四件套：`RouteNames` + `layoutRouters` + `menuGroupDefs`（唯一数据源）+ 可选 iconMap。
- vue：jianli 3.4.21 / demo 3.5.13，包 peer `^3.4.0` 兼容（demo 源码用 3.5 特性需回落——检查项）。

### 用户拍板的决策

1. 融合形态：主窗口新增普通路由页；现有独立工作台窗口/产物拷贝机制不变不删。
2. 依赖引入：jianli-app npm 安装已发包；note_npm 改造后增量发版。
3. 样式设置存储：adapter-sqlite 新增 `SQLiteStyleStore`。
4. 偏好小数据：保留 localStorage（键加前缀）。
5. **（本轮新增）electron 专属内容收敛在 demo 仓库专属目录维护，web/electron 通用代码经复制同步保持一致（demo 为唯一上源）。**

## Proposed Changes（清单文档结构 = 交付物内容）

创建 `c:\cod\note_npm\Electron兼容改造清单.md`：

### §0 背景与目标
源码融合（非产物拷贝）；「单一上源 + host 适配层」架构总述；五条决策记录；一张总架构图（文字版：通用代码 / host-web / host-electron / 主进程模块 四块及复制流向）。

### §1 复制同步模型（核心章节）
- **目录设计**：
  - `apps/demo/src/host/`：`types.ts`（HostEnvironment 端口）、`web.ts`（web 实现=现状逻辑搬迁）、`electron.ts`（electron 实现）、`index.ts`（web 入口：`export * from './web.js'`）；
  - `apps/demo/electron/main/module/bibliotype-store.ts`：主进程 IPC SQLite 执行器（复制到 jianli `electron/main/module/`）。
- **HostEnvironment 端口签名**（示意，清单中给出完整定义）：`createLibraryStores()`（adapter+versionStore）、`createDraftStore()`、`createStyleSettingsStore()`、`downloadBytes(bytes, filename)`、`downloadText(text, filename)`、`storageKey(key)`、`hostName`（面板显示存储链路名）。
- **复制映射表**：

| demo 仓库源 | jianli-app 目标 | 规则 |
| --- | --- | --- |
| `apps/demo/src/**`（除 `host/index.ts`、`host/web.ts`、`main.ts`） | `src/views/bibliotypeStudio/**` | 双向同步（以 demo 为上源） |
| `apps/demo/src/host/electron.ts` | `src/views/bibliotypeStudio/host/index.ts` | 复制期替换入口（web→electron） |
| `apps/demo/electron/main/module/bibliotype-store.ts` | `electron/main/module/bibliotype-store.ts` | 双向同步 |
| —（jianli 维护，不复制） | wrapper 组件、路由/菜单注册、main index init 行、package.json 依赖 | 接线文件 |

- 不复制文件：`host/index.ts`（web 入口）、`host/web.ts`（可选复制保留回切能力，缺省跳过）、`main.ts`/`index.html`/`vite.config.ts`（jianli 自有入口）。
- **回传约定**：electron 侧只允许改「通用代码」与「electron 专属文件」，改完回传 demo 对应路径；禁止在 jianli 侧散落修改出复制映射外的文件。
- **同步脚本（可选推荐）**：`apps/demo/scripts/sync-to-jianli.mjs`（node 复制脚本：执行映射+入口替换，`--dry-run` 预览），减少手工失误。

### §2 note_npm 侧改造（demo 仓库）
- **N1 host 适配层落地**：
  - 新建 `src/host/{types,web,electron,index}.ts`（web.ts = 现状 IndexedDB 工厂 + Blob 下载 + 无前缀键；electron.ts = IPC 驱动 + sqlite stores 工厂 + sendSync 导出 + `bt:` 前缀键，自包含不 import jianli-app 模块）；
  - 通用代码环境依赖点收敛（全部改 import `host/index.js`）：`use-demo-library.ts`（stores 工厂 + downloadBytes + crypto meta 键）、`use-edit-session.ts`（draftStore 工厂）、`use-layout-tokens.ts:66`（传 `store: host.createStyleSettingsStore()`）、`use-export.ts`（download 经 host）、`use-settings-snapshot.ts`/`use-toc-prefs.ts`/`ui-skin.ts`/`AnnotationPanel.vue`（localStorage 键经 `storageKey()`）；
  - **缺省行为不变**：host/index.ts = web 实现 → web demo 与全部既有测试零回归（开发规范第六/十节）。
- **N2 adapter-sqlite 新增 SQLiteStyleStore**：实现 core `StyleSettingsStore` 端口（snapshots/presets 两表进 `schema.ts` 升版或复用 settings KV——清单写明选定方案与理由）；`src/__tests__` 对照 IndexedDbStyleStore 语义补测试；导出进 index.ts；中文 JSDoc；包 README 回写。
- **N3 主进程模块**：`apps/demo/electron/main/module/bibliotype-store.ts`——sqlite3 打开 `userData/bibliotype.db`（WAL、`db.serialize` 串行化）；通道 `bibliotype:sql-exec|run|get|all` + `bibliotype:sql-tx-begin|commit|rollback`（参数/返回值经结构化克隆，BLOB `Uint8Array↔Buffer`；statement 每条 prepare（备注 Map 缓存优化点）；单槽事务+嵌套拒绝，对齐 SqliteDriver 语义；悬挂事务超时回收——设计注意）；**无 schema/业务逻辑**（ensureSchema 由渲染端经通道执行）；导出 `initBibliotypeStore()`；该目录置于 demo `tsconfig` include 之外（不参与 web typecheck/构建），文件内注释说明复制目标与接线方式。
- **N4 changeset 与增量发版**：`@bibliotype/adapter-sqlite`（新导出面，必须 changeset）→ `pnpm changeset` → `version:rc` → `release:rc`；demo 为 private 不发布。
- **N5 文档回写**（开发规范第九节）：adapter-sqlite README + docs 篇目（「Electron 宿主接入」——host 适配层架构、复制同步模型、IPC 驱动契约）+ 三处索引同步；新踩坑按需入 docs/14。
- **N6 验证**：全量 `pnpm test` / `pnpm typecheck` / `pnpm build`；`pnpm --filter @bibliotype/demo exec vue-tsc --noEmit` 确认 host/electron.ts 类型可解析（无 jianli alias 依赖）。

### §3 jianli-app 侧改造（接线）
- **J1 依赖安装**：`@bibliotype/{core,editor,classical,layout,reader,vue,annotation,import,import-docx,import-epub,exporter-epub,exporter-pdf,adapter-sqlite}`（版本按 npm 实际通道 rc/latest 写明）；`@bibliotype/vue/style.css` 引入方式。
- **J2 复制与路由页**：按 §1 映射表复制；jianli 维护 wrapper 组件（`src/views/bibliotypeStudio.vue`：挂载 demo App.vue + 样式容器）；菜单四件套注册（RouteNames/layoutRouters/menuGroupDefs/iconMap，图标遵守导入验证规则）。
- **J3 主进程接线**：main index 调 `initBibliotypeStore()`（一行，须重启）；确认不与既有 `bibliotype.ts` 通道冲突（存储通道独立、导出通道复用）。
- **J4 样式共存验证**：demo `styles.css`/`styles/*.css` 全局规则与 element-plus/skins 主题冲突排查表；隔离方案（容器命名空间 `.bt-studio` 前缀或路由级样式装卸）——若需改通用样式文件，改动回传 demo（单一上源）。
- **J5 实机验证清单**：路由可达 + 菜单三处同步；书库/草稿/版本/样式落 `bibliotype.db`（sqlite 工具查 `documents/chunks/snapshots/presets/settings` 表）；自动保存（postTask/idle 链路）；EPUB/备份/编目导出落 fileCachePath + 路径提示可点定位（`open-file-in-assets-manager`）；PDF 分段导出会话；localStorage 键带 `bt:` 前缀且跨会话保持；与独立工作台窗口并存无冲突。
- **J6 模块文档**：更新 `.workbuddy/skills/jianli-app/references/modules/bibliotype.md`（路由页形态、复制同步约定、IPC 通道、存储布局）。

### §4 实施顺序
1. note_npm：N2 SQLiteStyleStore → N1 host 适配层 + 依赖点收敛 → N3 主进程模块 → N6 验证 → N4 发版 → N5 文档；
2. jianli-app：J1 装包 →（§1 映射）复制 → J3 主进程接线（重启验证通道）→ J2 wrapper + 菜单注册 → J4 样式验证/隔离 → J5 实机验证 → J6 文档。
   依赖关系：jianli 复制动作依赖 N1/N3 完成；J5 存储链路依赖 N4 发版（SQLiteStyleStore 上 npm）。

### §5 风险与注意事项
- sqlite3 回调式与异步端口适配（serialize 串行、BLOB 往返 Buffer↔Uint8Array、get 返回单行）；
- 事务跨 IPC 无原子性：渲染端崩溃悬挂事务 → 主进程超时回收（设计注意项）；
- 单连接串行：demo 规模够用；并发写需求升级 better-sqlite3 的替代路径备注；
- 两侧 `bibliotype:export-*` 单槽会话：路由页与独立工作台窗口同时导出互踩（已知限制，清单注明）；
- vue 3.5 特性回落检查（demo 源码 3.5.13 vs jianli 3.4.21）；
- host/electron.ts 的 `window.ipcRenderer`/`electronPdf` 类型：复用 use-export.ts 既有 `declare global`，避免重复声明冲突；
- electron host 自包含边界：只准用 `window.ipcRenderer` 全局 + 已发包 + web 标准 API，禁 import jianli 模块/alias（保证 note_npm typecheck 可过、复制即用）。

### §6 验收清单
- note_npm：全量 test/typecheck/build 绿；`npm view @bibliotype/adapter-sqlite` 确认新版本；web demo 行为与改造前一致（含存储链路面板显示）。
- jianli-app：`vue-tsc --noEmit` 绿；J5 实机清单逐项通过；复制同步演练一轮（改 demo → 复制 → electron 生效 → electron 侧改动回传 demo）验证单一上源闭环。

## Assumptions & Decisions

- 清单为中文 GFM 文档，位于 `c:\cod\note_npm\Electron兼容改造清单.md`（与根目录既有清单文件风格一致）。
- 清单是指导性文档（不含完整实现代码），但每项含精确文件路径、接口签名、验收标准，可直接开工。
- 本次执行只产出清单文档：不改代码、不发包、不动 jianli-app。
- web demo 缺省行为不变（host/index.ts = web 实现），所有既有测试不回归。

## Verification steps

1. 覆盖度自查：对照「Current State Analysis」触点表逐项核对（3 处 IndexedDB、9 组 localStorage 键、3 类下载点、PDF 双桥、7 项浏览器 API 验证项）——每触点在清单中有对应条目。
2. 交叉核对引用的文件路径/行号（use-demo-library / use-edit-session / use-export / bibliotype.ts / dialog.ts / exportToFile.ts）。
3. 接口签名与源码一致性抽查（SqliteDriver、StyleSettingsStore、UseStyleSettingsOptions、handlePromise、export-buffer-to-cache 参数）。
4. 交付说明：清单文件位置 + 结构摘要（computer:// 链接）。
