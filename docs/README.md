# bibliotype 功能用法参考

按大功能分篇的参考文档，每篇对应一组包与一条完整用法链路。
建议先读 [01 数据模型](01-document-model.md) 理解 IR，再按需进入其他篇。

## 阅读路线

| 目标 | 路线 |
| --- | --- |
| 快速跑起来 | 根 [README](../README.md) 快速开始 → [06 Vue 集成](06-vue-integration.md) |
| 跑通全链路示例 | 根 [README](../README.md) 快速开始 → [apps/demo/README](../apps/demo/README.md)（分页 / 目录 / 书签 / 直排切换 / 编辑 / 导出） |
| 做编辑与插件 | [01](01-document-model.md) → [02 编辑器与插件](02-editor-and-plugins.md) → [03 古籍](03-classical-layout.md) → [19 工具条使用说明](19-editor-toolbar-usage.md) → [20 选区替换为](20-selection-replace.md) → [21 表格编辑](21-table-editing.md) |
| 做插件扩展（事件 / 自定义节点） | [01](01-document-model.md) → [13 核心运行时](13-core-runtime.md) → [02 编辑器与插件](02-editor-and-plugins.md) |
| 做阅读器与版式 | [01](01-document-model.md) → [04 阅读与分页](04-reader-and-pagination.md) → [05 版式与 HTML](05-layout-and-html.md) → [11 主题令牌](11-theme-tokens.md) → [22 古籍仿真直排](22-facsimile-vertical.md) |
| 做导出 | [05](05-layout-and-html.md) → [07 EPUB（含字体内嵌）](07-export-epub.md) → [08 PDF 与打印（含精排）](08-export-pdf.md) → [32 DOCX](32-export-docx.md) → [06 图片 / 长图](06-vue-integration.md) |
| 做文档导入 | [01](01-document-model.md) → [02 编辑器与插件](02-editor-and-plugins.md) → [17 文档导入](17-document-import.md) |
| 做协同与存储 | [01](01-document-model.md) → [09 协同](09-collab.md) → [10 存储](10-storage-adapters.md) → [29 远端适配器](29-adapter-http.md) |
| 做桌面（Electron）宿主接入 | [10 存储](10-storage-adapters.md) → [33 Electron 宿主接入](33-electron-host.md) → [15 SSR 与 Node 同构](15-ssr-and-node.md) |
| 做标注与位置恢复 | [23 锚点](23-ir-validation-and-migration.md) → [24 标注](24-annotation.md) |
| 做中文精排 | [25 中文排印](25-cjk-typography.md) → [04 阅读与分页](04-reader-and-pagination.md) → [18 排版引擎路线图](18-pagination-engine-roadmap.md) |
| 做交叉引用 / 站点发布 | [26 交叉引用](26-cross-reference.md) → [28 静态站点](28-site-export.md) |
| 做注释（脚注 / 尾注 / 边注） | [01](01-document-model.md) → [31 注释](31-notes.md) → [02 编辑器与插件](02-editor-and-plugins.md) → [07 EPUB](07-export-epub.md) |
| 做繁简 / 异体字 | [27 文本转换](27-text-conversion.md) |
| 工程维护与发布 | [12 工程化与发布](12-release-and-ci.md) → [16 测试指南](16-testing.md) |
| 排查线上问题 | [14 常见问题与故障排查](14-faq.md) |
| SSR / Node 部署 | [15 SSR 与 Node 同构](15-ssr-and-node.md) → [06 Vue 集成](06-vue-integration.md) |

## 篇目

