# 12 工程化与发布

> 涉及：全仓（根配置 / scripts / CI）　·　相关：根 [README](../README.md)、[.changeset/README.md](../.changeset/README.md)

本篇是工程化蓝本：仓库结构、日期版本策略、发布流程、CI 配置与扩展步骤。

## 仓库结构

```text
bibliotype/
 ├── packages/*        23 个公开包（@bibliotype/*，全部发布）
 ├── apps/demo         示例应用（private，不发布）
 ├── scripts/version.mjs   日期版本脚本（发版核心）
 ├── scripts/publish.mjs   批量发布脚本（只发待发清单）
 ├── .changeset/       变更说明（config.json + 待消费的 md）
 ├── .release/         待发清单（pending.json，本地生成，不入库）
 ├── .github/workflows/    GitHub Actions（ci.yml / release.yml / pages.yml）
 ├── .gitlab-ci.yml        GitLab CI（备用）
 ├── docs/             功能用法参考（本篇所在）
 └── turbo.json        turbo 任务编排（build / test / typecheck）
```

工具链：pnpm@9.15.0（`packageManager` 固定）+ turbo + Node ≥ 18。

其他常用脚本：`pnpm dev`（全仓 watch 构建）/ `pnpm clean`（清理各包构建产物）/
`pnpm changeset:status`（查看待发布变更概览）。

## 版本策略：增量发布日期版本

版本号为 `YY.M.D`（数字段**不带前导零**，符合 semver）：

| 通道 | 版本示例 | 语义 |
| --- | --- | --- |
| rc | `26.10.12-rc.1` | 预发布；同日重复发布自动递增 `rc.N` |
| latest | `26.10.12` | 正式发布；prerelease < release，rc 可被正式版覆盖升级 |

采用**增量发布**：**只有出现在变更说明里的公开包才升版、才发布**；未变更包的版本号与
npm 上的产物都保持不动，因此各包版本不再同步。包内 `workspace:*` 依赖由 pnpm 在发布时
改写为被依赖包的当前版本，无需手工处理；未变更的包不会重发。

## 发布流程（四步）

```bash
# 1. 变更说明（每个功能 / 修复一条）
pnpm changeset                 # 选择涉及的包与 major/minor/patch，填写描述

# 2. 计算并应用日期版本（只升变更包；写 CHANGELOG / 待发清单、消费变更说明）
pnpm version:rc                # → 26.10.12-rc.1（预发布）
pnpm version:latest            # → 26.10.12（正式；rc 提升见下文 --reuse-pending）

# 3. 提交并打 tag（人工）
git add -A && git commit -m "chore(release): v<版本>" && git tag v<版本>

# 4. 构建并发布到 npm（只发 .release/pending.json 里的包）
pnpm release:check             # 预检：core 版本对账 + 构建 + publish --dry-run（不真正发布）
pnpm release:rc                # 构建 + 发布 rc 标签
pnpm release                  # 构建 + 发布 latest 标签
```

> 本项目**不使用** `changeset version` / `changeset publish`（版本号必须为日期形式），
> Changesets 仅负责收集变更说明；发版由 `scripts/version.mjs` 完成。
> `release:check` 读取 `version:*` 写出的 `.release/pending.json`，必须在版本应用**之后**运行。

### version.mjs 行为

```text
node scripts/version.mjs [--channel rc|latest] [--base YY.M.D] [--dry-run] [--all] [--reuse-pending]
```

1. 读取 `.changeset/*.md`；无待发布变更时**退出码 2**（发布流程应中止）；
   frontmatter 包名兼容单双引号（`@changesets/cli` 对 scoped 包输出单引号形式）；
   私有包（`@bibliotype/demo`、`@bibliotype/e2e`）条目跳过并打印，未知包名仍报错（拼写保护）；
2. 目标包 = 变更说明涉及的公开包；`--all` 改为**全部公开包**（仅首次发布用，保证依赖闭包完整）；
   `--reuse-pending` 改为复用 `.release/pending.json` 的清单；
