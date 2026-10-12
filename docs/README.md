# bibliotype 功能用法参考

按大功能分篇的参考文档，每篇对应一组包与一条完整用法链路。
建议先读 [01 数据模型](01-document-model.md) 理解 IR，再按需进入其他篇。

## 阅读路线

| 目标 | 路线 |
| --- | --- |
| 快速跑起来 | 根 [README](../README.md) 快速开始 → [06 Vue 集成](06-vue-integration.md) |
| 做编辑与插件 | [01](01-document-model.md) → [02 编辑器与插件](02-editor-and-plugins.md) → [03 古籍](03-classical-layout.md) |
| 做阅读器与版式 | [01](01-document-model.md) → [04 阅读与分页](04-reader-and-pagination.md) → [05 版式与 HTML](05-layout-and-html.md) → [11 主题令牌](11-theme-tokens.md) |
| 做导出 | [05](05-layout-and-html.md) → [07 EPUB](07-export-epub.md) → [08 PDF 与打印](08-export-pdf.md) |
| 做协同与存储 | [01](01-document-model.md) → [09 协同](09-collab.md) → [10 存储](10-storage-adapters.md) |
| 工程维护与发布 | [12 工程化与发布](12-release-and-ci.md) |

## 篇目

| 文档 | 内容 | 主要涉及 |
| --- | --- | --- |
| [01 数据模型](01-document-model.md) | IR、节点、标记、元数据、稳定 id | `@bibliotype/core` |
| [02 编辑器与插件](02-editor-and-plugins.md) | 编辑规格、IR ⇄ PM 转换、命令、插件系统 | `core` / `editor` |
| [03 古籍排版](03-classical-layout.md) | 古籍节点、标记、主题、编辑命令 | `@bibliotype/classical` |
| [04 阅读器与分页](04-reader-and-pagination.md) | 块抽取、贪心分页、目录、搜索、页码 | `reader` / `layout` |
| [05 版式与 HTML](05-layout-and-html.md) | 布局选项、样式构建、HTML 序列化 | `@bibliotype/layout` |
| [06 Vue 集成](06-vue-integration.md) | 组合式 API、组件、插件 | `@bibliotype/vue` |
| [07 EPUB 导出](07-export-epub.md) | 章节规划、OPF/nav、打包 | `@bibliotype/exporter-epub` |
| [08 PDF 与打印](08-export-pdf.md) | 打印 CSS、预分页、printBook | `@bibliotype/exporter-pdf` |
| [09 协同编辑](09-collab.md) | Y.Doc 映射、会话、Provider | `@bibliotype/collab` |
| [10 存储适配器](10-storage-adapters.md) | StorageAdapter 契约与实现 | `@bibliotype/adapter-indexeddb` |
| [11 主题与令牌](11-theme-tokens.md) | 令牌体系、古典覆盖、自定义主题 | `core` / `classical` / `layout` |
| [12 工程化与发布](12-release-and-ci.md) | 日期版本、Changesets、CI、npm 发布 | 全仓 |

## 架构总览

```text
apps/demo                          ← 集成示例（Vue 3 + Vite）
 └── @bibliotype/vue               ← 组合式 API 与组件
      ├── @bibliotype/reader       ← 阅读状态机（分页 / 目录 / 搜索）
      │    └── @bibliotype/layout  ← 分页器 / 样式构建 / HTML 序列化
      ├── @bibliotype/editor       ← ProseMirror 编辑核心
      └── @bibliotype/core         ← IR 数据模型 / 插件 / 主题 / 存储契约

库与扩展（平行接入）
 ├── @bibliotype/classical         ← 古籍节点 / 主题 / 编辑命令（插件 + ./editor 子入口）
 ├── @bibliotype/collab            ← 协同（IR ⇄ Y.Doc）
 ├── @bibliotype/adapter-indexeddb ← 存储实现（IndexedDB / 内存）
 └── @bibliotype/exporter-epub / exporter-pdf ← 导出（依赖 core / layout / reader）
```

核心数据流（编辑与阅读共用一条链路）：

```text
BookDocument（IR）
   ├─编辑：irNodeToPm → ProseMirror EditorState → 事务 → pmNodeToIr → BookDocument
   └─阅读：extractBlocks → 分块 → paginate → 分页 → serializeNode → HTML 渲染
                                    （导出器复用同一序列化）
```