| 文档 | 内容 | 主要涉及 |
| --- | --- | --- |
| [01 数据模型](01-document-model.md) | IR、节点、标记、元数据、稳定 id | `@bibliotype/core` |
| [02 编辑器与插件](02-editor-and-plugins.md) | 编辑规格、IR ⇄ PM 转换、命令、插件系统 | `core` / `editor` |
| [03 古籍排版](03-classical-layout.md) | 古籍节点、标记、主题、编辑命令 | `@bibliotype/classical` |
| [04 阅读器与分页](04-reader-and-pagination.md) | 块抽取、贪心分页、目录、搜索、页码 | `reader` / `layout` |
| [05 版式与 HTML](05-layout-and-html.md) | 布局选项、样式构建、HTML 序列化 | `@bibliotype/layout` |
| [06 Vue 集成](06-vue-integration.md) | 组合式 API、组件、图片 / 长图导出 | `@bibliotype/vue` |
| [07 EPUB 导出](07-export-epub.md) | 章节规划、OPF/nav、打包、字体内嵌与子集化 | `@bibliotype/exporter-epub` / `@bibliotype/fonts` |
| [08 PDF 与打印](08-export-pdf.md) | 打印 CSS、预分页、对页 / 出血 / 裁切线、图片 DPI 与 CMYK 提示 | `@bibliotype/exporter-pdf` |
| [09 协同编辑](09-collab.md) | Y.Doc 映射、会话、Provider、网络传输 | `@bibliotype/collab` / `provider-websocket` |
| [10 存储适配器](10-storage-adapters.md) | StorageAdapter 契约与实现 | `adapter-indexeddb` / `adapter-sqlite` |
| [11 主题与令牌](11-theme-tokens.md) | 令牌体系、古典覆盖、自定义主题 | `core` / `classical` / `layout` |
| [12 工程化与发布](12-release-and-ci.md) | 日期版本、Changesets、CI、npm 发布 | 全仓 |
| [13 核心运行时](13-core-runtime.md) | 事件总线、节点注册、核心实例 | `@bibliotype/core` |
| [14 常见问题与故障排查](14-faq.md) | 经典问题排查路径（注文样式 / 点击跳转 / 样式作用域 / Node 环境） | 全仓 |
| [15 SSR 与 Node 同构](15-ssr-and-node.md) | 各模块环境要求对照与替代方案 | 全仓 |
| [16 测试指南](16-testing.md) | 测试组织、vitest 运行、环境注入 | 全仓 |
| [17 文档导入](17-document-import.md) | Markdown / HTML / TXT / docx / epub → BookDocument | `import` / `import-docx` / `import-epub` |
| [18 纸书排版引擎路线图](18-pagination-engine-roadmap.md) | 行级拆分 / 孤寡行 / 预览编辑同源的阶段计划与引擎调研 | `layout` / `reader` / `vue` |
| [19 编辑工具条使用说明](19-editor-toolbar-usage.md) | 44 个按钮的前提 / 落点 / 命令 / 限制，说明分层的归属约定与「点了没反应」速查 | `apps/demo` / `editor` / `classical` |
| [20 选区替换为](20-selection-replace.md) | 选中文字转换为双行注 / 眉批 / 夹注等容器；浮动菜单、文本前后切分、id 去重、边界与降级 | `editor` / `classical` / `vue` / `apps/demo` |
| [21 表格编辑](21-table-editing.md) | Word / WPS 式行列网格插入、语义 DOM、表格整体成块、直排支持与限制 | `editor` / `reader` / `layout` / `vue` / `apps/demo` |
| [22 古籍仿真直排](22-facsimile-vertical.md) | 版框 / 界行 / 版心（书口）与六种古籍版式模板；与「古籍直排」并列的隔离设计 | `layout` / `reader` / `vue` / `exporter-pdf` / `apps/demo` |
| [23 IR 校验、迁移与锚点](23-ir-validation-and-migration.md) | 锚点契约、结构校验、schemaVersion 逐级迁移 | `@bibliotype/core` |
| [24 标注](24-annotation.md) | 高亮 / 书签 / 笔记 / 评论模型、容器、持久化与孤儿处理 | `@bibliotype/annotation` |
| [25 中文排印](25-cjk-typography.md) | 禁则避头尾、标点挤压、中西文混排间距、CSS 声明 | `@bibliotype/typography-cjk` |
| [26 交叉引用](26-cross-reference.md) | 两遍排版页码索引、「参见第 X 页」占位替换与标签登记 | `@bibliotype/xref` |
| [27 文本转换](27-text-conversion.md) | 繁简 / 异体字转换、命中记录、OpenCC 接入、反向表 | `@bibliotype/textconvert` |
| [28 静态站点导出](28-site-export.md) | 目录页 + 分节页 + 样式 + 搜索索引 + 字体，纯函数导出 | `@bibliotype/exporter-site` / `@bibliotype/fonts` |
| [29 远端存储适配器](29-adapter-http.md) | REST 文档 / 资产端点契约、错误语义、fetch 注入 | `@bibliotype/adapter-http` |
| [30 文档统计与词表检查](30-document-stats.md) | 字数 / 词数 / 阅读时长 / 章节分布、错别字与敏感词检查 | `@bibliotype/core` |
| [31 注释](31-notes.md) | 脚注 / 尾注 / 边注的类型归属、注码与编号、插入命令、`epub:type` 输出 | `core` / `editor` / `layout` / `exporter-epub` |
| [32 DOCX 导出](32-export-docx.md) | IR → `.docx`：标题层级 / 命名样式 / 脚注 / 表格 / 图片，降级问题码与 mammoth 往返校验 | `@bibliotype/exporter-docx` |
| [33 Electron 宿主接入](33-electron-host.md) | host 适配层端口、复制同步模型、`bibliotype:sql-*` IPC 契约、样式设置落 SQLite、导出通道 | `apps/demo` / `adapter-sqlite` |