3. 计算版本号：`YY.M.D`；rc 通道为 `YY.M.D-rc.N`（同日自动递增）；碰撞检查与 `rc.N`
   递增只针对本批目标包；
4. 只为目标包改 `package.json` 并写 CHANGELOG（按 Major/Minor/Patch 分组）；仅当
   `@bibliotype/core` 在目标集合内时写回 `packages/core/src/version.ts` 的 `VERSION`（I6）；
5. 写 `.release/pending.json`（`{ channel, version, packages }`），供 `publish.mjs` 取待发清单；
6. 删除已消费的变更说明文件（`--reuse-pending` 模式不读也不删）；
7. 输出 `RELEASE_VERSION=<版本>` 行，供脚本 / CI 提取。

退出码：`0` 成功 / `1` 参数或状态错误 / `2` 无待发布变更。
`--dry-run` 只打印计划不写文件（含 `RELEASE_VERSION=` 行）；`--base` 可指定
基准日期（补发 / 对齐用）。

### 首次发布与 rc → latest 提升

- **首次发布**：npm 上还没有任何 `@bibliotype/*`，用 `pnpm version:rc:all` 把全部公开包
  统一升到当日版本。`@bibliotype/collab` 没有独立变更说明，但被 `provider-websocket`
  依赖，漏发会让已发布包依赖一个不存在的版本；
- **rc → latest**：rc 阶段已消费掉全部变更说明，直接跑 `version:latest` 会因无变更说明
  退出码 2。改用 `pnpm version:latest:reuse`：复用 `.release/pending.json` 的包清单，只把
  版本号改成正式版，不重复写 CHANGELOG。建议同日完成（跨日会按当日日期生成新版本号）。

### publish.mjs 行为

```text
node scripts/publish.mjs [--tag rc|latest] [--dry-run]
```

1. 读 `.release/pending.json`；缺失时提示先跑 `pnpm version:rc` / `version:latest`；
2. **强制 registry = `https://registry.npmjs.org/`**（本机全局配置可能是镜像站，直接发布
   会发错站）；根目录存在 `.npmrc.publish` 时把它挂成用户级 npmrc（token 存文件、不入库），
   否则使用用户级 `~/.npmrc`；
3. 非 dry-run 先 `npm whoami` 校验 token；再查 registry，**已存在同版本的包自动跳过**
   （中途失败可直接重跑）；
4. 校验待发包的 `@bibliotype/*` 依赖版本在 registry 上存在或本次一起发布，否则拒绝发布；
5. `pnpm -r --filter=<pkg> publish --tag <通道> --no-git-checks --access public`
   （pnpm 按拓扑序发布，core 在前）。

### .changeset 配置要点

不再维护 `fixed` 版本列车组（`fixed: []`）；`access: public`；`baseBranch: master`；
`privatePackages.version/tag: false`（apps/demo 不参与）。

### 版本一致性校验（check-version.mjs，I6）

`scripts/check-version.mjs` 在 `release:check` 前置执行，校验一条不变式：
`packages/core/src/version.ts` 的 `VERSION` 与 `packages/core/package.json` 的 version 一致
（`version.mjs` 发版时自动写回）。各包版本按增量发布各自推进，**不再要求全包同版本**。

不一致时非 0 退出并指出两侧值；一致性由 `packages/core/src/__tests__/version-sync.test.ts`
守护（core 对账、增量目标解析、写回幂等、漂移负例）。

### 发版后检查清单

- **`VERSION` 常量无需手工同步**：core 升版时 `version.mjs` 自动写回 `packages/core/src/version.ts`（I6）；
- 抽查本次升版包的 `package.json` 与 `CHANGELOG.md`，确认新版本号与变更说明已落盘；
- 确认已消费的 `.changeset/*.md` 已被删除（`git status` 中仅剩版本与 CHANGELOG 改动）；
- 确认 `.release/pending.json` 与 `.npmrc.publish` 未入库（均已在 `.gitignore`）。

