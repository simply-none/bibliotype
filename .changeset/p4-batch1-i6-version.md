---
'@bibliotype/core': patch
---

P4 批 1（I6）：VERSION 单源自动化。`scripts/version.mjs` 发版时把日期版本自动写回 `packages/core/src/version.ts` 的 `VERSION` 常量（消除手工同步）；新增 `scripts/check-version.mjs` 在 `release:check` 前置校验版本列车一致与 `VERSION` 对账（漂移时非 0 退出并指出文件）；修复 changeset frontmatter 单引号包名（`@changesets/cli` 标准输出）解析失败的问题；`version-sync.test.ts` 覆盖对账 / 列车一致 / 写回幂等与漂移负例。
