# 缺字图与上下文融合——优化方案

## 根因（四层累计，逐条）

1. **导入拆段**：`packages/editor/src/core-node-specs.ts:154-174` IMAGE 的 PM spec 为 `group: 'block'`，EPUB 段落内 `<img>` 经 PM DOMParser 被强制拆成 `段落/块级image/段落`；且 `getAttrs` 只读 `src/alt`（:169），`width/height` 全丢 → IR 无尺寸元数据。
2. **识别漏判**：`packages/core/src/glyph-image.ts:122-124` `isEmbeddedBitmap` 不认 `data:image/svg+xml`。EPUB 内联缺字图主流形态（位图 data URI + 切断句子）本应凑满 2 条弱信号，SVG 形态只剩 1 条 → 保守保留块级；宽高丢失又使「近方形小图」强信号永远无法命中。
3. **归一化覆盖面**：`normalizeGlyphImages` 仅在 `apps/demo/src/components/ImportPanel.vue:68` 调用；书架打开（`LibraryShelf.vue:43 openFromShelf`）与草稿恢复（`readDraft`，消费点 `App.vue:415/453`、`use-edit-session.ts:139`）均不归一化 → 存量书保持坏结构。
4. **抽层次生缺口**：`packages/reader/src/document-blocks.ts:250` `isLeafBlock` 对「只含 glyph-image 无文本」的段落判非叶并下钻，字图再次独立成块。

渲染样式 `.bt-image { display:block; margin-inline:auto }`（`book-css.ts:288`）本身正确，无需改动。

## 改动清单

### 1. `packages/core/src/glyph-image.ts` — 补识别信号
- `isEmbeddedBitmap` 扩为 `/^data:image\/(png|gif|jpeg|webp|svg\+xml)[;,]/i`，注释说明 EPUB 缺字图主流为内联 SVG。
- 效果：SVG data URI + 切断句子 = 2 弱信号 → 归并；保守语义不变（无切断句子仍保留，绝不丢数据）。

### 2. `packages/editor/src/core-node-specs.ts` — 导入保留 width/height
- IMAGE spec `attrs` 增加 `width: { default: null }, height: { default: null }`；`getAttrs` 读取并 `parseInt` 数值化（缺失/非法返回 null）。
- 效果：`<img width="16" height="16">` 类缺字图导入即命中「近方形小图」强信号（strong≥1 直接判字图）；插图也获得尺寸保真。
- 向后兼容：新增可空 attr；`glyph-image` spec 不加（渲染恒 1em），其 IR attrs 的宽高经 `rawAttrs` 兜底往返（`attr-mapper.ts` 既有机制）。

### 3. `packages/layout/src/html/html-serializer.ts` — 尺寸原生输出
- IMAGE 分支：width/height 有值时输出原生 `width="…" height="…"` 属性并从 `data-*` 排除（白名单机制见 `dataAttrs`，:259）。

### 4. `packages/reader/src/document-blocks.ts` — 纯字图段落整块
- `isLeafBlock` 第三类判定（:250）追加 `|| children.some(c => c.type === NODE_TYPES.GLYPH_IMAGE)`：段落含行内字图即整块渲染，不再下钻。`findNodeById`/`indexNodeAnchors` 复用同函数，口径自动一致。

### 5. `apps/demo` — 打开时归一化并回写（用户已确认）
- `LibraryShelf.openFromShelf`（有 id 与 `api.saveBook`）：`readBook` 后跑 `normalizeGlyphImages`；`report.merged` 非空 → emit 归一化文档并异步 `saveBook` 回写，`emit('notify', summarizeGlyphImageReport(report))` 提示。
- `use-edit-session.ts` 的 `readDraft`（:110）返回前跑 `normalizeGlyphImages`（幂等，覆盖 K6 之前的旧草稿；进入编辑器后 autosave 自动落盘新基线，无需显式回写）。
- ImportPanel 已归一化，不动（保持报告 UI 语义）。

### 6. 测试（先写复现用例再修实现）
- `core/__tests__/glyph-image.test.ts`：SVG data URI + 切断句子 → 三合一 restore；SVG data URI 但前段收尾 → 保守保留。
- `editor/__tests__/ir-pm.test.ts`：`img width/height` 导入 → PM attrs → IR attrs 保留。
- `layout/__tests__/html-serializer.test.ts`：块级 image 原生 width/height 输出。
- `reader` 块抽取测试：纯 glyph-image 段落 → 单一 paragraph 块。

### 7. 文档与 changeset（规范铁律）
- `docs/05-layout-and-html.md` 字图小节：SVG 信号、导入宽高保留、demo 打开归一化行为。
- `docs/17-document-import.md` 同步导入行为描述（如有字图段落）。
- 新 changeset：`fix(core,editor,reader,layout)` 汇总上述行为变化，demo 回写行为一并说明。

## 验证
- `pnpm build` + `pnpm test` + `pnpm typecheck` 全量（IMAGE spec 变更涉上游，按红线跑全量）。
- 手动：`pnpm dev:demo` 重新导入样本 EPUB 看状态行报告；书架打开存量《杜诗详注》看归并提示与 旌 图行内渲染。

## 交付
- 提交文本（Conventional Commits，由维护者提交）：
  `fix(core,editor,reader,layout): 字图识别补 SVG 内联信号 + 导入保留宽高 + 纯字图段落整块，demo 打开存量书自动归一化回写`

## 风险说明
- 归并会改变被修复段落的分页（阅读进度略有偏移）；标注锚点按节点 id 定位，仅被归并段落内偏移受影响，其余不受影响。
- 归一化幂等：重复执行不产生二次变化；判定不确定的图仍保守保留并写报告，不丢数据。