## CI

### GitHub Actions（主）

`.github/workflows/ci.yml`：push `master` / PR 触发，`pnpm install --frozen-lockfile`
→ `build` → `test:coverage`（全量测试 + 覆盖率采集，core / layout / reader 阈值拦截，
lcov 报告归档为 artifact）→ `typecheck`。**Node 20/22 双版本矩阵**（`fail-fast: false`，
I9），并保留 E9 的 EPUB 校验 CLI 护栏步骤。

另有独立的 `e2e` job（批 4）：`build` → `playwright install --with-deps chromium` →
`pnpm e2e:smoke` → `pnpm e2e:pixel`，失败产物（trace / video / screenshot / html 报告）
`if: always()` 归档；用例分层与基线口径见 [16 测试](16-testing.md#端到端i1--b3) 与
[e2e/README](../e2e/README.md)。注意 e2e 消费 demo 的 `vite preview` 产物，故必须先 build。

`.github/workflows/release.yml`：**当前不启用**。发布走本机手动流程（`pnpm version:*` +
`pnpm release:*`，见上文「发布流程」），GitHub 发布流水线暂不接入。该文件保留如下设计
供后续启用，启用前需先把 `pnpm -r publish` 换成 `node scripts/publish.mjs` 并补
`.release/pending.json` 的产出步骤。

原设计：`workflow_dispatch` 手动触发，输入 `channel`（rc / latest）：

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
3. `.changeset/config.json` 不需要登记包名（`fixed: []`，不存在版本列车组）；
4. 写 README（参考既有包），需要时在 `docs/` 增补用法篇；
5. 后续发版自动参与：`version.mjs` 按非 private 扫描；无变更说明的包不会升版，
   首次发布需用 `--all` 全量带上。

## 常见问题

| 场景 | 处理 |
| --- | --- |
| 首次发布（npm 上还没有包） | `pnpm version:rc:all` → `pnpm release:check` → `pnpm release:rc`（`--all` 保证依赖闭包完整） |
| 只有部分包改了 | 正常 `pnpm changeset` + `pnpm version:rc`，未变更包自动跳过，版本号不动 |
| 同日需要发第二个正式版 | 用 `--channel rc`（`-rc.N` 自动递增），或 `--base` 指定其它基准 |
| `version.mjs` 退出码 2 | `.changeset/*.md` 为空——先 `pnpm changeset`；若 rc 已消费变更说明、要提升为正式版，改用 `pnpm version:latest:reuse` |
| 想先看版本计划 | `pnpm exec node scripts/version.mjs --dry-run`（不写文件） |
| 正式版与 rc 的标签 | rc 发 `--tag rc`，正式发 `--tag latest`（`release:rc` / `release` 已内置） |
| token 放哪 | 项目根 `.npmrc.publish`（已 gitignore），内容是 `//registry.npmjs.org/:_authToken=<token>`；`publish.mjs` 自动挂载。令牌创建与 `@bibliotype` scope 归属见根 [README](../README.md#版本与发布) |
| 鉴权失败（401 / 403 / EOTP） | 先看 token 是否缺失或过期；`403` 多为 scope 归属或令牌未勾 Bypass 2FA。另注意本机 registry 可能是 npmmirror，`publish.mjs` 已强制 `--registry=https://registry.npmjs.org/` |
| 发布中途失败想重跑 | 直接重跑 `pnpm release:rc` / `pnpm release`，registry 上已存在同版本的包自动跳过 |
| `npm ERR! 403 ... already exists` | 该版本已发过；修改代码后重新 `pnpm version:rc` 生成新版本号 |
| 发布前自查 | `pnpm release:check`（core 版本对账 + 构建 + publish --dry-run 全量预检） |
| 发版后 `VERSION` 常量与实际版本不一致 | 正常由 `version.mjs` 自动写回（仅 core 升版时）；若被手工改动，运行 `pnpm release:check` 会失败，重新执行 `pnpm version:rc` / `version:latest` 即可对齐 |

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

## H5 触控与安全区约定（D2 / D3 / D4）

移动端不是另起一套，而是在桌面默认值之上叠加增量规则（`@media` / 运行时分支）：

| 约定 | 落地 |
| --- | --- |
| 断点 | `BT_BREAKPOINTS`（640 / 768 / 1024）与 `--bt-bp-sm\|md\|lg` 同源；H5 一律以 `< 768px` 为界 |
| 触控目标 | `BT_TOUCH_TARGET_MIN = 44` / `--bt-touch-target`；粗指针下用 `min-height` 补足，视觉尺寸不变 |
| 粗指针 | `@media (pointer: coarse)` 只放「触屏专属」调整：禁用 hover 提示、隐藏拖宽把手、放大点击区 |
| 安全区 | `viewport-fit=cover` + `env(safe-area-inset-*)`；抽屉 / 全屏模态 / 底栏在对应边留 `--bt-safe-*` |
| 视口单位 | 用 `100dvh` 而非 `100vh`（移动浏览器地址栏收放会改变 `vh`） |
| 软键盘 | `interactive-widget=resizes-content` + `visualViewport` 补偿（`useKeyboardInset`） |
| 缩放 | viewport 不锁；预览区（`.app__stage`）外由 `use-mobile-zoom-guard` 拦双指与 Safari `gesturestart`，双击缩放由 `body { touch-action: manipulation }` 关掉 |
| 横滚条 | 工具条 / 顶栏窄屏改为单行横滚，隐滚动条，首尾按钮不随滚动滑出（`position: sticky`） |

### viewport meta（demo）

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
```

viewport 保持不锁 `user-scalable` / `maximum-scale`：阅读区的无障碍缩放仍在。菜单 / 设置 /
抽屉这类浮层里的双指放大，改由 `apps/demo/src/composables/use-mobile-zoom-guard.ts` 按命中
区域分流（预览区内放行，交给阅读器自己的双指调字号手势；区外一律 `preventDefault`，含
Safari 私有 `gesturestart`），双击缩放则由 `body { touch-action: manipulation }` 一次性关掉。

### 构建顺序注意

组件库对外暴露的是 `dist`（vite + vite-plugin-dts）。改了 `packages/vue/src` 之后必须
先 `pnpm --filter @bibliotype/vue build`，否则 demo 的 `vue-tsc` 会报「模块没有导出成员」；
新增的断点 / 抽屉 / 锁滚类导出尤其容易踩。

### 测试环境

H5 行为靠语义钩子（aria / `data-*` / 类名）断言，均在 happy-dom 下跑：

```bash
pnpm --filter @bibliotype/vue test    # 断点 / 锁滚 / 抽屉 / 点按分区
pnpm --filter @bibliotype/demo test   # 进度条拖动跳页（组件用 createApp 挂载）
```

demo 的 `vitest.config.ts` 已接入 `@vitejs/plugin-vue`，可直接测 `.vue` 单文件组件；
happy-dom 无布局，需要尺寸的用例自己 mock `getBoundingClientRect()`。

换肤后 e2e 冒烟跑**两档**（`chromium` 1280×900 + `chromium-mobile` iPhone 13 390×664，
后者只 `testMatch` smoke，像素基线仍只出桌面档）；入口差异由 `tests/utils/demo.ts` 的
`clickGlobalAction` 吸收（窄屏先开「更多」sheet）。详见 [e2e/README.md](../e2e/README.md)。

## 界面皮肤与无闪烁初始化（美化 P0–P4）

皮肤属于**宿主（demo）职责**，库侧只多暴露 CSS 变量，因此这类改动不应当触发 `@bibliotype/*` 的 major / minor，
只有确实改了 `packages/*/src` 时才补 changeset（本轮 = `@bibliotype/vue` minor，仅 `BtDrawer` 的六个变量与入场动效）。

| 约定 | 落地 |
| --- | --- |
| 色值唯一源 | `apps/demo/src/styles.css` 的 `[data-skin='…']` 块；组件内不得再写字面色，一律 `var(--ui-*)` |
| 元数据源 | `apps/demo/src/ui-skin.ts` 的 `UI_SKINS`（名称 / `dark` / 预览色）；新增皮肤 = 两份文件各加一条，同键同名 |
| 挂载点 | `data-skin` / `data-density` / `data-motion` / `data-night` 挂 `<html>`（不是 `.app`）：弹层都 Teleport 到 body，只有根上的令牌能穿过传送门 |
| 持久化 | `localStorage['bibliotype-demo:settings']` 内的 `uiSkin` / `uiDensity` / `uiMotion` / `scrollbarStyle`；读回逐字段容错，未知值回落默认，旧快照缺键也不报错 |
| 无闪烁 | `index.html` 头部内联脚本（非 module）在样式生效前写同一批 `data-*` 与 `meta[name=theme-color]`，存储不可用时静默走默认皮肤 |
| 主题色 | `meta[name="theme-color"]` 跟皮肤 `canvas` 色，避免手机上「黑壳 + 白顶栏」裂缝 |

### 滚动条样式（设置 → 其他）

三套古籍风预设由注册表驱动，切换即写 `<html>` 的 `data-scrollbar`，令牌层在
`apps/demo/src/styles/scrollbars.css`，全局滚动容器与包内 `BtBookView` 共用一份观感：

| 预设键 | 名称 | 观感 | 主要令牌 |
| --- | --- | --- | --- |
| `ink`（缺省） | 墨线 | 极细墨色滑块、透明轨槽 | 8px，`color-mix` 跟 `--ui-text` |
| `scroll` | 卷轴 | 檀木轴杆 + 浅褐轨槽内描边 | 12px，`--ui-accent` |
| `bamboo` | 竹简 | 竹色滑块 + 竹节纹理轨槽 | 12px，竖条 0deg / 横条 90deg 重复渐变 |

**Chromium 互斥陷阱**：元素上只要写了 `scrollbar-width` / `scrollbar-color`，同一元素的
`::-webkit-scrollbar-*` 伪元素即整体失效（回退到系统标准滚动条：尺寸只认 thin、两端带三角箭头）。
因此标准属性一律包在 `@supports not selector(::-webkit-scrollbar)` 里（只对 Firefox 生效），
`::-webkit-scrollbar-button` 同时 `display:none` + 宽高 0，防止部分版本留位。
直排窄列（顶栏按钮列 / 工具列 / 状态栏）把宽夹到 `min(var(--bt-scrollbar-size), 6px)`，12px 预设不会把人挤没。

### 两处同改的陷阱

内联脚本不能 `import`，所以合法值白名单（`paper|plain|ink|contrast` / `comfortable|compact` / `auto|off`）
与 `ui-skin.ts` 是**手工同步**关系：改任一边必须同时改 `index.html`，否则首帧会被内联脚本“纠正”回默认皮肤
（表现：刷新时先闪一下默认壳色）。`apps/demo/src/__tests__/ui-skin.test.ts` 只守注册表，测不到这段内联脚本。

### 换肤不许改的 e2e 契约

视觉重构不得重命名选择器与可访问名（`e2e/tests/utils/demo.ts` 靠它们驱动）：
`.toolbar__book strong`、`.panel__field`、`.panel__actions .panel__primary`、`.panel__file-input`、`.panel__status`、
`.bt-pager__status`（文本含「共」，因此 H5 底栏必须保留该读数）；
以及「导入 / 设置 / 编辑 / 保存并预览 / 导出 EPUB / 导出 PDF / 上一页 / 下一页 / 主题名」等名称。
图标一律 `aria-hidden`，可访问名由 `aria-label` 或文本承担，不得把文案换成图标。
