# @bibliotype/adapter-indexeddb

## 26.10.25-rc.1

### Minor Changes

- P2 能力批次（H3 书架 / H4 备份 / H5 加密 / C5 修订 / C7 历史）：
  
  - **H3 书架**：`DocumentSummary` 追加可选字段（`author` / `isbn` / `tags` / `coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`），旧记录经 `mergeDocumentSummary` 回退；新增可选端口 `BookLibraryStore`（`query`）与 `BookSummaryStore`（`updateSummary`），`StorageAdapter` 必选方法不变；`.btbook` 单书档（`packBookArchive` / `unpackBookArchive`，ZIP 经 `BookPackCodec` 端口由宿主注入）；`BtBookShelf` + `useBookLibrary`。
  - **H4 备份**：`buildLibraryBackupFiles` / `restoreLibrary`（`merge` / `overwrite` / `keep-both` 三策略、逐书校验、进度回调、失败清单不中断整批）；`BtBackupPanel`。
  - **H5 加密**：`deriveKeyPbkdf2` / `createStringCipher` / `createByteCipher`、存储与资产加密装饰器、注记独立密钥（`createEncryptedAnnotationStorage`）、导出脱敏（`redactDocument` / `redactAnnotations`）；`CryptoError` 稳定错误码，禁止静默降级为明文；`BtEncryptionPanel`。
  - **C5 修订**：新增 `insertion` / `deletion` / `format-change` 标记与 `createRevisionTrackingPlugin`（删除内容保留，拒绝可无损还原）；`acceptRevision` / `rejectRevision` / 全部接受拒绝、`setRevisionMode` / `setRevisionView` / `setRevisionAuthor`；序列化新增 `revisionView`（`marked` / `final` / `original`），EPUB / PDF / 站点导出缺省终稿；`BtRevisionSidebar`。
  - **C7 历史版本**：`createSnapshot` / `restoreSnapshot`（校验和 + `validateDocument` 双检）、`diffDocuments`（节点级 LCS + 字符级内联 diff）、保留策略；`DocumentVersionStore` 端口与 `IndexedDbVersionStore` / `MemoryVersionStore`；`BtVersionHistory`。
  - **兼容性**：三个适配器共用 `storage-contract.ts` 公共契约套件；HTTP 适配器的 `query` 在客户端过滤，不新增服务端端点，且不实现 `BookSummaryStore`。
  - **依赖**：生产依赖零新增；demo 的 `.btbook` codec 为仓库内零依赖 STORE 实现，未引入压缩库。

### Patch Changes

- P2 收口（G2 网络 Provider / H2 SQLite 适配器）：
  
  - **G2 新增 `@bibliotype/provider-websocket`**：`WebSocketProvider`（join → sync → update 握手、指数退避 + 抖动重连、离线队列 `Y.mergeUpdates` 合并、超限转全量、握手超时与协议版本校验）、`BroadcastProvider`（同源多标签、迟到加入 `hello` / `state`）、协议帧与 8 MiB 上限、`startReferenceServer` 参考服务端（`ws` 为**可选 peer**，客户端入口不依赖）。Awareness（G3）仅留协议扩展位。
  - **H2 新增 `@bibliotype/adapter-sqlite`**：宿主注入驱动（`createBetterSqliteDriver` / `createSqlJsDriver`，包内零引擎依赖），能力对齐 IndexedDB——分片文档、`BookLibraryStore` / `BookSummaryStore` / `AssetStore` / `DocumentVersionStore`、`settings` KV；`PRAGMA user_version` 幂等迁移；保存 / 清理走事务，失败回滚；`clear()` 保留资产与历史，`close()` 不关闭宿主驱动。
  - **`@bibliotype/core`**：新增 `storage/chunking`（分片内核，原 `adapter-indexeddb/chunked-store` 上移）并导出；新增 `@bibliotype/core/testing` 测试子入口（存储契约套件，仅 ESM、external vitest）。
  - **`@bibliotype/adapter-indexeddb`**：分片符号改为从 core 再导出（公开 API 不变），测试改用 `@bibliotype/core/testing` 契约套件。
  - **依赖**：生产依赖零新增；`ws` / `sql.js` 仅 devDependency（`ws` 另为可选 peer）。
  - **发布**：两个新包加入 changeset `fixed` 列车，与其余包同版本发布。
