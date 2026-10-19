# bibliotype

**Web 端书籍级内容排版、编辑与阅读框架（含古籍支持）**

bibliotype 以「书籍」为一等公民：统一的数据模型（IR）、可扩展的编辑与渲染管线、
完整的版式与导出能力，同时覆盖现代书籍与古籍（双行小注、直排右起、校勘）两类场景。

## 特性

- **书籍级数据模型（IR）**：语义节点树 + 行内标记 + 书目元数据，稳定节点 id 贯穿编辑 / 分页 / 导出；
- **编辑**：基于 ProseMirror 的无视图编辑状态机，IR ⇄ ProseMirror 双向转换、规格注册表、命令与键位；
- **古籍支持**：双行小注 / 夹注 / 眉批 / 校勘记 / 牌记 / 题跋，专名号 / 书名号 / 圈点，直排右起与数字合并；
- **阅读器**：内容块抽取 → 贪心分页 → 翻页 / 目录 / 全文搜索 / 中文与罗马页码；
- **版式与样式**：主题令牌 → CSS 变量 / 书册样式表（buildBookCss），渲染与导出同源；
- **导出**：EPUB 3（零后端、浏览器与 Node 同构）与 PDF（打印文档 + `window.print` 辅助）；
- **协同与存储**：Yjs 协同会话（IR ⇄ Y.Doc），IndexedDB / 内存存储适配器；
- **Vue 3 封装**：useReader / useEditorBinding 组合式 API 与 BtBookView / BtPager / BtToc / BtEditor 组件。

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
| [`@bibliotype/adapter-indexeddb`](packages/adapter-indexeddb/README.md) | IndexedDB / 内存存储适配器（core StorageAdapter 实现） |
| [`@bibliotype/exporter-epub`](packages/exporter-epub/README.md) | EPUB 3 导出（IR → 语义 XHTML + OPF/nav 打包） |
| [`@bibliotype/exporter-pdf`](packages/exporter-pdf/README.md) | PDF（打印）导出（@page 尺寸 / 预分页固定页） |
| `@bibliotype/demo`（`apps/demo`，私有） | 《论语》全链路示例：分页阅读 / 目录 / 直排切换 / 编辑 / 导出 |

包依赖关系（自下而上）：

```text
core → layout → reader → exporter-pdf / exporter-epub
core → editor → classical（节点与命令扩展）
core + editor + layout + reader → vue → apps/demo
core → collab / adapter-indexeddb
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
| [08 PDF 与打印](docs/08-export-pdf.md) | 打印 CSS、预分页、printBook |
| [09 协同编辑](docs/09-collab.md) | Y.Doc 映射、会话、Provider |
| [10 存储适配器](docs/10-storage-adapters.md) | StorageAdapter 契约、IndexedDB / 内存实现 |
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

参与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 版本与发布

版本号采用**日期形式**：正式版 `26.10.12`（年.月.日），预发布 `26.10.12-rc.1`。
发布流程三步（详见 [docs/12-release-and-ci.md](docs/12-release-and-ci.md)）：

```bash
pnpm changeset          # 1. 改动完成后记录变更说明
pnpm version:rc         # 2. 应用版本号与 CHANGELOG（或 pnpm version:latest）
pnpm release:rc         # 3. 构建并发布到 npm（或 pnpm release 正式发布）
```

## 许可

[MIT](LICENSE)
