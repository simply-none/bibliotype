# Changesets 变更说明目录

本目录存放「变更说明（changeset）」文件：每次功能 / 修复完成后，以 markdown 记录
「改了哪些包、变更级别、写了什么」，随代码一起提交。发布时由 [scripts/version.mjs](../scripts/version.mjs)
消费，生成**日期版本号**（如 `26.10.12`、`26.10.12-rc.1`）与各包 `CHANGELOG.md`。

## 日常工作流

1. 完成改动后创建变更说明：

   ```bash
   pnpm changeset          # 交互式：勾选包与级别，填写说明（或手动新建 *.md，格式见下）
   ```

2. 变更说明与代码一起提交入库。

3. 发布时（维护者操作，本机手动）：

   ```bash
   pnpm version:rc         # 或 pnpm version:latest —— 只给变更包应用日期版本（更新 CHANGELOG、删除已消费的变更说明）
   pnpm release:rc         # 或 pnpm release —— 构建并批量发布待发清单里的包到 npm
   ```

   首次发布用 `pnpm version:rc:all`；rc 转正式版用 `pnpm version:latest:reuse`。

## 文件格式

```md
---
"@bibliotype/core": minor
"@bibliotype/reader": patch
---

一句话说明本次改动（会写入对应包的 CHANGELOG）。
```

- 级别（major / minor / patch）仅作语义参考：本项目按**增量发布日期版本**发布，
  只有被变更说明覆盖的公开包才升版、才发布，未变更包版本保持不变；三个级别都映射到
  同一个日期版本号（如 `26.10.12`）；
- 私有包（`apps/demo`、`e2e`）的条目会被 `version.mjs` 跳过并打印，不中止发布；
- 完整发布流程与 CI 说明见 [docs/12-release-and-ci.md](../docs/12-release-and-ci.md)。

> ⚠️ 本项目**不使用** `changeset version` / `changeset publish`（版本号须为日期形式），
> 仅用 `pnpm changeset` 生成变更说明；版本化与发布分别由 `scripts/version.mjs` 与 `pnpm release:*` 完成。
