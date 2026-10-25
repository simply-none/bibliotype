# bibliotype

**Web 端书籍级内容排版、编辑与阅读框架（含古籍支持）**

bibliotype 以「书籍」为一等公民：统一的数据模型（IR）、可扩展的编辑与渲染管线、
完整的版式与导出能力，同时覆盖现代书籍与古籍（双行小注、直排右起、校勘）两类场景。

## 特性

- **书籍级数据模型（IR）**：语义节点树 + 行内标记 + 书目元数据，稳定节点 id 贯穿编辑 / 分页 / 导出；
- **编辑**：基于 ProseMirror 的无视图编辑状态机，IR ⇄ ProseMirror 双向转换、规格注册表、命令与键位；
- **古籍支持**：双行小注 / 夹注 / 眉批 / 校勘记 / 牌记 / 题跋，专名号 / 书名号 / 圈点，直排右起与数字合并；
- **古籍仿真直排**：版框 / 界行 / 版心（书口·鱼尾）与十二种木刻抄本版式模板（宋刻浙本、宋建本、宋蜀刻大字本、元刻本、明嘉靖本、明万历本、汲古阁本、清武英殿本、清写刻本、四库馆写本、朱丝栏抄本、巾箱本），与既有古籍直排并列、互不影响；
- **阅读器**：内容块抽取 → 贪心分页 → 翻页 / 目录 / 全文搜索 / 中文与罗马页码；
- **版式与样式**：主题令牌 → CSS 变量 / 书册样式表（buildBookCss），渲染与导出同源；
- **导出**：EPUB 3（零后端、浏览器与 Node 同构）、PDF（打印文档 + 宿主适配器直出）与静态站点（多页 HTML + 搜索索引）；
- **协同与存储**：Yjs 协同会话（IR ⇄ Y.Doc），IndexedDB / 内存 / 远端 REST 适配器，资产端口；
- **位置与标注**：统一锚点契约（节点 id + 字符偏移）承载阅读位置、书签、高亮、笔记与评论；
- **中文精排**：禁则避头尾、标点挤压、中西文混排间距；两遍排版交叉引用（参见第 X 页）；繁简 / 异体字转换；
- **Vue 3 封装**：useReader / useEditorBinding 等组合式 API 与 BtBookView / BtPager / BtToc / BtEditor 组件；
  目录增强（当前章高亮 / 折叠记忆 / 目录内搜索）、注释双向跳转与预览、主题预设包与字体回退调试均已内置。

## 包一览

