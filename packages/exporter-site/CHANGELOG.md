# @bibliotype/exporter-site

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
- P4 批 6（E3）：新增字体内核包 `@bibliotype/fonts`，EPUB / 站点导出支持内嵌子集字体。
  
  - **用字统计**：`collectDocumentChars(document)` 遍历 IR 文本节点（含 ruby / 标题 / 注文，过滤控制符、保留空白与标点），输出去重升序字符集 `chars` 与逐字 `counts`；80 万字文档只保留唯一字（测试：8 字）。
  - **可插拔子集后端**：`prepareFontBundle(document, fonts, { backend })`（异步，后端可为 wasm / 子进程，如 `subset-font` / `fonttools`），本包不内置字体解析二进制；未提供后端时按原始字节嵌入并告警。后端抛错或返回空字节抛 `FONT_SUBSET_FAILED`（新错误码，含 `fontId` / `family` / `backend` 与根因）。
  - **@font-face 与命名**：按格式嗅探（woff2 / woff / otf / ttf）与内容哈希生成确定性文件名 `bt-<family>-<weight><i>-<hash8>.<ext>`，`font-display` 可配，产物 `FontBundle{ faces, css, licensePath, license, rights, report, warnings }`。
  - **缺字回退**：后端可返回 `missingChars`，告警按主题字体栈给出降级链（与 K6 同口径）；未返回时标记「覆盖信息不完整」，不假阴性。
  - **体积与许可**：覆盖报告含 `sourceBytes / subsetBytes / reduction`（80 万字测试下降 ≥60%）；许可写入 `fonts/LICENSE.txt`，简短版权行写入 OPF `dc:rights`。
  - **exporter-epub**：新选项 `fonts?: FontBundle` —— `@font-face` 前置到 `style.css`，字体字节写入 `OEBPS/fonts/`，manifest 登记 `font-N` / `font-license`，告警以 `FONT-REPORT` 经 `onValidation` 报告（`validate: false` 仍报告）；EPUB 2 路径同样支持。
  - **exporter-site**：新选项 `fonts?: FontBundle`，`SiteFile` 新增可选 `data: Uint8Array`（字体二进制，`text` 为空串），`@font-face` 前置到站点 `style.css`，告警并入 `SiteExportResult.warnings`。
  - **测试**：`@bibliotype/fonts` 21 例（统计 / 体积 / 缺字回退 / 许可 / 确定性 / 错误）、`exporter-epub` 5 例、`exporter-site` 4 例；`docs/07`、`docs/28` 已回写。

### Patch Changes

- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
