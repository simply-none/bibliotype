# 贡献指南

感谢参与 bibliotype（Web 端书籍级排版 / 编辑 / 阅读框架）。本仓库为 pnpm monorepo；
以下约定取自现行工程实践与 CI 配置。

## 环境与常用命令

- Node ≥ 18；pnpm ≥ 9（仓库以 `packageManager: pnpm@9.15.0` 固定版本）；
- 根目录脚本（`pnpm <script>`）：

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm build` | 全仓构建（turbo，按依赖拓扑序） |
| `pnpm test` | 全仓测试（vitest；先构建上游包） |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm dev` | 全仓 watch 构建 |
| `pnpm clean` | 清理各包构建产物 |

## 开发流程

1. 改动涉及包行为的，先补 / 改对应包 `src/__tests__/` 下的测试（组织与命令见 [docs/16 测试指南](docs/16-testing.md)）；
2. 本地至少通过 `pnpm --filter <包名> test` 与 `pnpm typecheck`；跨包影响时跑全量 `pnpm test`（如 core 新增节点类型必须同步 editor 规格表，见 [docs/14 FAQ](docs/14-faq.md) 第 5 条）；
3. 面向用户的改动需附**变更说明**：`pnpm changeset`（增量发布，只升变更说明涉及的公开包，未变更包版本不动）；
4. 发版流程与发版后检查清单见 [docs/12 工程化与发布](docs/12-release-and-ci.md)；新增包步骤同篇。

## 提交信息

采用 Conventional Commits；scope 用包名（多包逗号分隔），主题一行概括，要点放正文：

```text
fix(reader,layout): 修复编辑保存并预览后古籍注文样式丢失——版式文本容器恒为原子叶块

- packages/reader：extractBlocks 将版式文本容器视为原子叶块
- packages/layout：序列化保留容器包裹与样式
- docs：同步叶块规则说明
```

常用类型：`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `ci`。

## 文档维护

文档分两层，改动需同步：

- 顶层 [`docs/`](docs/README.md)：跨包的功能参考（01–16 篇），篇目表与阅读路线在 [docs/README](docs/README.md)；
- 包内 `packages/*/README.md`：包级 API 速查；

新增 / 重命名顶层文档时，同步三处索引：`docs/README.md` 的篇目表与阅读路线、根 `README.md` 的文档表。

## 相关

- 工程化与发布：[docs/12](docs/12-release-and-ci.md)
- 测试指南：[docs/16](docs/16-testing.md)
- 常见问题：[docs/14](docs/14-faq.md)
