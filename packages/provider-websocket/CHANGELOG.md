# @bibliotype/provider-websocket

## 26.10.25-rc.1

### Minor Changes

- P2 收口（G2 网络 Provider / H2 SQLite 适配器）：
  
  - **G2 新增 `@bibliotype/provider-websocket`**：`WebSocketProvider`（join → sync → update 握手、指数退避 + 抖动重连、离线队列 `Y.mergeUpdates` 合并、超限转全量、握手超时与协议版本校验）、`BroadcastProvider`（同源多标签、迟到加入 `hello` / `state`）、协议帧与 8 MiB 上限、`startReferenceServer` 参考服务端（`ws` 为**可选 peer**，客户端入口不依赖）。Awareness（G3）仅留协议扩展位。
  - **H2 新增 `@bibliotype/adapter-sqlite`**：宿主注入驱动（`createBetterSqliteDriver` / `createSqlJsDriver`，包内零引擎依赖），能力对齐 IndexedDB——分片文档、`BookLibraryStore` / `BookSummaryStore` / `AssetStore` / `DocumentVersionStore`、`settings` KV；`PRAGMA user_version` 幂等迁移；保存 / 清理走事务，失败回滚；`clear()` 保留资产与历史，`close()` 不关闭宿主驱动。
  - **`@bibliotype/core`**：新增 `storage/chunking`（分片内核，原 `adapter-indexeddb/chunked-store` 上移）并导出；新增 `@bibliotype/core/testing` 测试子入口（存储契约套件，仅 ESM、external vitest）。
  - **`@bibliotype/adapter-indexeddb`**：分片符号改为从 core 再导出（公开 API 不变），测试改用 `@bibliotype/core/testing` 契约套件。
  - **依赖**：生产依赖零新增；`ws` / `sql.js` 仅 devDependency（`ws` 另为可选 peer）。
  - **发布**：两个新包加入 changeset `fixed` 列车，与其余包同版本发布。
