# 12 工程化与发布

> 涉及：全仓（根配置 / scripts / CI）　·　相关：根 [README](../README.md)、[.changeset/README.md](../.changeset/README.md)

本篇是工程化蓝本：仓库结构、日期版本策略、发布流程、CI 配置与扩展步骤。

## 仓库结构

```text
bibliotype/
 ├── packages/*        21 个公开包（@bibliotype/*，全部发布）
 ├── apps/demo         示例应用（private，不发布）
 ├── scripts/version.mjs   日期版本脚本（发版核心）
 ├── .changeset/       变更说明（config.json + 待消费的 md）
 ├── .github/workflows/    GitHub Actions（ci.yml / release.yml / pages.yml）
 ├── .gitlab-ci.yml        GitLab CI（备用）
 ├── docs/             功能用法参考（本篇所在）
 └── turbo.json        turbo 任务编排（build / test / typecheck）
```

工具链：pnpm@9.15.0（`packageManager` 固定）+ turbo + Node ≥ 18。

其他常用脚本：`pnpm dev`（全仓 watch 构建）/ `pnpm clean`（清理各包构建产物）/
`pnpm changeset:status`（查看待发布变更概览）。

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
pnpm release:check             # 预检：版本一致性断言 + 构建 + publish --dry-run（不真正发布）
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
   frontmatter 包名兼容单双引号（`@changesets/cli` 对 scoped 包输出单引号形式）；
2. 计算版本号：`YY.M.D`；rc 通道为 `YY.M.D-rc.N`（同日自动递增）；
3. 全部公开包统一升级到该版本（private 包跳过），并把版本号**写回
   `packages/core/src/version.ts` 的 `VERSION` 常量**（I6：单源自动化，无需手工同步）；
4. 为变更说明涉及的包写 CHANGELOG（按 Major/Minor/Patch 分组），
   其余包写「随版本列车同步发布」占位；已存在 CHANGELOG 时前插新节；
5. 删除已消费的变更说明文件；
6. 输出 `RELEASE_VERSION=<版本>` 行，供 CI 提取。

退出码：`0` 成功 / `1` 参数或状态错误 / `2` 无待发布变更。
`--dry-run` 只打印计划不写文件（含 `RELEASE_VERSION=` 行）；`--base` 可指定
基准日期（补发 / 对齐用）。

### .changeset 配置要点

`fixed` 组包含全部 21 个公开包（与版本列车对齐）；`access: public`；
`baseBranch: master`；`privatePackages.version/tag: false`（apps/demo 不参与）。

### 版本一致性校验（check-version.mjs，I6）

`scripts/check-version.mjs` 在 `release:check` 前置执行，校验两条不变式：

1. **版本列车一致**：全部公开包（非 private）`package.json` 的 version 相同（以
   `@bibliotype/core` 为锚）；
2. **`VERSION` 常量对账**：`packages/core/src/version.ts` 的 `VERSION` 与
   `packages/core/package.json` 的 version 一致（`version.mjs` 发版时自动写回）。

不一致时非 0 退出并指出漂移文件；一致性由 `packages/core/src/__tests__/version-sync.test.ts`
守护（对账、列车一致、写回幂等、漂移负例）。

### 发版后检查清单

- **`VERSION` 常量无需手工同步**：`version.mjs` 在写各包 `package.json` 的同时
  自动写回 `packages/core/src/version.ts`（I6）；
- 抽查任一包的 `package.json` 与 `CHANGELOG.md`，确认新版本号与变更说明已落盘；
- 确认已消费的 `.changeset/*.md` 已被删除（`git status` 中仅剩版本与 CHANGELOG 改动）。

## CI

### GitHub Actions（主）

`.github/workflows/ci.yml`：push `master` / PR 触发，`pnpm install --frozen-lockfile`
→ `build` → `test:coverage`（全量测试 + 覆盖率采集，core / layout / reader 阈值拦截，
lcov 报告归档为 artifact）→ `typecheck`。**Node 20/22 双版本矩阵**（`fail-fast: false`，
I9），并保留 E9 的 EPUB 校验 CLI 护栏步骤。

`.github/workflows/release.yml`：`workflow_dispatch` 手动触发，输入 `channel`（rc / latest）：

```text
安装 → 构建 → 测试
  → node scripts/version.mjs --channel <channel>（捕获 RELEASE_VERSION）
  → pnpm -r publish --tag <channel> --no-git-checks --access public
  → git commit "chore(release): v<version>" + tag v<version> + push --follow-tags
```

