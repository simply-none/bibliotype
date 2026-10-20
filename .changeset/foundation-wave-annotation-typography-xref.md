---
"@bibliotype/core": minor
"@bibliotype/annotation": minor
"@bibliotype/typography-cjk": minor
"@bibliotype/xref": minor
"@bibliotype/textconvert": minor
"@bibliotype/adapter-http": minor
"@bibliotype/exporter-site": minor
---

《能力扩展清单》第一批落地：补齐「位置 / 标注 / 精排 / 引用 / 分发」五块底座。

- `core`：新增锚点契约（`Anchor` / `serializeAnchor` / `resolveAnchor` / `nodePlainText` /
  `locateNode`）、IR 结构校验（`validateDocument` + `DOCUMENT_ISSUE_CODES`）、
  schemaVersion 逐级迁移（`migrateDocument` / `MigrationStep` / `MigrationPathError`）、
  资产存储端口（`AssetStore` / `AssetPayload` / `AssetRef` / `ASSET_KINDS` /
  `toAssetRef` / `hashAssetBytes` / `isAssetStore`）。
- 新增 `@bibliotype/annotation`：高亮 / 书签 / 笔记 / 评论模型（共用一套结构 + 锚点定位），
  `AnnotationStore` 容器（读写 / 过滤 / 订阅 / hydrate / persist）、确定性序列化与孤儿解析。
- 新增 `@bibliotype/typography-cjk`：禁则避头尾（含 zh-Hans / zh-Hant / ja 三套配置）、
  标点挤压、中西文混排间距与 CSS 声明输出，全部纯函数、零依赖。
- 新增 `@bibliotype/xref`：两遍排版页码索引（`buildPageIndex`）、
  `{{page:id}}` / `{{ref:label}}` 占位替换与交叉引用登记表。
- 新增 `@bibliotype/textconvert`：繁简 / 异体字转换（内置常用字表 + 词组保护 +
  OpenCC 适配 + 歧义安全的反向表）。
- 新增 `@bibliotype/adapter-http`：远端 REST 存储适配器（文档 + 资产双端口、
  错误语义明确、fetch 可注入）。
- 新增 `@bibliotype/exporter-site`：静态站点导出（目录页 + 分节页 + 样式 +
  搜索索引 + IR 原文，纯函数、输出确定）。
- 文档：新增 docs/23～29 七篇；根 README、docs 索引、core README 与开发规范依赖矩阵同步。
