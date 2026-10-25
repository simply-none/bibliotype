---
"@bibliotype/core": patch
---

发版脚本改为按变更说明增量升版：只有出现在变更说明中的公开包才升日期版本并发布，未变更包版本保持不变；私有包（demo / e2e）条目跳过不再中止；新增 `--all`（首次全量）与 `--reuse-pending`（rc → latest 提升）两个开关，并输出 `.release/pending.json` 供批量发布脚本使用。