| 包 | 说明 |
| --- | --- |
| [`@bibliotype/core`](packages/core/README.md) | IR 数据模型、事件总线、插件与节点注册、主题令牌、存储契约 |
| [`@bibliotype/editor`](packages/editor/README.md) | 编辑器核心：编辑规格注册、IR ⇄ ProseMirror 转换、命令与键位 |
| [`@bibliotype/classical`](packages/classical/README.md) | 古籍节点与标记、古籍主题、编辑命令（含 `./editor` 子入口） |
| [`@bibliotype/layout`](packages/layout/README.md) | 页面尺寸、书写方向、分页器、样式构建（含 `./html` 子入口） |
| [`@bibliotype/reader`](packages/reader/README.md) | 阅读状态机：分页、翻页、目录、搜索、页码 |
| [`@bibliotype/vue`](packages/vue/README.md) | Vue 3 组件与组合式 API（useReader / useEditorBinding 等） |
| [`@bibliotype/collab`](packages/collab/README.md) | 协同：IR ⇄ Y.Doc 映射、协同会话、Provider 抽象 |
| [`@bibliotype/provider-websocket`](packages/provider-websocket/README.md) | WebSocket / BroadcastChannel Provider（重连 + 离线队列）与参考服务端 |
| [`@bibliotype/adapter-indexeddb`](packages/adapter-indexeddb/README.md) | IndexedDB / 内存存储适配器（core StorageAdapter 实现） |
| [`@bibliotype/adapter-sqlite`](packages/adapter-sqlite/README.md) | SQLite 存储适配器（驱动由宿主注入，能力对齐 IndexedDB） |
| [`@bibliotype/exporter-epub`](packages/exporter-epub/README.md) | EPUB 3 导出（IR → 语义 XHTML + OPF/nav 打包） |
| [`@bibliotype/exporter-pdf`](packages/exporter-pdf/README.md) | PDF（打印）导出（@page 尺寸 / 预分页固定页） |
| [`@bibliotype/exporter-site`](packages/exporter-site/README.md) | 静态站点导出（多页 HTML + 目录 + 搜索索引） |
| [`@bibliotype/adapter-http`](packages/adapter-http/README.md) | 远端存储适配器（REST 文档 + 资产） |
| [`@bibliotype/annotation`](packages/annotation/README.md) | 标注（高亮 / 书签 / 笔记 / 评论，基于 core 锚点） |
| [`@bibliotype/typography-cjk`](packages/typography-cjk/README.md) | 中文排印（禁则 / 标点挤压 / 中西文混排，零依赖） |
| [`@bibliotype/xref`](packages/xref/README.md) | 交叉引用（两遍排版页码索引与占位替换） |
| [`@bibliotype/textconvert`](packages/textconvert/README.md) | 繁简 / 异体字转换（内置表 + OpenCC 适配） |
| `@bibliotype/demo`（`apps/demo`，私有） | 《论语》全链路示例（[在线 Demo](https://simply-none.github.io/bibliotype/)）：分页阅读 / 目录 / 直排切换 / 编辑 / 导出 |

包依赖关系（自下而上）：

```text
core → layout → reader → exporter-pdf / exporter-epub
core → editor → classical（节点与命令扩展）
core + editor + layout + reader → vue → apps/demo
core → collab / adapter-indexeddb / adapter-sqlite / adapter-http
collab → provider-websocket
core → annotation / typography-cjk / textconvert
core + layout → xref / exporter-site
```

## 快速开始

要求：Node ≥ 18、pnpm ≥ 9。

```bash
pnpm install        # 安装依赖
pnpm build          # 增量构建（turbo 缓存命中则跳过）
pnpm build:full     # 全量构建（--force 绕过缓存，所有包重跑；dist 陈旧/怀疑缓存问题时用）
pnpm test           # 全量测试（vitest）
pnpm typecheck      # 全量类型检查
pnpm dev:demo       # 只启动 Demo（http://localhost:5173，依赖各包已有 dist）
pnpm --filter @bibliotype/demo dev   # 同上（等价直调写法）
```

## 最小示例

阅读（无框架，命令式）：

```ts
import { Reader } from '@bibliotype/reader';

const reader = new Reader();
reader.loadDocument(document);          // document: BookDocument（IR）
reader.nextPage();
console.log(reader.formatCurrentPageNumber(), reader.totalPages);
```

Vue 3（响应式阅读组件）：

```vue
<script setup lang="ts">
import { useReader, BtBookView, BtPager } from '@bibliotype/vue';

const { reader } = useReader(lunyuDocument);   // BookDocument → 响应式 Reader
</script>

<template>
  <BtBookView :reader="reader" />
  <BtPager :reader="reader" />
</template>
```

导出 EPUB（浏览器与 Node 同构，产物为 `Uint8Array`）：

```ts
import { exportEpub } from '@bibliotype/exporter-epub';

const bytes = exportEpub(document);   // 由调用方保存 / 下载为 .epub
```

## 文档

功能用法参考位于 [`docs/`](docs/README.md)，每个大功能一篇：

| 文档 | 内容 |
| --- | --- |
| [01 数据模型](docs/01-document-model.md) | BookDocument / 节点 / 标记 / 元数据 / 稳定 id |
| [02 编辑器与插件](docs/02-editor-and-plugins.md) | 编辑规格、IR ⇄ PM 转换、命令、插件系统 |
| [03 古籍排版](docs/03-classical-layout.md) | 古籍节点、标记、主题、编辑命令 |
| [04 阅读器与分页](docs/04-reader-and-pagination.md) | 分页器、块抽取、目录、搜索、页码 |
| [05 版式与 HTML](docs/05-layout-and-html.md) | 布局选项、样式构建、HTML 序列化 |
| [06 Vue 集成](docs/06-vue-integration.md) | useReader / 组件 / 插件安装 |
| [07 EPUB 导出](docs/07-export-epub.md) | 章节规划、OPF/nav、打包 |
| [08 PDF 与打印](docs/08-export-pdf.md) | 打印 CSS、预分页、对页 / 出血 / 裁切线、图片 DPI 与 CMYK 提示 |
| [09 协同编辑](docs/09-collab.md) | Y.Doc 映射、会话、Provider、WebSocket / 多标签传输 |
| [10 存储适配器](docs/10-storage-adapters.md) | StorageAdapter 契约、IndexedDB / 内存 / SQLite 实现 |
| [11 主题与令牌](docs/11-theme-tokens.md) | 令牌体系、古典覆盖、自定义主题 |
| [12 工程化与发布](docs/12-release-and-ci.md) | 日期版本、Changesets、CI、npm 发布 |
| [13 核心运行时](docs/13-core-runtime.md) | 事件总线、节点注册、核心实例 |
| [14 常见问题与故障排查](docs/14-faq.md) | 经典问题排查：注文样式、点击跳转、样式作用域、Node 环境 |
| [15 SSR 与 Node 同构](docs/15-ssr-and-node.md) | 环境对照表与浏览器依赖替代方案 |
| [16 测试指南](docs/16-testing.md) | 测试组织、vitest、fake-indexeddb / happy-dom |
| [17 文档导入](docs/17-document-import.md) | Markdown / HTML / docx / epub → BookDocument |
| [18 纸书排版引擎路线图](docs/18-pagination-engine-roadmap.md) | 行级拆分 / 孤寡行 / 预览编辑同源的阶段计划 |
| [19 编辑工具条使用说明](docs/19-editor-toolbar-usage.md) | 编辑按钮的前提 / 落点 / 命令 / 限制与「点了没反应」速查 |
| [20 选区替换为](docs/20-selection-replace.md) | 选中文字转换为双行注 / 眉批 / 夹注等容器；浮动菜单与文本前后切分规则 |
| [21 表格编辑](docs/21-table-editing.md) | Word / WPS 式行列网格插入、语义 DOM、表格整体成块与直排支持 |
| [22 古籍仿真直排](docs/22-facsimile-vertical.md) | 版框 / 界行 / 版心书口、十二种古籍版式模板与「古籍直排」隔离设计 |
| [23 IR 校验、迁移与锚点](docs/23-ir-validation-and-migration.md) | 锚点契约、结构校验、schemaVersion 逐级迁移 |
| [24 标注](docs/24-annotation.md) | 高亮 / 书签 / 笔记 / 评论模型、容器、持久化与孤儿处理 |
| [25 中文排印](docs/25-cjk-typography.md) | 禁则避头尾、标点挤压、中西文混排间距、CSS 声明 |
| [26 交叉引用](docs/26-cross-reference.md) | 两遍排版页码索引、「参见第 X 页」占位替换与标签登记 |
| [27 文本转换](docs/27-text-conversion.md) | 繁简 / 异体字转换、命中记录、OpenCC 接入、反向表 |
| [28 静态站点导出](docs/28-site-export.md) | 目录页 + 分节页 + 样式 + 搜索索引，纯函数导出 |
| [29 远端存储适配器](docs/29-adapter-http.md) | REST 文档 / 资产端点契约、错误语义、fetch 注入 |

参与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 版本与发布

版本号采用**日期形式**：正式版 `26.10.12`（年.月.日），预发布 `26.10.12-rc.1`。
**增量发布**：只有出现在变更说明里的公开包才升版并发布，未变更包的版本号与 npm 上的
产物保持不变。发布走**本机手动命令**，npm 令牌存在项目根 `.npmrc.publish`（已 gitignore）。

### 0. 一次性准备（首次发布前做）

**① 确认 scope 归属**：`@bibliotype/*` 属于 `@bibliotype` 这个 scope，只有该 scope 的
所有者 / 组织成员才能发布。

- 若 npm 用户名就是 `bibliotype`：直接可发；
- 否则去 <https://www.npmjs.com/org/create> 创建组织 `bibliotype`（免费 Public 计划即可），
  把当前账号设为成员（Owner / Developer）。

> 未处理这一步的典型报错是 `npm ERR! 404 Scope not found` 或 `403 Forbidden`。

**② 生成 npm Access Token**：<https://www.npmjs.com/settings/~/tokens> → *Generate New Token*

| 选项 | 建议值 |
| --- | --- |
| 类型 | **Granular Access Token**（或 Classic 的 **Automation** token） |
| Permissions | `Read and write`（需要发布权限） |
| Packages and scopes | 选 `@bibliotype`（或 All packages） |
| Bypass 2FA | **勾选**（否则非交互发布会因缺 OTP 失败，`EOTP`） |
| Expiration | 按需（如 90 天；到期后重签发并更新文件） |

若账号开启了 2FA，**不要**用 Classic 的 *Publish* 类型令牌（它仍要 OTP），
务必用 Automation 或勾了 Bypass 2FA 的 Granular token。

**③ 把令牌写入 `.npmrc.publish`**（项目根，已 `.gitignore`，不会入库）

```ini
# c:\cod\note_npm\.npmrc.publish
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=npm_xxxxxxxxxxxxxxxxxxxx
```

> `.npmrc`（已入库）只放 workspace 配置，**不要**把 token 写进去。
> `scripts/publish.mjs` 会自动把 `.npmrc.publish` 挂成用户级 npmrc，并强制
> `--registry=https://registry.npmjs.org/`（本机全局配置可能是 npmmirror 镜像站）。

**④ 验证令牌可用（可选，但建议）**

PowerShell：

```powershell
$env:NPM_CONFIG_USERCONFIG = Join-Path $PWD '.npmrc.publish'
npm whoami --registry=https://registry.npmjs.org/   # 应打印你的 npm 用户名
```

bash / Git Bash：

```bash
NPM_CONFIG_USERCONFIG="$PWD/.npmrc.publish" npm whoami --registry=https://registry.npmjs.org/
```

> 本流程**不需要** `npm login`：登录态由 `.npmrc.publish` 里的 `_authToken` 提供。
> 若你确实执行过 `npm login`，令牌会写进用户级 `~/.npmrc`；但只要项目内存在
> `.npmrc.publish`，发布脚本就只认它（`~/.npmrc` 被覆盖），两者不要混用。

### 1. 首次发布（全量 23 个包，rc 通道）

首次必须用 `--all`：`@bibliotype/collab` 没有独立变更说明，但被
`provider-websocket` 依赖，漏发会让已发布包依赖一个不存在的版本。

```bash
# ① 应用版本号：全部公开包升到当日 rc 版本，并写出待发清单 .release/pending.json
pnpm version:rc:all

# ② 预检：core 版本对账 + 全仓构建 + 发布 dry-run（不真正上传，不需要 token 也能跑）
pnpm release:check

# ③ 提交并打 tag（提交由维护者执行）
git add -A
git commit -m "chore(release): v26.10.25-rc.1"
git tag v26.10.25-rc.1

# ④ 真正发布（构建 + 批量上传，token 从这里开始生效）
pnpm release:rc
```

发布过程的预期输出：`[publish] 已认证：<用户名>` → 待发包清单 → 每个包的
`... publish ... + @bibliotype/xxx@26.10.25-rc.1`。中途失败可直接重跑同一条命令，
registry 上已存在同版本的包会被自动跳过。

### 2. 核验发布结果

```bash
npm view @bibliotype/core dist-tags --registry=https://registry.npmjs.org/
# → { rc: '26.10.25-rc.1' }   （首次只发 rc，所以还没有 latest 标签）

npm view @bibliotype/reader@26.10.25-rc.1 dependencies --registry=https://registry.npmjs.org/
# 内部依赖应已被 pnpm 改写成具体版本号，而不是 workspace:*
```

消费方安装 rc：`npm i @bibliotype/core@rc`；或显式 `@bibliotype/core@26.10.25-rc.1`。

### 3. 提升为正式版（rc → latest）

rc 阶段已消费掉全部变更说明，直接跑 `version:latest` 会因无变更说明退出码 2，
必须用 `--reuse-pending`（复用待发清单，只改版本号，不重复写 CHANGELOG）：

```bash
pnpm version:latest:reuse
git add -A
git commit -m "chore(release): v26.10.25"
git tag v26.10.25
pnpm release            # = 构建 + publish --tag latest
git push origin master --follow-tags
```

核验：`npm view @bibliotype/core dist-tags` 的 `latest` 应为 `26.10.25`。

### 4. 之后的日常发布（增量）

```bash
pnpm changeset          # 只勾选本次真正改动的包
pnpm version:rc         # 只升这些包；未变更包版本不动
pnpm release:check      # 预检（可选）
git add -A && git commit -m "chore(release): v<版本>" && git tag v<版本>
pnpm release:rc
pnpm version:latest:reuse
git add -A && git commit -m "chore(release): v<正式版本>" && git tag v<正式版本>
pnpm release
```

### 5. 常见报错

| 报错 / 现象 | 原因与处理 |
| --- | --- |
| `npm ERR! 401 Unauthorized` / `ENEEDAUTH` | token 缺失或过期：检查 `.npmrc.publish` 的 `_authToken`，重新签发 |
| `npm ERR! 403 ... scope` / `404 Scope not found` | `@bibliotype` scope 不属于当前账号：创建组织并加入成员（见 0.①） |
| `npm ERR! 403 ... two-factor` / `EOTP` | 令牌未勾 Bypass 2FA：改用 Automation token 或勾选 Bypass |
| `npm ERR! 403 ... cannot publish over` | 该版本已存在：改代码后重跑 `pnpm version:rc` 生成新版本号（重跑同版本会被自动跳过） |
| `[publish] 错误：... 与待发版本 ... 不一致` | 本地 `package.json` 被改过：重新执行 `pnpm version:rc` / `version:latest:reuse` |
| `[publish] 错误：未找到 .release/pending.json` | 还没应用版本：先跑 `pnpm version:rc`（或 `:all`） |
| `[publish] 错误：依赖版本在 npm 上不存在` | 依赖包未发：先发依赖，或首次发布改用 `pnpm version:rc:all` |
| 安装时提示找不到包 | 本机 registry 指向镜像站：`npm i --registry=https://registry.npmjs.org/`，镜像同步有延迟 |

完整设计说明见 [docs/12-release-and-ci.md](docs/12-release-and-ci.md)。

## 许可

[MIT](LICENSE)
