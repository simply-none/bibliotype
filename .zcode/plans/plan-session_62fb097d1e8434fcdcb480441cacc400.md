# PDF 导出样式与预览一致性修复计划

## 根因分析（逐行核对结论）

预览端每页结构（`BtBookView.vue` / `PagedCanvas.vue`）：页框 `.bt-reader-page` inline = `buildPageStyle`（尺寸/padding）+ `buildRootStyle`（字体、字号、行高、字距、**text-indent**、颜色、背景、**page-border 版框**、writing-mode、直排策略、分栏、仿真版心内缩、chrome 变量），内容再包 `__flow` wrapper（**逐页分栏**）+ 页底注区 + 版心 + 页眉页脚。

导出端（`print-document.ts` `createPrintPager`）：根规则挂 `body` 的 `buildBookCss` + `buildPrintCss` 的 `.bt-page` 盒。逐属性对照后确认 5 处不一致：

| # | 差异 | 影响 | 证据 |
|---|---|---|---|
| P0 | **光栅路径样式全失**：`buildSvgXml` 把 `<style>`+页片段包进 XHTML `<div>` 进 foreignObject，**无 body 元素** → `body {…}` 根规则与全部 `body .bt-*` 作用域规则失配 | 浏览器「应用内直出」PDF：字体/字号/行高/颜色/背景全丢，**直排变横排**，所有节点样式失效 | `raster-pdf.ts:99-115`；`book-css.ts:99,154,169` |
| P1 | **古籍直排版框缺失**：古典主题 `page-border: '3px double #b09a76'`（`use-app-themes.ts:48`），预览经 `buildRootStyle` 画框（`style-builder.ts:81-83`），导出 body 规则与 `.bt-page` 均不输出 border，但分页口径两端都扣 `border×2`（`style-builder.ts:210,292`） | 古籍直排 PDF 无双边版框，且版心四周多出被扣掉的空位 | `print-styles.ts:219-227` |
| P2 | **text-indent 根级断链**：预览页框 inline `text-indent` → 容器段落 `text-indent: inherit`（`book-css.ts:531-541`）解析到根值；导出 body 无 text-indent → inherit 落到 0 | 现代横排（默认 2em）双行小注/夹注/尾注等容器段落首行缩进丢失 | `style-builder.ts:72` vs `book-css.ts:131-140` |
| P3 | **页底浮注导出缺失**：`renderPage` 不调 `reader.getPageNotes`/`serializePageNotes`（import 列表即无）；`PrintDocumentOptions` 无 `footnoteFloat`/`noteMaxRatio`，内部 Reader 未启用 → 宿主开浮注时注全丢且分页与预览错位 | 任何开启页底浮注的书（demo 当前未开，属能力缺口） | `print-document.ts:31-43,246-261,265-311` |
| P4 | **逐页分栏缺失**：预览 `__flow` wrapper inline `column-count/gap/fill:auto` + 子块 `break-inside: avoid`（`BtBookView.vue:271-278`）；导出无 wrapper，且 book-css body 规则的 `column-count` 在 paged 模式作用于 body（把 `.bt-page` 序列当栏内容排）；demo 设置面板已暴露分栏（`SettingsLayoutSection.vue:229`） | 分栏 2~3 时 PDF 单栏且页面排布错乱 | `print-document.ts:271-281`；`book-css.ts:149-153` |

另核对确认**非差异**（不需改）：`.bt-page-number` 口径（scoped 规则特异性胜出，两端同值）、chrome 变量、仿真 `--bt-fs-*` 几何与版心 padding、夜间配色进 PDF（demo 传同一份 tokens，符合"与预览一模一样"目标，维持）。

## 修复方案（全部在 `packages/exporter-pdf`，零破坏既有公开 API）

### 1. `src/raster-pdf.ts` — P0
- `buildSvgXml` 的 foreignObject 包装元素由 `div` 改为 XHTML `<body>`（`createElementNS('http://www.w3.org/1999/xhtml', 'body')`）：现有 CSS 的 `body` 根规则与全部 `body .bt-*` 作用域规则直接命中，光栅与打印文档**逐字符同规则**；body 的 UA margin 8px 被既有 `body { margin: 0 }` 覆盖。
- 将 `buildSvgXml` 具名导出（纯函数，公开合理）供单测断言。