## 架构总览

```text
apps/demo                          ← 集成示例（Vue 3 + Vite；src/host 隔离 Web / Electron 差异）
 └── @bibliotype/vue               ← 组合式 API 与组件
      ├── @bibliotype/reader       ← 阅读状态机（分页 / 目录 / 搜索）
      │    └── @bibliotype/layout  ← 分页器 / 样式构建 / HTML 序列化
      ├── @bibliotype/editor       ← ProseMirror 编辑核心
      └── @bibliotype/core         ← IR 数据模型 / 插件 / 主题 / 存储契约

库与扩展（平行接入）
 ├── @bibliotype/classical         ← 古籍节点 / 主题 / 编辑命令（插件 + ./editor 子入口）
 ├── @bibliotype/collab            ← 协同（IR ⇄ Y.Doc）
 ├── @bibliotype/provider-websocket ← 协同传输（WebSocket / 多标签 + 参考服务端）
 ├── @bibliotype/adapter-indexeddb ← 存储实现（IndexedDB / 内存）
 ├── @bibliotype/adapter-sqlite    ← 存储实现（SQLite，驱动由宿主注入）
 ├── @bibliotype/adapter-http      ← 存储实现（远端 REST + 资产）
 ├── @bibliotype/annotation        ← 标注（高亮 / 书签 / 笔记 / 评论，基于 core 锚点）
 ├── @bibliotype/typography-cjk    ← 中文排印（禁则 / 挤压 / 混排，零依赖）
 ├── @bibliotype/xref              ← 交叉引用（两遍排版页码索引）
 ├── @bibliotype/textconvert       ← 繁简 / 异体字转换
 ├── @bibliotype/exporter-epub / exporter-pdf ← 导出（依赖 core / layout / reader）
 ├── @bibliotype/exporter-docx      ← DOCX 导出（依赖 core）
 └── @bibliotype/exporter-site     ← 静态站点导出（依赖 core / layout）
```

核心数据流（编辑与阅读共用一条链路）：

```text
BookDocument（IR）
   ├─编辑：irNodeToPm → ProseMirror EditorState → 事务 → pmNodeToIr → BookDocument
   └─阅读：extractBlocks → 分块 → paginate → 分页 → serializeNode → HTML 渲染
                                    （导出器复用同一序列化）
```

## 术语与决策索引

文档中的「（D3）」「（D8）」等编号为立项决策日志（D1–D9），完整记录见根目录
[`调研方案清单.md`](../调研方案清单.md) 的「零、已确认决策」；当前 D3 在
[05 版式与 HTML](05-layout-and-html.md)、D8 在 [02 编辑器与插件](02-editor-and-plugins.md)
中以编号形式引用。

| 编号 | 决策摘要 |
| --- | --- |
| D1 | 包含编辑器，编辑器为核心模块之一 |
| D2 | 首要目标用户：学术机构 + 普通读者（双客群并行） |
| D3 | 不需要多语言（主体中文，含繁简），允许中英文数字混排 |
| D4 | 不规划配套后端，存储方式保持中立 |
| D5 | 包结构采用 monorepo 多包（插件包组） |
| D6 | 需要协同校勘，IR CRDT 化，选型 Yjs |
| D7 | 不单独提供编辑器桌面端封装（Electron 与 Web 一致，经 npm 引入） |
| D8 | 古籍专有节点定义放 classical，editor 仅提供注册 API |
| D9 | 本地存储主要面向 Electron（SQLite）；Web 默认 IndexedDB，删除 File System Access 适配器 |
