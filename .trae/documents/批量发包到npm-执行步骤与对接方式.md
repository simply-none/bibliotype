# 按变更集增量发布到 npm（本机手动）

> 目标：把 `@bibliotype/*` 发布到 npm，且**只有出现变更说明的包才升版、才发布**；未变更包
> 版本号与 npm 上的产物一概不动。发布走本机命令，token 存 npmrc 文件；**本轮不做 GitHub CI 发布**。

## 一、现状与四个关键发现（均已实测）

| # | 事实 | 影响 |
| --- | --- | --- |
| 1 | 现有脚本是「统一版本列车」：[version.mjs](file:///c:/cod/note_npm/scripts/version.mjs#L253-L268) 把全部公开包升到同一版本、给所有包写 CHANGELOG 占位，[check-version.mjs](file:///c:/cod/note_npm/scripts/check-version.mjs#L49-L59) 强校验全包同版本 | 与「只升变更包」直接冲突，两脚本 + 单测 + 文档都要改 |
| 2 | [version.mjs](file:///c:/cod/note_npm/scripts/version.mjs#L239-L247) 遇到 `@bibliotype/demo` 条目直接 exit 1；当前 6 个 changeset 带 demo 条目（`compare-view-in-place`、`demo-margin-presets`、`settings-preset-enhancement`、`spread-turn-step`、`view-mode-toggle-fix`、`scrollbar-style-presets`） | 不修则 `version:rc` 必然失败 |
| 3 | `@bibliotype/collab` **没有任何 changeset**，但 [provider-websocket/package.json](file:///c:/cod/note_npm/packages/provider-websocket/package.json) 依赖它（`workspace:*`） | 严格按变更集首发会漏发 collab，导致 provider-websocket 发布后依赖指向 npm 上不存在的 `collab@0.1.0`。故**首发必须全量**（已确认走 `--all`） |
| 4 | 本机 `npm config get registry` / `pnpm config get registry` 均为 **`https://registry.npmmirror.com/`**（用户级 npmrc） | 直接发布等于往镜像站发（必失败/发错地方）。发布脚本必须强制 `https://registry.npmjs.org/` |

补充事实：23 个公开包、全部 `0.1.0`、从未发布；`.changeset/*.md` 91 个（含 README，脚本跳过）；
23 个公开包中除 `collab` 外全部在 changeset 覆盖范围内；根 `.npmrc` 已被 git 跟踪（不能放 token）；
`node scripts/version.mjs --dry-run` 不写文件；`npm_config_userconfig` 环境变量 npm 与 pnpm 都认
（已实测），可作为「项目内 npmrc 文件」的挂载方式。

---

## 二、改动方案（逐文件，决策已定）

### 1) `scripts/version.mjs`：改为增量日期版本

**新增参数**（[parseArgs](file:///c:/cod/note_npm/scripts/version.mjs#L54-L81)）：

| 参数 | 含义 |
| --- | --- |
| `--all` | 忽略变更集范围，全部公开包都升版（**仅首次发布用**） |
| `--reuse-pending` | 复用 `.release/pending.json` 的包清单，仅改版本号（rc → latest 提升用；不读/不删 changeset、不写 CHANGELOG） |

**`run()` 新逻辑**：

1. 模式判定
   - `--reuse-pending`：读 `.release/pending.json`，取其 `packages`；缺文件 → `fail(..., 1)`；
     清单里有包已不在工作区 → fail。
   - 否则：读 changesets；为空 → 仍 `fail(..., 2)`；
     - 私有包条目（demo / e2e）→ 记入 `skipped` 并 `continue`；
     - 真正的未知包名 → 仍 `fail(..., 1)`（保留拼写保护）；
     - 目标包集合 = `--all` ? 全部公开包 : 有 changeset 条目的公开包。
     - 目标集合为空（变更说明只涉及私有包）→ `fail('变更说明只涉及私有包，没有可发布的公开包', 2)`。
2. 版本计算：[computeVersion](file:///c:/cod/note_npm/scripts/version.mjs#L146-L162) 的 `packages` 入参
   **只传目标包**——碰撞检查与 `rc.N` 递增只看本批要发的包，未变更包的旧版本不干扰。
3. 打印：逐行 `- <包名> <旧版本> → <新版本>`，未入选的包不出现；打印
   `跳过 N 条私有包条目：…`。
4. 写入（非 dry-run）：
   - 目标包：`updateVersionField` + `prependChangelog`；
   - `--reuse-pending` 模式**跳过 CHANGELOG**（避免 rc→latest 重复写节）；
   - 仅当 `@bibliotype/core` 在目标集合内时 `updateCoreVersionTs()`（core 未变则不碰 `version.ts`）；
   - 写 `.release/pending.json`；
   - 非 `--reuse-pending` 时删除已消费的 changeset。
5. 输出 `RELEASE_VERSION=<版本>` 行（保留）。

`.release/pending.json` 结构（发布脚本与提升步骤共用）：

```json
{ "channel": "rc", "version": "26.10.25-rc.1", "packages": ["@bibliotype/core", "…"] }
```

`buildChangelogSection` 的空条目占位文案由「随版本列车同步发布」改为「随本次发布同步升级（无独立变更）」。

### 2) `scripts/publish.mjs`（新建）：批量发布只发待发清单

职责与顺序：

1. 读 `.release/pending.json`；缺失 → 报错并提示「先跑 `pnpm version:rc` / `version:latest`」。
2. 认证与 registry：
   - `env.npm_config_registry = 'https://registry.npmjs.org/'`（**强制覆盖 npmmirror**）；
   - 若根目录存在 `.npmrc.publish`（gitignore 的项目内 token 文件）→ 设
     `env.NPM_CONFIG_USERCONFIG = <该文件绝对路径>`，否则回落到用户级 `C:\Users\风起\.npmrc`；
   - 非 dry-run 先跑 `npm whoami`（同 env），失败则明确报「token 缺失/无效或 scope 不归属」。
3. **重跑容错**：逐个 `GET https://registry.npmjs.org/<pkg>`（scoped 用 `%2f` 转义），收集已发布版本集合；
   目标版本已存在的包 → 跳过并打印。
4. **依赖闭包校验**（防止第 3 条现状复现）：对待发包的 `dependencies` 中 `@bibliotype/*` 条目，
   解析其将被写入的版本（即该依赖包的本地当前 version）；若该版本既不在 registry 上、也不在本次待发列表 → 
   `fail` 并提示「改用 `--all` 或先补发依赖包」。
5. 发布：`pnpm -r --filter=<pkg> … publish --tag <rc|latest> --no-git-checks --access public --registry https://registry.npmjs.org/`
   （多包时 pnpm 按拓扑序，core 先发）；`--dry-run` 原样透传。
6. 汇总打印：已发布 N 个 / 已存在跳过 M 个 / 版本号。

参数：`--tag rc|latest`（默认 latest）、`--dry-run`。

### 3) `scripts/check-version.mjs`：去掉「全包同版本」不变式

- 删除不变式 1（列车一致），保留 core 对账（`version.ts` 的 `VERSION` == `packages/core/package.json` 的 version）；
- 输出改为 `[check-version] 版本一致：core <v>，core/src/version.ts 已同步；公开包 23 个`
  （保留「版本一致」字样，避免改既有断言）；
- `checkVersions` 返回值结构不变（`{ ok, version, publicCount }`）。

### 4) 根 `package.json` 脚本

```json
"version:rc": "node scripts/version.mjs --channel rc",
"version:rc:all": "node scripts/version.mjs --channel rc --all",
"version:latest": "node scripts/version.mjs --channel latest",
"version:latest:reuse": "node scripts/version.mjs --channel latest --reuse-pending",
"release:check": "node scripts/check-version.mjs && pnpm build && node scripts/publish.mjs --dry-run",
"release:rc": "pnpm build && node scripts/publish.mjs --tag rc",
"release": "pnpm build && node scripts/publish.mjs --tag latest"
```

注意顺序变化：`release:check` 依赖 `.release/pending.json`，必须在 `version:*` **之后**跑。

### 5) `.gitignore`

追加 `.release/`、`.npmrc.publish`（token 文件不得入库）。

### 6) 测试：`packages/core/src/__tests__/version-sync.test.ts`

- 删除「版本列车一致：packages/* 全部公开包同版本」与「负例：列车漂移」两条用例；
- 新增：

```ts
it('run(--dry-run) 跳过私有包条目且不写文件', async () => {
  const { run } = await import('../../../../scripts/version.mjs');
  const pendingPath = join(REPO_ROOT, '.release/pending.json');
  const before = existsSync(pendingPath);
  await expect(run(['--dry-run', '--channel', 'rc', '--base', '99.1.1'])).resolves.toBe('99.1.1-rc.1');
  expect(existsSync(pendingPath)).toBe(before);
});
```

- 其余（core 对账、`check-version.mjs` 退出 0、写回幂等、`version.ts` 缺失负例）保持；
  `createFixture` 中「列车漂移」相关断言随用例删除。

### 7) `.changeset/config.json`

`"fixed": [...]` → `"fixed": []`（本项目不用 `changeset version`，`fixed` 组已无意义；保留会误导「同步升版」）。

### 8) 新增 changeset

`.changeset/version-incremental-release.md`：

```md
---
"@bibliotype/core": patch
---

发版脚本改为按变更集增量升版：只有出现在变更说明中的公开包才升日期版本并发布，未变更包版本保持不变；私有包条目跳过不再中止；新增 `--all`（首次全量）与 `--reuse-pending`（rc → latest 提升）两个开关。
```

### 9) 文档同步（5 个文件）

| 文件 | 改动 |
| --- | --- |
| [docs/12-release-and-ci.md](file:///c:/cod/note_npm/docs/12-release-and-ci.md) | 「21 个公开包」→ 23（L11、L79）；版本策略段改为**增量发布日期版本**；发布流程改为四步（changeset → version → commit/tag → publish）；`version.mjs` 行为条目重写；`check-version` 只保留 core 对账；`fixed` 组说明改为空；新增「首次发布与 rc → latest 提升」小节（`--all` / `--reuse-pending`）；常见问题表更新；新增包步骤删去「加入 fixed 组」；CI 小节标注**发布流水线本轮不启用**（`ci.yml` 照旧） |
| [README.md](file:///c:/cod/note_npm/README.md#L150-L156) | 发布三行命令更新（含 `pnpm release:check` 位置与 `--all` 首发说明） |
| [CONTRIBUTING.md](file:///c:/cod/note_npm/CONTRIBUTING.md#L24) | 「10 个公开包为 fixed 组，版本列车整体推进」→「只有变更说明涉及的包才升版发布」 |
| [.changeset/README.md](file:///c:/cod/note_npm/.changeset/README.md#L17-L36) | 发布命令与「统一日期版本列车」描述改为增量语义 |
| [开发规范.md](file:///c:/cod/note_npm/开发规范.md#L140-L141) | 版本策略条目与脚本表同步（L3/L17/L21 的「21 个包 / fixed 版本列车」一并更新） |

---

## 三、npm 侧对接（一次性）

1. **scope 归属**：`@bibliotype` 必须属于你的账号或同名组织（npmjs.com → Add Organization，组织名
   `bibliotype`；或用户名本身即 `bibliotype`）。
2. **创建 Granular Access Token**：npmjs.com → Access Tokens → Generate New Token →
   Permissions **Read and write**；Packages 选 `@bibliotype`（或 All）；**勾选 Bypass 2FA**。
3. **token 落盘（两种，任选，均不污染仓库）**
   - **A. 项目内 npmrc 文件（推荐，发布脚本自动挂载）**
     新建 `c:\cod\note_npm\.npmrc.publish`（已加入 `.gitignore`）：

     ```ini
     registry=https://registry.npmjs.org/
     //registry.npmjs.org/:_authToken=npm_xxxxxxxx
     ```

   - **B. 用户级 npmrc**
     ```powershell
     npm config set //registry.npmjs.org/:_authToken npm_xxxxxxxx --location=user
     # 写入 C:\Users\风起\.npmrc
     ```

   > 不要写进根 `.npmrc`——该文件已被 git 跟踪。
4. **registry 校验**（当前本机是 npmmirror，这是必须核对的项）：
   ```powershell
   npm config get registry        # 当前 https://registry.npmmirror.com/
   ```
   发布脚本会强制 `https://registry.npmjs.org/`，无需手改；若想手验证：
   `npm whoami --registry=https://registry.npmjs.org/` 返回你的账号名。
5. **首包占位检查**：`npm view @bibliotype/core version --registry=https://registry.npmjs.org/`
   应返回 404（未发布）；若已存在同名包说明 scope 归属有误。
6. **CI**：本轮不做 GitHub 发布。`release.yml` 保留但**不触发**，`NPM_TOKEN` secret 也暂不配置。

---

## 四、本机批量发布执行步骤

> Windows PowerShell 5.1 不支持 `&&` 串联，手工命令请逐条执行；`package.json` 脚本由 pnpm 交给 cmd，可用 `&&`。

### 步骤 0：环境自检

```powershell
node -v                                   # ≥ 18
pnpm -v                                   # 9.15.0
npm whoami --registry=https://registry.npmjs.org/   # 已配 token 且账号正确
git status --short                        # 工作区干净（仅本次准备改动）
```

### 步骤 1：落地第二节改动并跑单测

```powershell
pnpm --filter @bibliotype/core test
node scripts/check-version.mjs
node scripts/version.mjs --dry-run --channel rc --all
```

通过标准：core 测试全绿；`check-version` 退出 0；dry-run **退出码 0**、列出 **23 个包**
`0.1.0 → 26.10.25-rc.1`、打印「跳过 6 条私有包条目」、且不产生 `.release/pending.json`。

再确认增量模式只挑变更包：

```powershell
node scripts/version.mjs --dry-run --channel rc
```

预期：只列 changeset 覆盖的 22 个包（**不含 `@bibliotype/collab`**）。

### 步骤 2：全量预检

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

### 步骤 3：应用 rc 版本（首次 = 全量）

```powershell
pnpm version:rc:all
```

预期：23 个 `packages/*/package.json` → `26.10.25-rc.1`、`core/src/version.ts` 同步、
各包 `CHANGELOG.md` 新增节、`.changeset/*.md` 清空（仅剩 `README.md`）、生成 `.release/pending.json`。

### 步骤 4：预检（版本已应用后）

```powershell
pnpm release:check
```

通过标准：版本一致性断言通过；构建成功；`publish --dry-run` 列出 pending 清单中的 23 个包且无错误。

### 步骤 5：提交并打 tag（由你执行，AI 不代提交）

```powershell
git add -A
git commit -m "chore(release): v26.10.25-rc.1"
git tag v26.10.25-rc.1
```

### 步骤 6：发布 rc

```powershell
pnpm release:rc
```

通过标准：23 个包依次发布成功（core 在前），末尾无 E403/E404/E412；中途失败可直接重跑
（脚本会跳过已存在的版本）。

### 步骤 7：rc 核验（见第六节）

### 步骤 8：提升为正式版

```powershell
pnpm version:latest:reuse    # 复用 pending 清单，仅把版本改成 26.10.25，不写 CHANGELOG
git add -A
git commit -m "chore(release): v26.10.25"
git tag v26.10.25
pnpm release                 # --tag latest
```

> `version:latest:reuse` 不读 changeset（rc 阶段已消费完），因此不会再触发退出码 2，也不需要补占位 changeset。
> 建议 rc 与 latest 同一天完成。

### 步骤 9：正式版核验 + 推送

```powershell
git push origin master --follow-tags
```

### 后续常规发布（增量）

```powershell
pnpm changeset        # 改完代码后写变更说明
pnpm version:rc       # 只升 changeset 涉及的包
pnpm release:check
git add -A; git commit -m "chore(release): v<version>"; git tag v<version>
pnpm release:rc
pnpm version:latest:reuse; git add -A; git commit -m "chore(release): v<version>"; git tag v<version>; pnpm release
git push origin master --follow-tags
```

---

## 五、消费方对接

### 安装

| 场景 | 命令 |
| --- | --- |
| 只读阅读（Vue） | `pnpm add @bibliotype/vue vue@^3.4` |
| 排版 / 分页内核 | `pnpm add @bibliotype/core @bibliotype/layout @bibliotype/reader @bibliotype/classical` |
| 导入 | `pnpm add @bibliotype/import @bibliotype/import-epub @bibliotype/import-docx` |
| 导出 | `pnpm add @bibliotype/exporter-epub @bibliotype/exporter-pdf @bibliotype/exporter-docx` |
| 存储适配 | `pnpm add @bibliotype/adapter-indexeddb` / `@bibliotype/adapter-http` / `@bibliotype/adapter-sqlite` |
| 协作 | `pnpm add @bibliotype/collab @bibliotype/provider-websocket`（自带 `yjs`） |

- 版本已不再统一：各包版本按自己的变更节奏走，**不要用同一个版本号钉全组**；包内依赖已钉精确版本，
  直接用 `@latest` 或按需指定各包版本即可。
- **peer**：仅 `vue ^3.4.0`（宿主提供）；`prosemirror-*` / `pdf-lib` / `yjs` / `docx` / `fflate` 是普通
  `dependencies`，安装时自动带入。
- **样式**：`import '@bibliotype/vue/style.css'`。
- **入口**：ESM + CJS + `.d.ts`；Node ≥ 18；浏览器需支持 `@supports selector()`
  （Chrome 83+ / Safari 16.4+ / Firefox 69+）。

### 最小接入

```ts
import { createApp } from 'vue';
import { createBibliotype } from '@bibliotype/vue';
import '@bibliotype/vue/style.css';

const app = createApp(App);
app.use(createBibliotype()); // 全局注册 BtBookView / BtPager / BtToc / BtEditor
```

---

## 六、发版后核验清单（rc / latest 各跑一遍）

```powershell
# 1) 版本与标签（必须显式指定 npmjs）
npm view @bibliotype/core version dist-tags --registry=https://registry.npmjs.org/

# 2) workspace:* 已改写为具体版本（关键：否则消费方装不上）
npm view @bibliotype/vue dependencies --registry=https://registry.npmjs.org/

# 3) 抽包确认都在
npm view @bibliotype/collab version --registry=https://registry.npmjs.org/
npm view @bibliotype/provider-websocket version --registry=https://registry.npmjs.org/

# 4) 临时项目安装冒烟
mkdir tmp-npm-smoke; cd tmp-npm-smoke; npm init -y
npm i @bibliotype/vue@rc vue@^3.4 --registry=https://registry.npmjs.org/
node -e "import('@bibliotype/vue').then(m => console.log('exports:', Object.keys(m).length))"
node -e "const m = require('@bibliotype/core'); console.log('cjs ok:', typeof m.VERSION)"
```

通过标准：
- `dist-tags`：rc 阶段 `{ rc: '26.10.25-rc.1' }`；latest 阶段 `{ rc: '26.10.25-rc.1', latest: '26.10.25' }`；
- `dependencies` 中无 `workspace:*`，均为具体版本；
- `provider-websocket` 的 `collab` 依赖版本在 npm 上存在；
- 冒烟脚本能 import / require（`dist` 未漏文件）；
- `npm view @bibliotype/fonts readme` 为空的属正常（该包与 `exporter-docx` 缺 README，本轮不补）。

---

## 七、假设与决策（执行时不再二次选择）

| 事项 | 决策 | 理由 |
| --- | --- | --- |
| 版本模型 | 增量发布日期版本：只有 changeset 涉及的公开包升到当日 `YY.M.D` | 你的明确要求；未变更包版本与已发布产物保持不动 |
| 首发范围 | `--all` 全量 23 个包 | collab 无 changeset 却被 provider-websocket 依赖，不发会造成依赖 404 |
| rc → latest | `--reuse-pending` 复用上一批清单，仅改版本号 | rc 阶段已消费 changeset，避免退出码 2 与重复 CHANGELOG |
| 发布通道 | 先 `26.10.25-rc.1`、验证后 `26.10.25` | npm 首发 24h 内不可 unpublish，rc 先行可纠错 |
| 重跑容错 | 脚本查 registry 自动跳过已存在版本 | 中途失败重跑不必手工拼 `--filter` |
| registry | 脚本强制 `https://registry.npmjs.org/` | 本机全局配置指向 npmmirror，直接发会发错站 |
| token 存放 | 项目内 `.npmrc.publish`（gitignore）优先，回落用户级 `~/.npmrc` | 满足「npmrc 文件存 token」，且不污染已跟踪的根 `.npmrc` |
| 发布方式 | 本机命令批量发布 | 你的要求；GitHub Actions 本轮不做 |
| 缺 README 的 2 个包 | 本轮不补 | 不阻断发布，npm 页面回落到 description |
| 每包 LICENSE | 本轮不复制 | `license: MIT` 字段已足够 |
| 提交 / 打 tag | 由你执行 | 仓库既定约定：AI 不自行提交 |

---

## 八、执行顺序总览

1. 改 `scripts/version.mjs`（增量 + `--all` + `--reuse-pending` + 私有跳过 + pending.json）；
2. 新建 `scripts/publish.mjs`（pending 清单 + registry 强制 npmjs + 已发布跳过 + 依赖闭包校验）；
3. 改 `scripts/check-version.mjs`（去列车一致）；
4. 改根 `package.json` 脚本、`.gitignore`、`.changeset/config.json`；
5. 改单测（`version-sync.test.ts`）、新增 changeset；
6. 同步 5 个文档；
7. 跑单测 + `check-version` + 两条 dry-run 自检；
8. 你完成 npm 侧对接（org / token / scope 归属）；
9. `pnpm version:rc:all` → `pnpm release:check` → 你 commit+tag → `pnpm release:rc` → rc 核验；
10. `pnpm version:latest:reuse` → 你 commit+tag → `pnpm release` → 核验 → `git push origin master --follow-tags`。
