---
'@bibliotype/adapter-sqlite': minor
---

新增 `SQLiteStyleStore`（Electron 宿主接入配套）：

- 实现 core 的 `StyleSettingsStore`：`load` / `save` / `listPresets` / `savePreset` /
  `deletePreset` / `delete` / `clear`，语义与 `@bibliotype/vue` 的 localStorage 实现一致
  （预设按 `createdAt` 降序、同 id 覆盖）；
- 复用既有 `settings` 表做小载荷 KV，**不新增表、不升 `SQLITE_SCHEMA_VERSION`**；
  键沿用 `bt-style:snapshot:<scope>` / `bt-style:presets`；
- `clear()` 只删 `bt-style:*` 键，不影响宿主其它 KV；`close()` 为空操作（连接归宿主）。
