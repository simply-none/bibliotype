# 14 常见问题与故障排查

> 涉及包：全仓　·　相关：[02 编辑器与插件](02-editor-and-plugins.md)、[04 阅读器与分页](04-reader-and-pagination.md)、[05 版式与 HTML](05-layout-and-html.md)、[08 PDF 与打印](08-export-pdf.md)、[10 存储适配器](10-storage-adapters.md)、[13 核心运行时](13-core-runtime.md)

沉淀自真实修复历史的经典问题，按「现象 → 根因 → 处理 / 排查」组织。

## 1. 编辑保存后，古籍注文样式丢失 / 注文被拆散

**现象**：在编辑模式保存（或经编辑往返）后，阅读 / 预览时双行注、校勘记等注文的容器样式丢失，或注文被拆成多块、跳转定位偏移。

**根因**：IR 是**宽松树**（注文容器可直挂文本子级）；编辑往返会把「容器直挂文本」规范化为「容器 + 段落」形态。若分块 / 渲染按「子级形态」决定是否拆分容器，同一文档在编辑前后渲染不一致——容器的类型样式（`bt-{type}` 类）与稳定 id 随拆分丢失。

**处理与排查**：

- reader 的分块将**版式文本容器**（双行注 / 夹注 / 眉批 / 校勘记 / 牌记 / 题跋等）视为**原子叶块**：无论子级是直挂文本还是「容器 + 段落」，恒整体成块、整体序列化，容器样式与 id 不丢失（见 [04](04-reader-and-pagination.md) 叶块规则、[05](05-layout-and-html.md) 序列化）；
- 自定义分块 / 渲染逻辑遵循同规则：不要按「容器是否含段落子级」决定拆块；
- 排查：用 `reader.getPageBlocks(i)` 观察注文是否为单个容器节点、类名是否保留。

## 2. 编辑画布中点击注释，光标跳到正文

**现象**：编辑模式下点击双行注 / 校勘记等注释容器内的文字，光标回退到容器之外的正文，注释无法编辑。

**根因**（两处叠加）：

1. **PM 文档非法**：IR 宽松（如 `double-note` 的 children 直挂 text），`irNodeToPm` 若直接转换，产出违反块容器内容表达式（`block+`）的 ProseMirror 文档。PM 光标只能落在合法文本块内，非法位置被 `Selection.near` 回退到最近有效位置（正文）；
2. **书册样式泄漏**：`buildBookCss` 的节点 / 角色规则若为全局选择器（如 `.bt-double-note { column-count: 2 }`），经 `BtBookView` 注入 head 后会作用到编辑画布中的同名 `bt-*` 节点，多列布局进一步干扰 `posAtCoords` 定位。

**处理与排查**：

- IR→PM 转换对块容器内的行内内容**聚合包段**（容器直挂文本 → 段落），保证结构合法；
- 书册样式**作用域隔离**：阅读侧经 `containerSelector` 前缀限定到阅读容器（如 `.bt-reader-page`），EPUB / PDF 保持 `body` 语义；
- 出现「点击无法落入 / 光标跳走」症状时，同时核查：PM 文档树是否满足目标容器的内容表达式、页面全局样式是否按容器隔离。

## 3. 阅读页样式不生效

**现象**：注入了书册样式，阅读页仍无样式（或只有部分节点有样式）。

**根因**：`buildBookCss` 的 `containerSelector` 与实际渲染容器不匹配——例如样式规则限定在 `.bt-reader-page`，而真实渲染根元素没有该类名（或限定 `body` 但渲染发生在其外部容器）。

**处理与排查**：

- 令 `containerSelector` 与阅读容器的根类名一致（`BtBookView` 使用 `.bt-reader-page`，见 [06](06-vue-integration.md)）；
- 导出场景保持默认 `body`（EPUB 的 `style.css`、PDF 打印文档）；
- 排查：核对样式规则的容器前缀、渲染根元素的 classList、样式注入目标（文档 head / 容器内 / Shadow DOM）。

## 4. 非浏览器环境报错（Node / SSR）

**现象**：Node / SSR 下调用部分 API 抛错，如「未检测到 document」「IndexedDB 不可用」。

**根因**：少数 API 依赖浏览器能力——`printHtml` / `printBook` 需要 DOM 与打印环境（[08](08-export-pdf.md)）；`IndexedDbAdapter` 缺省取全局 `indexedDB`（[10](10-storage-adapters.md)）；`BtEditor` / `BtBookView` 等视图组件需要 DOM。

**处理与排查**：

- 改用纯函数替代：`renderPrintHtml`（IR → 打印 HTML）与 `buildPrintCss` 无 DOM 依赖；
- 存储改用 `MemoryAdapter`，或为 `IndexedDbAdapter` 注入 `factory`（Node 测试用 `fake-indexeddb`）；
- 视图组件仅客户端渲染（SSR 框架中使用 ClientOnly / 动态导入）；
- 环境对照全表见 [15 SSR 与 Node 同构](15-ssr-and-node.md)。

## 5. 新增 core 节点后全量回归失败（editor 未登记）

**现象**：在 `@bibliotype/core` 的 `NODE_TYPES` 新增节点类型后，core 单包测试通过；全量回归（`pnpm test`）时 editor 的 schema 测试失败，报「节点 xx 未登记」。

**根因**：core 的节点名录（`NodeTypeRegistry`）与 editor 的 ProseMirror 规格表（`CORE_EDITOR_NODE_SPECS`）是**两层注册**（见 [13 核心运行时](13-core-runtime.md) 三层关系）；新增节点只注册了 core，未同步 editor 规格表。单包测试不遍历该断言，只有全量回归暴露。

