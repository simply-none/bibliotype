# AGENTS.md

## 工作约定

- 每完成一次代码修改（含文档与配置），立即 `git commit` 本次修改：
  - 只提交与本次修改相关的文件（`pnpm-lock.yaml` 等无关变更不自动包含）；
  - 提交信息遵循仓库惯例（`fix(scope): ...` / `feat(scope): ...` 中文描述）；
  - 提交前确保相关包的测试与 typecheck 通过。
