# @bibliotype/xref

## 26.10.25-rc.1

### Minor Changes

- 《能力扩展清单》第一批落地：补齐「位置 / 标注 / 精排 / 引用 / 分发」五块底座。
  
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
- P1-B2b：K4 索引 / K5 印章与版心 / K2 校勘对照。
  
  - **core**：新增 `index-term` 行内标记（`term` / `sortKey`），IR 版本升至 `0.3.0`（空迁移）；`collectIndexTerms` / `buildIndexEntries`（页码去重、连续页合并区间、拼音或显式排序）/ `buildIndexAppendix`（书末索引附录节点）。
  - **editor**：`toggleIndexTerm` 命令（选中文本为缺省词条）。
  - **layout**：`renderSealSvg` 确定性 SVG 印谱（朱文 / 白文、方印回文 / 竖排、边框粗细），`seal` 序列化输出内联 SVG（可关闭退化为文字印章）；仿真模板各自声明版心字段序列，`PageGutterTexts` 增 `volumeTitle`，鱼尾按字段分段定位。
  - **reader**：卷次自动推导（`resolveVolumeTitleForNode`），页眉 / 版心支持 `volumeTitle` 字段。
  - **classical**：校勘 `collation-mark` 增 `pairId` / `role`、`collation-note` 增 `pairId` / `marker`；`insertCollationNote` 自动取号、`renumberCollationNotes` 一键重排、`pairCollation` / `unpairCollation` 配对与解绑；`buildCollationSummary` 生成校勘汇总表附录。
  - **vue**：新增 `BtCollationCompare` 对照组件（底本 / 校本并排、同配对联动高亮）。
  - **exporter-epub**：书末自动追加索引章（可关闭）；新增 `appendices` 选项，`#id` 锚点自动改写为跨文件地址；EPUB 2 印章退化为文字印章。
