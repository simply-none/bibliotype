# 古籍仿真直排「文字超出界行」修复计划

## 根因（逐行排查结论）

界行是**静态定距网格**：`facsimile-frame-css.ts:107-111` 用 `repeating-linear-gradient` 以 `--bt-fs-line-pitch`（= 字号×行距，`facsimile-geometry.ts:120-127`）从版心右缘起每 `pitch` 画一条线；注释（`facsimile-geometry.ts:114-118`）明文假设「line-height 决定行盒横向厚度，界行节距必须与它严格相等」。

但文字列距是**浏览器动态排布**的，该假设只在「所有行盒厚度与块轴间距都是 pitch 的整数倍」时成立，而现有样式四处破坏它：

| 漂移源 | 代码位置 | 漂移量（宋刻浙本 pitch=42.9px 为例） |
| --- | --- | --- |
| **根 line-height 是倍数**：`line-height: 1.95` 以**数字**继承，任何非正文音的后代按自身字号重算行盒厚度 | `book-css.ts:135` / `style-builder.ts:70` | 注文 0.72em→行盒 27.4px ≠ 42.9 |
| **显式行高覆盖**：标题 1.4、双行小注 1.65、代码块 1.6、注区 1.5 | `book-css.ts:178,483,205,770` | 标题 1.75em×1.4=53.9 ≠ 42.9 |
| **双行小注块宽**：2 子栏×(0.72em×1.65) + 栏距 1.6em + 左边距 1.2em | `book-css.ts:479-487` | ≈ 1.86 格（79.5px），非整数倍 |
| **块轴（横）外距/边框**：引文 `margin: 1em 2em`、眉批/牌记左右边框与内距、注区 block-start 线 | `book-css.ts:194,488-530,765-770` | 各 1~4em 横向错位 |

后果：一旦页面里出现小注/标题/引文，后续所有列相对界行**永久错相**——文字骑在界行上（截图中央区双行小注处）；块累计推进量落入版心余数区（六个预设 textWidth ÷ pitch 余 16~26px）时，末列文字压过最后一条界行。预览（BtBookView）、编辑（PagedCanvas）、导出（exporter-pdf paged）共用 `buildBookCss` + `buildRootStyle`，故三端同现。

## 修复方案：行款网格对齐层（layout 包内实现，三端一次修复）

核心思路——把「网格假设」变成「网格保证」：仿真直排时让**每个行盒厚度与块轴间距恒为 pitch 或其整数倍**。

### 1. `packages/layout/src/style-builder.ts` — 根行高绝对化
`buildRootStyle` 在 `isFacsimileEnabled(options) && vertical` 时把 `line-height` 从令牌倍数改为 `${resolveLinePitch(tokens)}px`（数值直出，不依赖变量层，量尺工作表/预览页框/编辑画布同值）。倍数行高按后代字号重算的漂移源就此消除——任何未显式设行高的后代（段落、注文小字、注码、题跋）行盒恒等于列距。

### 2. `packages/layout/src/html/book-css.ts` — 根规则同口径 + 调用网格层
- body 根规则在既有双闸门（`pageDecoration && facsimile && vertical`）下同样输出 px 行高（打印 paged 与预览逐字同值；EPUB/auto 不受影响，产物隔离矩阵不变）；
- 在 §9 装饰层之后、§10 用户覆盖之前追加 §9.5，调用新文件产出的网格对齐层（用户功能样式仍可覆盖）。

### 3. 新文件 `packages/layout/src/html/facsimile-grid-css.ts` — 网格对齐覆盖层（原子职责）
`buildFacsimileGridCss({ options, tokens, containerSelector })` 纯函数输出 scoped 覆盖，全部数值由 `resolveLinePitch` 等既有几何函数在构建期算出（无 CSS 分支）：
- **显式行高归格**：`.bt-heading`/`.bt-code-block`/`.bt-page-notes` → `line-height: {pitch}px`；`ruby > rt` → `line-height: 1`（注音收进字距空隙）；
- **标题与结构页大字按倍数行高**：构建期按 `字号px ÷ pitch` 向上取整 k，输出 `line-height: {k×pitch}px`（h1~h6 按分级倍率、`cover-title`/`title-page-title` 等 data-role 逐个计算；仅 k≥2 时输出规则，汲古阁本标题 35px>34px 等场景自动落 2 格）；
- **双行小注一格双行（仿真书原貌）**：`column-gap: 2px`、`line-height: calc(({pitch}px − 2px)/2)`、`margin: 0.35em 0 0.45em`（去掉左边距 1.2em）→ 块宽恰为 1 格；
- **块轴装饰归零**：引文 `margin: 1em 0`、眉批/牌记/题跋/版框节点的左右 margin/padding/border 置 0（保留上下即行内方向的间距与配色）、注区 `margin/padding/border-block-start: 0`、`hr` 的 `border-block-start: 0`、脚注块同理。

网格层生效后，所有文本块的横向占位恒为 pitch 整数倍 → 累计推进量永不落入版心余数区，末列裁字与骑线自然消失；量尺实测随 CSS 同步，分页容量无需改动（`resolvePageMainSize` 不动，风险最小）。

### 4. 测试
- 新增 `packages/layout/src/__tests__/facsimile-grid-css.test.ts`：双闸门隔离（未启用零输出、横排零输出）、双行小注块宽恰为一格（(pitch−2)/2×2+2=pitch）、标题 k 倍行高（含汲古阁 2 格场景）、块轴外距归零清单；
- 更新 `book-css.test` / `style-builder.test` 中仿真用例：根行高 px 断言（如宋刻浙本 `42.9px`）、古籍直排（非仿真）与 EPUB 路径逐字符不变断言保持；
- 全量 `pnpm test` 回归（exporter-pdf 的仿真打印断言、vue 量尺链路）。

### 5. 文档 + changeset
- `docs/22-facsimile-vertical.md`：新增「界行对齐（行款网格）」一节——机制、双行小注一格双行的设计、已知限制（表格/插图自身不参与网格，局部漂移；Node 无实测导出的估算路径近似对齐）；
- `packages/layout/README.md` 若提及仿真样式则同步；
- changeset：`@bibliotype/layout` patch（行为：仿真直排行款对齐，双行小注占位收紧为一格，页数可能微变）。

## 验证
```bash
pnpm build && pnpm test && pnpm typecheck
```
另请在 demo 手工核对三端：切「古籍仿真直排」→ 预览翻页、编辑画布、导出 PDF（分段或直出），确认正文与双行小注均落在界行之间（六模板各抽一）。

## 影响面与取舍
- 只动 `packages/layout`（+测试/文档），预览/编辑/导出三端自动生效，无公开 API 变更；
- 古籍直排（非仿真）、现代横排、EPUB/auto 导出产物逐字符不变（双闸门保证）；
- 仿真模式视觉变化：双行小注子栏更紧凑（一格双行，符合古籍原貌）、眉批/牌记去掉边框盒（网格优先；如需保留装饰盒可后续用「占 k 格」方案迭代）；
- 表格、插图、大印章等非文本块不强制落格（古籍仿真场景罕见），文档记为已知限制。