### 2. `src/print-styles.ts` — P1 / P2 / P4
- **P1**：paged 分支，非仿真（`isFacsimileEnabled` 为 false，与 `buildRootStyle` 同闸门）且 `tokens['page-border']` 非空时，`.bt-page` 追加 `border: {令牌原值}`（与预览 inline 完全一致；border-box 下 border 侵占内容，恰好对齐分页已扣除的 `border×2` 口径。注释说明：出血 >0 时框随页盒外扩的已知偏差，本次不处理）。
- **P2**：输出 `body { text-indent: var(--bt-text-indent-body); }`（auto 与 paged 均输出；变量缺失时整条失效，等价 `setIfPresent` 语义；只进打印 CSS，不扰动 EPUB）。
- **P4**：paged 分支新增
  ```css
  .bt-page__flow[data-columns='2'], [data-columns='3'] { column-count/gap: var(--bt-column-gap)/column-fill: auto }
  .bt-page__flow[data-columns] > * { break-inside: avoid }
  .bt-page > :first-child, .bt-page__flow > :first-child { margin-block-start: 0 }   /* 原规则扩为两条 */
  ```
  并追加 `body { column-count: initial; -webkit-column-count: initial }` 撤销 body 级分栏（仅 paged 分支；同特异性靠层叠顺序胜出）。

### 3. `src/print-document.ts` — P3 / P4
- **P4**：paged 时 `buildBookCss` 的 options 传 `{ ...layout, columns: 1 }`（分页主轴/图片限幅均不读 columns，仅避免 body 分栏规则）；`renderPage` 在 `columns > 1`（`reader.getPageColumns`）时把正文片段包进 `<div class="bt-page__flow" data-columns="N">`，单栏不包（产物对既有断言逐字符不变）。
- **P3**：`PrintDocumentOptions` 新增可选 `footnoteFloat?: boolean`、`noteMaxRatio?: number`，透传内部 Reader；`renderPage` 在正文（或 wrapper）之后渲染注区：`reader.getPageNotes` 非空时内联 `serializePageNotes(notes, { continued: reader.isPageNotesContinued(index) })`，位置与预览一致（在 `.bt-page` 直接子级、页眉页脚之前）。注区样式 `.bt-page-notes` 已在 book-css（body 作用域）内。

### 4. 测试（行为改动先写复现用例）
- `__tests__/pdf.test.ts`：古典 tokens + paged → `.bt-page` 含 `border: 3px double #b09a76`、`body` 含 `text-indent`；仿真布局**不**输出 border；分栏 2 → `data-columns="2"` wrapper + body 无 `column-count`；`footnoteFloat: true` → 注区 HTML 出现且分页含注区容量。
- `__tests__/print-pager.test.ts`（或新文件）：`buildSvgXml` 输出含 `<body`、根规则可命中（happy-dom）；单栏 paged 产物与改造前逐字节不变的既有断言保持绿。

### 5. 文档 + changeset（规范铁律）
- `docs/08-export-pdf.md`：注区导出、版框、text-indent、逐页分栏、光栅 body 修复说明；选项表补 `footnoteFloat`/`noteMaxRatio`。
- `packages/exporter-pdf/README.md`：选项表同步。
- `docs/14-faq.md`：新增「光栅导出样式全失」条目（现象 → 根因：foreignObject 无 body 选择器失配 → 处理）。
- `.changeset/`：`@bibliotype/exporter-pdf` 修复说明（fix）。

## 验证（规范第十一节）
```bash
pnpm build
pnpm --filter @bibliotype/exporter-pdf test
pnpm test          # 全量（exporter-pdf 依赖 core/layout/reader，按规范跑全量）
pnpm typecheck
```
交付时附 Conventional Commits 提交文本（`fix(exporter-pdf): …`），由维护者提交。

## 范围说明
- demo 端接线已同源（`use-export.ts` 与预览传同一份 tokens/layout/fontToken/features/实测分页数据），无需改动。
- auto（连续）模式本质是打印引擎流式重排，无逐页结构，不做逐页一致承诺；根级修复（P1/P2）顺带生效。
- 夜间配色、出血下版框位置偏差（bleed>0）维持现状并在文档记录。
