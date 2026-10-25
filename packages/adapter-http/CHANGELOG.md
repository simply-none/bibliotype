# @bibliotype/adapter-http

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
- P2 能力批次（H3 书架 / H4 备份 / H5 加密 / C5 修订 / C7 历史）：
  
  - **H3 书架**：`DocumentSummary` 追加可选字段（`author` / `isbn` / `tags` / `coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`），旧记录经 `mergeDocumentSummary` 回退；新增可选端口 `BookLibraryStore`（`query`）与 `BookSummaryStore`（`updateSummary`），`StorageAdapter` 必选方法不变；`.btbook` 单书档（`packBookArchive` / `unpackBookArchive`，ZIP 经 `BookPackCodec` 端口由宿主注入）；`BtBookShelf` + `useBookLibrary`。
  - **H4 备份**：`buildLibraryBackupFiles` / `restoreLibrary`（`merge` / `overwrite` / `keep-both` 三策略、逐书校验、进度回调、失败清单不中断整批）；`BtBackupPanel`。
  - **H5 加密**：`deriveKeyPbkdf2` / `createStringCipher` / `createByteCipher`、存储与资产加密装饰器、注记独立密钥（`createEncryptedAnnotationStorage`）、导出脱敏（`redactDocument` / `redactAnnotations`）；`CryptoError` 稳定错误码，禁止静默降级为明文；`BtEncryptionPanel`。
  - **C5 修订**：新增 `insertion` / `deletion` / `format-change` 标记与 `createRevisionTrackingPlugin`（删除内容保留，拒绝可无损还原）；`acceptRevision` / `rejectRevision` / 全部接受拒绝、`setRevisionMode` / `setRevisionView` / `setRevisionAuthor`；序列化新增 `revisionView`（`marked` / `final` / `original`），EPUB / PDF / 站点导出缺省终稿；`BtRevisionSidebar`。
  - **C7 历史版本**：`createSnapshot` / `restoreSnapshot`（校验和 + `validateDocument` 双检）、`diffDocuments`（节点级 LCS + 字符级内联 diff）、保留策略；`DocumentVersionStore` 端口与 `IndexedDbVersionStore` / `MemoryVersionStore`；`BtVersionHistory`。
  - **兼容性**：三个适配器共用 `storage-contract.ts` 公共契约套件；HTTP 适配器的 `query` 在客户端过滤，不新增服务端端点，且不实现 `BookSummaryStore`。
  - **依赖**：生产依赖零新增；demo 的 `.btbook` codec 为仓库内零依赖 STORE 实现，未引入压缩库。

### Patch Changes

- P4 批 2（I8）：统一错误码。core 新增 `BibliotypeError` 基类（稳定 `code` + 结构化 `details` + 中文 `hint` + `cause` 根因链）、`isBibliotypeError()`（instanceof + 跨实例品牌双通道）、`serializeBibliotypeError` / `deserializeBibliotypeError`（JSON 安全往返，cause 链递归还原）与统一错误码表 `BIBLIOTYPE_ERROR_CODES`；`PluginConflictError` / `NodeTypeConflictError` / `MigrationPathError` / `EditorSpecConflictError` / `HttpAdapterError` 改继承基类并新增 code / details / hint（原 `instanceof` 断言、`name`、message 不变），`CryptoError` / `BookPackError` 并入基类且既有稳定码保持原值；错误码表回写 docs/13；测试覆盖 code 稳定 / 序列化往返含 cause 链 / 兼容断言 / 非错误值负例。