**处理与排查**：

- 在 `CORE_EDITOR_NODE_SPECS` 补对应规格：结构容器用 `{ group: 'block', content: 'block*', attrs: COMMON_NODE_ATTRS }`；带目录标题语义的用 `STRUCTURE_NODE_ATTRS`（见 [02](02-editor-and-plugins.md)）；
- 任何 core 节点类型增删改后，跑全量 `pnpm test` 而非仅单包。

## 6. 大文档编辑卡顿（逐键掉帧 / 一停手就卡）

**现象**：几十万字（上万块）文档进入编辑后，连续打字丢字或掉帧；停手瞬间卡一下；
「已保存」状态迟迟不刷新。

**根因**：两层，都在「编辑 → 保存」链路上，且都是主线程同步大任务：

1. **逐键一次全量快照**：变更广播若走 `getDocument()`（全量 PM→IR），每个逐键事务都要
   O(全文档) 转换 + 等量对象分配（实测 78 万字 / 12623 块：4.8 ms/键），伴随 GC 抖动；
2. **每次输入停顿一次整本落盘**：`StorageAdapter.save` 是整本 `put`，`getDocument()` 快照
   加结构化克隆（实测 1.8 MB 文档约 5 + 27 ms）一旦落在输入帧上即为可见卡顿。

**处理与排查**：

- 快照 / 广播改用 `getSharedDocument()`（PM 结构共享，O(变更子树)）：78 万字文档单次广播
  由 5.0 ms 降至 0.7 ms（其中全量转换部分 4.8 → 0.02 ms），逐键成本回到无订阅基线量级；
- 落盘做成「节流合并 + 空闲时段（`requestIdleCallback`）+ 单飞去重」：快照在**执行时**取，
  排队期间的新输入自动并入本轮，不再出现「一停手就整本写」；
- **快照与 `markSaved()` 必须同一同步帧**：若先 `await` 写库再 `markSaved()`，await 期间的
  新编辑会被误标为已保存（状态不准 + 关页面可能丢这几笔）；
- 写失败要保住脏标记并定时重试，不能因「基准已推进」而静默丢内容；
- 查证手段：对目标规模文档跑最小复现（构造 N 个段落 → 订阅 `onChange` → 循环 `dispatch`
  计时），**别凭「代码看起来没毛病」下结论**；区分「模型层」与「DOM 量尺」两类成本再动手。

**参考实现**：`apps/demo/src/composables/use-draft-autosave.ts`（调度策略）、
`apps/demo/src/App.vue`（接线与状态展示）。

## 7. 段落含注音时，选中后加行内标记（异体等）样式偏移到右边

**现象**：编辑态分页视图里，选中一段文字后点工具栏「异体」，标记落到选中内容**右侧**的
字上（看起来像选错了）。前提：同一段落中，选中内容**之前**已有「注音」（ruby）。

**根因**：字符坐标轴不一致。模型轴（IR / PM / 切片）**不含**注文字符——注文存在 ruby 标记的
`attrs.text` 里，不是文本子节点（口径见 `reader.collectNodeText` / `layout` 的
`nodeTextLength`）；而片段 DOM 轴**含**注文——`html-serializer` 把 ruby 渲染为
`<ruby>基字<rt>注文</rt></ruby>`，`<rt>` 是真实文本节点。把 DOM 文本折算为模型偏移时若计入
注文，偏移就比模型多出「选中位置之前的注文字数」，选区 / 光标 / 行首偏移随之整体右移。

**处理与排查**：

- DOM 文本采集处一律跳过 ruby 注文子树（`<rt>` / `<rp>`）：`vue` 包统一用 `ruby-annotation`
  的 `isRubyAnnotationElement` / `isRubyAnnotationText`；
- 受影响的是**所有**把 DOM 文本当模型偏移用的地方，已覆盖两处：`paged-editor/input-router`
  的 `fragTextNodes`（片段 DOM ⇄ 片段内字符偏移：行内标记落点、IME 插入、光标还原、
  跨片段导航）与 `pagination-measure` 的 `collectTextOffsets`（实测行首偏移 `lineOffsets`：
  片段切片边界与选区映射）；
- 排查口诀：凡「DOM 里占位、模型里不存在」的字符都可能污染字符轴。CSS 伪元素
  （如 `.bt-collation-mark::after` 的 `content`）不是 DOM 文本节点，不受影响；`<rt>` 是
  DOM 文本节点，必须显式排除；
- 回归用例：`packages/vue/src/__tests__/paged-input.test.ts`（「注音（ruby）注文不进入字符轴」组）
  与 `packages/vue/src/__tests__/ruby-annotation.test.ts`；
- **验证限制**：`lineOffsets` 依赖真实布局（`getClientRects`），happy-dom 无布局引擎 →
  单测只覆盖注文识别与片段级换算；含注音多行段落的切片边界需在浏览器 / demo 中手工确认。

## 相关

- 核心运行时与三层注册：[13 核心运行时](13-core-runtime.md)
- 编辑器与规格注册：[02 编辑器与插件](02-editor-and-plugins.md)
- 阅读与版式：[04 阅读器与分页](04-reader-and-pagination.md) · [05 版式与 HTML](05-layout-and-html.md)
- 导出与存储：[08 PDF 与打印](08-export-pdf.md) · [10 存储适配器](10-storage-adapters.md)
- 环境要求：[15 SSR 与 Node 同构](15-ssr-and-node.md)
