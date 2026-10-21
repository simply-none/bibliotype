---
'@bibliotype/core': patch
'@bibliotype/editor': patch
'@bibliotype/adapter-http': patch
---

P4 批 2（I8）：统一错误码。core 新增 `BibliotypeError` 基类（稳定 `code` + 结构化 `details` + 中文 `hint` + `cause` 根因链）、`isBibliotypeError()`（instanceof + 跨实例品牌双通道）、`serializeBibliotypeError` / `deserializeBibliotypeError`（JSON 安全往返，cause 链递归还原）与统一错误码表 `BIBLIOTYPE_ERROR_CODES`；`PluginConflictError` / `NodeTypeConflictError` / `MigrationPathError` / `EditorSpecConflictError` / `HttpAdapterError` 改继承基类并新增 code / details / hint（原 `instanceof` 断言、`name`、message 不变），`CryptoError` / `BookPackError` 并入基类且既有稳定码保持原值；错误码表回写 docs/13；测试覆盖 code 稳定 / 序列化往返含 cause 链 / 兼容断言 / 非错误值负例。
