# @bibliotype/annotation

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
- P0 能力接线批次（B5 / C4 / C6 / C9 / D2 / D4 / E9）：
  
  - **B5 页底注区渲染**：`serializePageNotes` + `.bt-page-notes` / `.bt-note-continued` 样式，`PaginatedPage.notesCarried` / `Reader.isPageNotesContinued`，`BtBookView` 输出注区槽（续前页标记、超限告警，不裁剪）。
  - **C4 表格合并 / 拆分**：`mergeCells` / `splitCell`（矩形校验、跨表头冲突拒绝、非矩形不派发事务；拆分补齐空单元格）。
  - **C6 / D2 标注**：`core` 新增 `ExportComment` 契约；`annotationsToMarkdown`；`useAnnotations` + `BtAnnotationSidebar`（书签 / 高亮 / 笔记 / 评论四 tab）；`includeComments`（EPUB / 站点，缺省 false）。
  - **C9 统计**：`useDocumentStats`（300ms 防抖）+ `BtDocumentStats`（字数 / 块数 / 阅读时长 / 注释数 + 章节分布，纯 CSS 条形）。
  - **D4 手势与键盘**：`BtBookView` 新增 `fontSize` / `update:fontSize` 双指缩放（12–32px），scroll 模式可聚焦并支持 PageUp / PageDown / 空格 / Home / End 滚屏。
  - **E9 校验 CLI**：`runValidateCli` + `bt-validate-epub`（`--json` / `--help`，退出码 0/1/2），CI 增加合法样本与损坏文件校验步骤。
  - **依赖**：新增合法方向 `vue → annotation → core`；导出器只消费 `ExportComment`，不依赖 `annotation`。
- P2 能力批次（H3 书架 / H4 备份 / H5 加密 / C5 修订 / C7 历史）：
  
  - **H3 书架**：`DocumentSummary` 追加可选字段（`author` / `isbn` / `tags` / `coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`），旧记录经 `mergeDocumentSummary` 回退；新增可选端口 `BookLibraryStore`（`query`）与 `BookSummaryStore`（`updateSummary`），`StorageAdapter` 必选方法不变；`.btbook` 单书档（`packBookArchive` / `unpackBookArchive`，ZIP 经 `BookPackCodec` 端口由宿主注入）；`BtBookShelf` + `useBookLibrary`。
  - **H4 备份**：`buildLibraryBackupFiles` / `restoreLibrary`（`merge` / `overwrite` / `keep-both` 三策略、逐书校验、进度回调、失败清单不中断整批）；`BtBackupPanel`。
  - **H5 加密**：`deriveKeyPbkdf2` / `createStringCipher` / `createByteCipher`、存储与资产加密装饰器、注记独立密钥（`createEncryptedAnnotationStorage`）、导出脱敏（`redactDocument` / `redactAnnotations`）；`CryptoError` 稳定错误码，禁止静默降级为明文；`BtEncryptionPanel`。
  - **C5 修订**：新增 `insertion` / `deletion` / `format-change` 标记与 `createRevisionTrackingPlugin`（删除内容保留，拒绝可无损还原）；`acceptRevision` / `rejectRevision` / 全部接受拒绝、`setRevisionMode` / `setRevisionView` / `setRevisionAuthor`；序列化新增 `revisionView`（`marked` / `final` / `original`），EPUB / PDF / 站点导出缺省终稿；`BtRevisionSidebar`。
  - **C7 历史版本**：`createSnapshot` / `restoreSnapshot`（校验和 + `validateDocument` 双检）、`diffDocuments`（节点级 LCS + 字符级内联 diff）、保留策略；`DocumentVersionStore` 端口与 `IndexedDbVersionStore` / `MemoryVersionStore`；`BtVersionHistory`。
  - **兼容性**：三个适配器共用 `storage-contract.ts` 公共契约套件；HTTP 适配器的 `query` 在客户端过滤，不新增服务端端点，且不实现 `BookSummaryStore`。
  - **依赖**：生产依赖零新增；demo 的 `.btbook` codec 为仓库内零依赖 STORE 实现，未引入压缩库。