所需配置：仓库 Secret `NPM_TOKEN`（npm 发布令牌）；workflow 已开 `id-token: write`
以支持 npm provenance。

#### Demo 部署（GitHub Pages）

`.github/workflows/pages.yml`：把 `apps/demo` 的构建产物发布为 GitHub Pages 站点。

触发条件（满足其一）：

- push `master`，且改动命中 `apps/demo/**`、`packages/**`、根 `package.json` /
  `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `tsconfig.base.json` / `turbo.json`
  （纯文档提交不触发，避免重复部署）；
- `workflow_dispatch` 手动重发。

流程：计算基址 → `pnpm install --frozen-lockfile` → `pnpm build`（全仓，demo 消费各包
`dist`）→ 校验 `apps/demo/dist/index.html` → `actions/upload-pages-artifact` →
`actions/deploy-pages`（`pages` 环境，`concurrency: pages` 串行且不取消进行中的部署）。

基址处理：Vite 的 `base` 读环境变量 `VITE_BASE_PATH`（`apps/demo/vite.config.ts`，默认 `/`）。
仓库名为 `<owner>.github.io` 时为 `/`，否则为 `/<repo>/`——项目页的绝对路径资源若缺前缀会 404。
该变量已登记在 `turbo.json` 的 `build.env`（同时用于缓存键），换基址不会命中旧缓存。

Pages 开通需**手动配置一次**：**Settings → Pages → Build and deployment → Source =
GitHub Actions**。创建 Pages 站点属管理类操作，要求 Administration 权限，而 `GITHUB_TOKEN`
不具备（`configure-pages` 的 `enablement: true` 会报 `Resource not accessible by integration`），
故流水线不做自动开通，改为在 `configure-pages` 之前用 `gh api` 检查站点是否存在；
未启用时以中文错误提示直接失败，避免 404 噪音。
无需 `gh-pages` 分支，也不用手写密钥（`pages: write` + `id-token: write` 由 workflow 自带）。
站点地址为 `https://<owner>.github.io/<repo>/`。

本地复现站点产物：

```bash
# 模拟项目页基址（Windows PowerShell 用 $env:VITE_BASE_PATH='/<repo>/'）
VITE_BASE_PATH=/<repo>/ pnpm build
# 预览同样带基址（preview 按 base 挂载路径），地址 http://localhost:4173/<repo>/
VITE_BASE_PATH=/<repo>/ pnpm --dir apps/demo preview
```

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
| 发布前自查 | `pnpm release:check`（版本一致性断言 + 构建 + publish --dry-run 全量预检） |
| 发版后 `VERSION` 常量与实际版本不一致 | 正常由 `version.mjs` 自动写回；若被手工改动，运行 `pnpm release:check` 会失败，重新执行 `pnpm version:rc` / `version:latest` 即可对齐 |

## 相关

- 根 README 快速开始与包一览：[README](../README.md)
- Changesets 工作流速查：[.changeset/README.md](../.changeset/README.md)

## 体积预算护栏（I3）

根 `.size-limit.json` 登记四个核心包的 gzip 阈值（`pnpm size` 本地执行，CI 在
build 后跑 `pnpm size` 门禁；超限失败并指出包名与超出量）：

| 配置项 | 阈值 | 交付时基线（gzip，含依赖） |
| --- | --- | --- |
| `@bibliotype/core` | 32 KB（最严档） | 29.87 KB |
| `@bibliotype/layout` | 13 KB | 11.71 KB |
| `@bibliotype/editor` | 54 KB | 50.61 KB |
| `@bibliotype/vue` | 165 KB | 154.31 KB |

约定：

- 有意扩容（新增功能带来合理增量）时**随功能提交一并上调阈值**，并在 changeset
  描述中说明增量来源；
- 阈值按基线上浮约 7–11% 设定，兼顾正常迭代与拦截意外膨胀；
- `size-limit` 固定在 v11（v14 起要求 Node ≥ 22，本仓库 CI 矩阵含 Node 20）。

## EPUB 校验护栏（E9）

CI 在 `pnpm build` 后执行 `packages/exporter-epub/bin/bt-validate-epub.mjs`：先用 `exportEpub` 生成样本并期望退出 0，再对非 ZIP 文件期望非 0（步骤失败即中断）。本地等价命令：

```bash
cd packages/exporter-epub
node bin/bt-validate-epub.mjs <file.epub> [--json]
```

`@bibliotype/exporter-epub` 的 `bin` 字段随 `files: ["dist", "bin"]` 一起发布。
