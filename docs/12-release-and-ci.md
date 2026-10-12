# 12 工程化与发布

> 涉及：全仓（根配置 / scripts / CI）　·　相关：根 [README](../README.md)、[.changeset/README.md](../.changeset/README.md)

本篇是工程化蓝本：仓库结构、日期版本策略、发布流程、CI 配置与扩展步骤。

## 仓库结构

```text
bibliotype/
 ├── packages/*        10 个公开包（@bibliotype/*，全部发布）
 ├── apps/demo         示例应用（private，不发布）
 ├── scripts/version.mjs   日期版本脚本（发版核心）
 ├── .changeset/       变更说明（config.json + 待消费的 md）
 ├── .github/workflows/    GitHub Actions（ci.yml / release.yml）
 ├── .gitlab-ci.yml        GitLab CI（备用）
 ├── docs/             功能用法参考（本篇所在）
 └── turbo.json        turbo 任务编排（build / test / typecheck）
```

工具链：pnpm@9.15.0（`packageManager` 固定）+ turbo + Node ≥ 18。

## 版本策略：日期版本

版本号为 `YY.M.D`（数字段**不带前导零**，符合 semver）：

| 通道 | 版本示例 | 语义 |
| --- | --- | --- |
| rc | `26.10.12-rc.1` | 预发布；同日重复发布自动递增 `rc.N` |
| latest | `26.10.12` | 正式发布；prerelease < release，rc 可被正式版覆盖升级 |

采用**统一版本列车**：所有公开包每次发布统一升到同一日期版本，
内部依赖 `workspace:*` 由 pnpm 在发布时改写为实际版本，无需逐包处理依赖传播。

## 发布流程（三步）

```bash
# 1. 变更说明（每个功能 / 修复一条）
pnpm changeset                 # 选择涉及的包与 major/minor/patch，填写描述

# 2. 计算并应用日期版本（自动更新 package.json + CHANGELOG、消费变更说明）
pnpm version:rc                # → 26.10.12-rc.1（预发布）
pnpm version:latest            # → 26.10.12（正式）

# 3. 构建并发布到 npm
pnpm release:check             # 预检：构建 + publish --dry-run（不真正发布）
pnpm release:rc                # 构建 + 发布 rc 标签
pnpm release                  # 构建 + 发布 latest 标签
```

> 本项目**不使用** `changeset version` / `changeset publish`（版本号必须为日期形式），
> Changesets 仅负责收集变更说明；发版由 `scripts/version.mjs` 完成。

### version.mjs 行为

```text
node scripts/version.mjs [--channel rc|latest] [--base YY.M.D] [--dry-run]
```

1. 读取 `.changeset/*.md`；无待发布变更时**退出码 2**（发布流程应中止）；
2. 计算版本号：`YY.M.D`；rc 通道为 `YY.M.D-rc.N`（同日自动递增）；
3. 全部公开包统一升级到该版本（private 包跳过）；
4. 为变更说明涉及的包写 CHANGELOG（按 Major/Minor/Patch 分组），
   其余包写「随版本列车同步发布」占位；已存在 CHANGELOG 时前插新节；
5. 删除已消费的变更说明文件；
6. 输出 `RELEASE_VERSION=<版本>` 行，供 CI 提取。

退出码：`0` 成功 / `1` 参数或状态错误 / `2` 无待发布变更。
`--dry-run` 只打印计划不写文件（含 `RELEASE_VERSION=` 行）；`--base` 可指定
基准日期（补发 / 对齐用）。

### .changeset 配置要点

`fixed` 组包含全部 10 个公开包（与版本列车对齐）；`access: public`；
`baseBranch: master`；`privatePackages.version/tag: false`（apps/demo 不参与）。

### 发版后检查清单

- **同步 `VERSION` 常量**：`packages/core/src/version.ts` 的 `VERSION` 为手写常量
  （供 `import { VERSION } from '@bibliotype/core'` 对外暴露），`version.mjs` **只改写
  各包 `package.json` 与 CHANGELOG，不会更新它**——发版后需手动改为与日期版本一致
  （后续可考虑让 `version.mjs` 自动写入该常量）；
- 抽查任一包的 `package.json` 与 `CHANGELOG.md`，确认新版本号与变更说明已落盘；
- 确认已消费的 `.changeset/*.md` 已被删除（`git status` 中仅剩版本与 CHANGELOG 改动）。

## CI

### GitHub Actions（主）

`.github/workflows/ci.yml`：push `master` / PR 触发，`pnpm install --frozen-lockfile`
→ `build` → `test` → `typecheck`（Node 20 + pnpm 缓存）。

`.github/workflows/release.yml`：`workflow_dispatch` 手动触发，输入 `channel`（rc / latest）：

```text
安装 → 构建 → 测试
  → node scripts/version.mjs --channel <channel>（捕获 RELEASE_VERSION）
  → pnpm -r publish --tag <channel> --no-git-checks --access public
  → git commit "chore(release): v<version>" + tag v<version> + push --follow-tags
```

所需配置：仓库 Secret `NPM_TOKEN`（npm 发布令牌）；workflow 已开 `id-token: write`
以支持 npm provenance。

### GitLab CI（备用）

`.gitlab-ci.yml`：`verify` 阶段（install + build + test + typecheck）随 push /
MR 运行；`release` 阶段为 manual job（同样经 `version.mjs` + `pnpm -r publish`），
在 GitLab 作为主平台或镜像仓库时使用。

## 新增包步骤

1. 在 `packages/` 新建包（`package.json` 含 `files/exports/sideEffects/license` +
   发布元数据：`author/repository.directory/homepage/bugs/publishConfig.access`）；
2. `pnpm-workspace.yaml` 的 `packages/*` 自动覆盖，无需改动；
3. 把包名加入 `.changeset/config.json` 的 `fixed` 组（保持版本列车）；
4. 写 README（参考既有包），需要时在 `docs/` 增补用法篇；
5. 后续发版自动参与（`version.mjs` 按非 private 扫描）。

## 常见问题

| 场景 | 处理 |
| --- | --- |
| 同日需要发第二个正式版 | 用 `--channel rc`（`-rc.N` 自动递增），或 `--base` 指定其它基准 |
| `version.mjs` 退出码 2 | `.changeset/*.md` 为空——先 `pnpm changeset` 创建变更说明 |
| 想先看版本计划 | `pnpm exec node scripts/version.mjs --dry-run`（不写文件） |
| 正式版与 rc 的标签 | rc 发 `--tag rc`，正式发 `--tag latest`（`release:rc` / `release` 已内置） |
| 发布前自查 | `pnpm release:check`（构建 + publish --dry-run 全量预检） |
| 发版后 `VERSION` 常量与实际版本不一致 | `version.mjs` 不同步该常量——手动改 `packages/core/src/version.ts` 的 `VERSION`（见「发版后检查清单」） |

## 相关

- 根 README 快速开始与包一览：[README](../README.md)
- Changesets 工作流速查：[.changeset/README.md](../.changeset/README.md)
