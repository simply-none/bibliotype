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

## 8. 编辑时输入，同一段落在多处（跨页）重复出现

**现象**：编辑态分页视图里打字（尤其中文 IME）后，同一段完整文本在**两页同时出现**——
续页开头把上一页已完整呈现的段落又整段重复了一遍。

**根因**（两处叠加，都源于增量重排的陈旧实测缓存）：

1. **陈旧 `lineOffsets` 未清理**：`measurePagination` 只在块测得多行时才写 `lineOffsets`
   （`offsets.length > 1` 守卫，见 `pagination-measure.ts`），而 `buildPagedLayout` 合并实测结果时
   从上一轮 `prev.lineOffsets` 起步、**只覆盖不删除**。当编辑使某块**收缩为单行**时，其上一轮的
   多行 `lineOffsets` / `lineSizes` 残留 → `extractBlocks` 以陈旧多行 offsets 给出 `lineCount`（虚增，
   ≠ 真实行数）→ `paginate` 造出**幽灵续排片段**；
2. **行→字符换算越界回退塌回块首**：`charOfLine`（切片 `charRangeFromLines` 与光标映射
   `fragmentCharToBlockChar` 共用）对越界行号用 `offsets[line] ?? offsets[offsets.length-1] ?? 0`，
   起点被钳回块首 → `sliceNodeByCharRange` 命中「全覆盖返回原节点」→ 续页片段从块首整段重切。

**处理与排查**：

- **清理陈旧项**（`use-paged-layout.ts` 增量合并后）：本轮实测过（在 `fresh.sizes`）但未产出
  多行 `lineOffsets` 的块，删除其旧 `lineOffsets` / `lineSizes` / `lineMainSizes`——收缩到单行的块不再被虚报行数；
- **越界外推而非回退块首**（`selection-bridge.ts` 的 `charOfLine`）：行号超出实测行数时按平均
  行宽向前外推（`last + (line - lastIdx) * avg`），使起点落在块尾之后 → 幽灵续排片段自然为空；
- 已有「三表裁剪」只删**已消失块**的陈旧项，本条补上**仍存在但已收缩块**的清理，两者互补；
- 回归用例：`packages/vue/src/__tests__/paged-bridge.test.ts`（`charOfLine` 越界外推）；
- **验证限制**：收缩块清理依赖真实多行实测，happy-dom 无布局（`measureLineOffsets` 恒返回 `[0]`）
  → `buildPagedLayout` 层需在浏览器 / demo 复现，纯函数 `charOfLine` 外推可脱离 DOM 单测。

## 9. 中文输入时“自动排版”→ 光标移位 + 页尾重复

**现象**：与第 8 条同样表现为跨页重复，但触发不同——**连续中文输入**时“感觉会自动排版”，
光标跳位；若光标在页尾（段落正好跨页），未完成的组合文本在页底片段与页顶续排片段两处重复。

**根因**（去抖重排与 IME 组合的竞态）：重排是去抖的（连续键入 `TYPING_DELAY = 400ms`）。上一笔
`compositionend` 提交后 `scheduleRelayout` 挂起 400ms 定时器；若用户在定时器到期前**开始了下一次
组合**，重排就会在**组合进行中**落地：`buildPagedLayout` 重新切片→`v-html` 重建了 IME 正在输入的片段
 DOM，`restoreCaretFromModel` 又抢回光标（模型里还没这笔组合文本）→ 浏览器把孤儿组合落到位移后的
光标处 → 页底 / 页顶两处重复。

**处理**（组合期间冻结重排）：

- `PagedCanvas` 新增 `composition` 事件：`compositionstart` 上抛 `true`、`compositionend` 在**落模之后**
  上抛 `false`（顺序关键：补排需读到已提交的组合文本；且无论是否命中落模都要发出，避免永久冻结）；
- `BtEditor` 用 `pagedComposing` ref 承接，传入 `usePagedLayout({ composing })`；
- `use-paged-layout.ts`：`runLayout` 开头若 `composing.value === true` 则**只暂存最新一次请求**
  （`deferredWhileComposing`）并返回，不重建 pages；`watch(composing, …, { flush: 'sync' })` 在转
  false 时补排那一轮。因 pages 组合期间不变，`PagedCanvas` 的 `watch(props.pages)` 也不会抢光标。
- 回归用例：`packages/vue/src/__tests__/paged-layout.test.ts`（“IME 组合期间冻结重排，组合结束后补排”）。

## 10. 分页编辑态下工具栏命令“无效果 / 错位 / 跳页”

**现象**（paged 编辑态，PM 整文档视图被 `v-show` 隐藏、编辑经片段桥落模）：

- 「引用 / 无序 / 有序 / 版框 / 表格 / 边注」点了像没反应；「双行注 / 校勘记」要连点很多次才能输入；
- 「出校符号」并非总落在光标处，常在光标前后几个字符，带随机性；
- 「鱼尾」插入后接着打的字有时竖排有时横排；
- 一些命令点了会把视口挪到当前页前后几页（说明里没有，疑似 bug）。

**根因**（三条，都在“命令走 `binding.execute` 而片段编辑走 PagedCanvas 内部”这条分界上）：

1. **命令后不还原光标**：片段打字 / 组合 / 粘贴会在 `PagedCanvas` 内置位 `restorePending`，重排后按
   模型选区还原 caret 与焦点；但工具栏命令只改模型 + 移动 PM 选区，不经过这套流程 → 重排 `v-html`
   重建了含光标的片段、焦点丢失 → 无法进入新容器打字。引用 / 列表是**切换**命令，用户以为没反应
   再点一次又切回去，净零；容器插入（双行注 / 校勘记 / 表格 / 版框 / 边注）则表现为“点很多次才勉强能输入”。
2. **选区同步 rAF 滞后**：片段选区 → 模型经 `selectionchange` 的 rAF 去抖落模。移动光标后**立即**点按钮，
   模型 `state.selection` 可能落后 DOM 光标几个字符 → 命令（如出校符号在 `selection.from` 处替换）落点随机偏移。
3. **隐藏视图 `scrollIntoView` 乱滚**：多数命令事务带 `.scrollIntoView()`。连续画布下它滚动可见视图正常；
   paged 下 `binding.execute → applyTransaction` 仍对**隐藏的 PM 视图** `updateState`，隐藏视图的 scrollIntoView
   把外层滚动容器滚到（尺寸全 0 的）坐标 → 视口莫名跳到前后几页。

**处理**：

- `use-editor.ts` 新增 `syncView?: () => boolean` 门控：`applyTransaction` 仅在其为 `true` 时 `view.updateState`。
  `BtEditor` 传 `syncView: () => !pagedActive.value` —— paged 态根本不触碰隐藏视图，乱滚消除（与片段编辑
  既有的 `refresh({ skipViewSync })` 口径统一）；切回连续画布时 `watch(pagedActive)` 补一次全量 refresh。
- `PagedCanvas` 暴露 `flushSelectionSync()`（取消挂起 rAF、立即把 DOM 选区落模）与 `requestCaretRestore()`
  （置位 `restorePending`）。
- `BtEditor` 用 `runPagedAware` 包装透传给插槽的 `execute / undo / redo`：paged 态下**先 flush 选区 → 执行命令
  → 成功后 requestCaretRestore**。重排后光标随模型选区确定性落回正确片段（命令把选区移入新容器 → 光标进容器可打字；
  命令不移动选区（如鱼尾 `embedParagraph=false`）→ 光标留在原块 → 输入方向随目标块样式，不再随机）。
- **落点语义不变**：眉批 / 跋文等仍插在“当前叶块之后”（命令契约如此，连续 / 导出一致）；其在**版心外**
  （页眉 / 书末）的视觉落位是分页渲染的后续特性，paged 编辑态当前按块顺序成行显示，非回归。
- 回归用例：`packages/vue/src/__tests__/editor.test.ts`（“syncView 返回 false：跳过视图同步”）。
- **验证限制**：光标还原 / 片段焦点 / scrollIntoView 均依赖真实布局与真实焦点链，happy-dom 无布局引擎，
  `buildPagedLayout` 与浏览器层需在 demo 手工确认；纯函数 `syncView` 门控可脱 DOM 单测。

## 11. 选区转换为容器后出现重复 id / 定位错乱

**现象**：把选中文字转为双行注、眉批等容器后，保存 / 重载或分页锚点出现**重复 id**，跳转定位串位。

**根因**：ProseMirror `tr.split` 会把原块 attrs（含稳定 `id`）复制到拆分出的两半。若先 `split`
再包容器，就会产生两个同 id 的块；后续按 id 定位（分页、目录、协同）无法区分。

**处理与排查**：

- `replaceSelectionWithContainer` 改为手工 `Fragment.cut` + `tr.replaceRange`，**不做 `tr.split`**，
  从源头避免 attrs 复制；
- id 归属规则：原 textblock 的 `id` 保留给**文档序第一个存留片段**（前段 → 容器内段落 → 后段），
  其余拆分片段 `id: null`；新建容器 `id: null`，由路径 id 兜底；
- 排查口诀：转换后遍历文档收集 `attrs.id`，断言集合无重复；
- 回归用例：`packages/editor/src/__tests__/selection-convert.test.ts`（「id 各自保留且不重复」）。

## 12. 选中文字后「替换为」菜单不弹 / 位置错 / paged 下命令后光标丢失

**现象**：明明选中了文字，选区旁却没有【替换为】菜单；或菜单出现在视口左上角；或 paged 态点了
「双行注」后重排完成却无法继续输入。

**根因**（三条，横跨模块边界与 paged 视图）：

1. 用 `instanceof TextSelection` 判定选区：跨包 / 跨模块实例时 `prosemirror-state` 可能被重复解析，
   `instanceof` 失效 → 菜单误判为「非文本选区」直接隐藏；
2. 用 `view.coordsAtPos()` 定位：paged 态 PM 整文档视图被 `v-show` 隐藏，隐藏元素的坐标全为 0，
   菜单被放到左上角；
3. 菜单执行用了原始 `useEditorBinding().execute`：绕过 paged 的「先 flush 选区 → 执行 → 重排后
   按模型选区还原光标」，重排重建片段后焦点丢失。

**处理与排查**：

- 选区判定改用**结构判断**：`!selection.empty && selection.$from.parent.isTextblock`，
  不依赖 `instanceof`；
- 定位优先 `window.getSelection().getRangeAt(0).getBoundingClientRect()`（连续画布与 paged 片段
  都能拿到真实可见矩形），取不到再回退 `coordsAtPos()`；
- 菜单必须挂载在 `BtEditor` 插槽内、并把**插槽作用域的 `binding`** 传给 `BtSelectionReplaceMenu`；
- 回归用例：`packages/vue/src/__tests__/selection-replace.test.ts`（显隐 / 点击执行 / 只读 / 定位）。

## 13. 插入表格后一片空白 / 分页后表格消失

**现象**：点「表格」后编辑画布只有一片空白；或阅读、预览、导出分页后表格不见了。

**根因**（两层，常同时出现）：

1. 表格节点没有显式 `toDOM`，`withDefaultNodeDom` 把它兜底成
   `div.bt-table > div.bt-table-row > div.bt-table-cell`。浏览器不会对嵌套 `div` 建立表格布局，
   编辑态看起来就是空白；
2. `extractBlocks` 把表格逐层下钻，块序列只剩单元格段落；分页 / 序列化时丢失 `<table>` 包裹，
   页面上自然没有表格。

**处理与排查**：

- `packages/editor/src/schema-registry.ts` 的 `semanticDomShape`：表格三件套输出
  `<table class="bt-table"><tbody>…</tbody></table>` / `<tr>` / `<td>`，并保留 `data-bt-id`；
- `packages/reader/src/document-blocks.ts`：`table` 加入 `COMPOSITE_ATOMIC_TYPES` 与
  `ATOMIC_BLOCK_TYPES`，`isLeafBlock` / `isLeafBlockTypeName` 对表格返回 `true`，整块序列化；
- 排查口诀：编辑态看 DOM 是否是 `table/tr/td`（不是 `div.bt-table-*`）；分页后看页面 HTML
  是否含完整 `<table>`；
- 回归用例：`packages/editor/src/__tests__/commands.test.ts`（语义 DOM）、
  `packages/reader/src/__tests__/document-blocks.test.ts`（表格整体成块）。

## 14. 直排下表格按钮置灰 / 表格不可见

**现象**：切到直排（竖排）后表格按钮不可用，或插入后看不到表格。

**根因**：旧版表格既没有语义 DOM，也没有直排样式；空单元格没有最小尺寸，直排下容易塌成一条线；
若工具条再按书写方向禁用，就会表现为「表格仅支持横排」。

**处理与排查**：

- 表格按钮**不按书写方向禁用**，横排 / 直排同一入口；
- `.bt-table { writing-mode: inherit }` 让单元格文字随书写方向竖排；
- `.bt-table-cell` 增加 `min-inline-size` / `min-block-size`，空单元格仍保留可点击 / 可测量面积；
- 表格是复合原子块，直排下整体占一页；列数很多的宽表可能超出页宽，建议减小尺寸（后续可做
  横排旋转 / 转图片等增强）。

## 15. 切到「古籍仿真直排」后分页变了 / 换模板页数不同

**现象**：套用仿真模板后总页数变化，或换一个模板行款、页数都不一样。

**根因**：仿真版式里**只有版心带宽**参与排版——它从直排主轴（页宽）中扣除
（`resolvePageMainSize`），因此带宽不同 → 每半页行数不同 → 页数不同。版框线宽、
界行颜色、纸纹都画在页边距内，不影响分页（也不进度量签名）。

**处理与排查**：

- 这是预期行为，不是 bug；行款（每半页 N 行 × 每行 M 字）由模板参数推导，
  设置面板「古籍仿真」底部有实时回显；
- 只想换观感（框线 / 朱丝栏 / 纸色）时，改颜色类令牌不会重排；
- 手改带宽会触发一次重排，属正常；
- 若改字号 / 行距 / 页边距，行款与页数都会变——模板只是起点。

## 16. 古籍仿真模板与 `page-border` 同时存在会怎样

**现象**：手动给仿真版式加了 `page-border`，出现双框或版心偏移。

**根因**：`page-border` 是页面元素自身的 `border`，会侵占版心并被分页扣减；
仿真版框是画在页边距内的装饰图层。两者语义冲突。

**处理与排查**：

- 启用 `facsimile` 时，`page-border` 的**绘制与扣减成对失效**（不会双框、不会口径不一致）；
- 仿真模板一律不写 `page-border`；需要改框线请用 `page-frame-color` / `page-frame-width`；
- 切回「古籍直排」后 `page-border` 照旧生效，古典视觉与改造前一致。

## 17. 直排下把分栏设为 2 / 3，文字方向不对（不是「古籍的列」）

**现象**：直排 + `columns: 2` 时期待页面出现左右两栏（古籍「列」的感觉），实际排版异常。

**根因**：CSS 多栏沿 **inline 轴**堆叠。`vertical-rl` 的 inline 轴是纵向（自上而下），
所以多栏会把「栏」上下堆叠，而不是左右并排——这与古籍版式的「列」不是同一回事。

**处理与排查**：

- 直排请保持 `columns: 1`；古籍的「列」由字号 × 行距自然形成，需要「半页 N 行」的
  精确行款请用古籍仿真直排的模板与 `resolveFacsimileGrid`；
- 仿真模板固定单栏，设置面板也不会给出直排多栏入口；
- 该行为在引入仿真能力前即存在，非回归。

## 18. 书架升级后卡片没有封面 / 字数 / 进度

**现象**：已有书库打开新书架，卡片字段空白，但没有报错；新建的书一切正常。

**根因**：`DocumentSummary` 只**追加可选字段**，旧记录没有 `author` / `tags` /
`coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`。读取侧必须走
`mergeDocumentSummary` 回退，数据库本身不重写旧记录（也不需要升版本）。

**处理与排查**：

- 不要给 `StorageAdapter` 加必选方法，也不要假设 `query()` 一定存在——先 `isBookLibraryStore` / `isBookSummaryStore` 探测；
- 字数只在**下一次 `save`** 时由 `countDocumentStats` 写入，旧书需重新保存一次才有；
- 进度 / 最近阅读由宿主在打开书时 `updateSummary`（HTTP 适配器无此端口，只能整本 `save`）；
- 若整个书架空白且 `error` 有值，先看是否为加密库（见第 20 条）。

## 19. 导出后修订标记还在（或反过来，编辑器里看不到删除线）

**现象**：EPUB / PDF / 站点导出里仍带删除线；或编辑器里明明开了修订却没有痕迹。

**根因**：修订投影发生在**序列化边界**，不是编辑器内部。序列化器缺省 `revisionView: 'marked'`，
三个导出器缺省 `'final'`；编辑器内部文档始终保留标记与原文。

**处理与排查**：

- 需要「带修订标记版」交付时显式传 `{ revisionView: 'marked' }`（EPUB / PDF / 站点导出选项同名）；
- 编辑器里没痕迹：确认 `createRevisionTrackingPlugin` 已加入插件列表、`setRevisionMode(true)` 已派发；
- 删除内容「消失」不是丢数据：它在 `deletion` 标记里，切到「标记 / 原稿」视图可见；
- 拒绝格式变更后样式不对：`format-change` 的 `previous` 是**完整标记快照**，不要手工拼接。

## 20. 开启加密后书架只剩占位标题 / 提示口令错误

**现象**：`list()` 返回的标题都是占位文本；换口令后报 `WRONG_KEY`；或提示载荷不是密文。

**根因**：加密态文档的摘要无法从密文解出，`list()` 只能给占位标题，因此加密适配器
**不实现** `BookLibraryStore`。混合状态（同一库里既有明文又有密文记录）读取会明确报错。

**处理与排查**：

- 书架需要真实标题时先解锁，再用解密后的适配器查询；
- `WRONG_KEY` 不会破坏数据，直接重试；`CORRUPT_PAYLOAD` 说明记录被改写或来自未加密版本，
  提示用户关闭加密或从备份恢复；
- 加密与脱敏是两件事：加密保存储，导出前仍需 `redactDocument` / `redactAnnotations`；
- 注记用独立密钥时，正文解锁不代表笔记可读（见 [24 标注](24-annotation.md)）。

## 21. 备份导入只成功了一部分 / 回滚被拒绝

**现象**：导入结束提示「成功 18、跳过 1、失败 1」；或点回滚后提示校验失败。

**根因**：恢复是**逐书校验、单本失败不中断整批**；回滚前要做校验和 + `validateDocument` 双检，
任一失败就拒绝返回文档，避免坏快照写进书库。

**处理与排查**：

- 失败清单里的 `code` 指向具体原因（坏包 / 版本不支持 / IR 非法 / 缺资产），按条重导即可；
- 同 id 冲突先确认策略：`merge` 保留较新、`overwrite` 以备份为准、`keep-both` 生成 `<id>-copy` 副本；
- 回滚被拒时**不要**直接写 `save`：先看 `restoreSnapshot` 返回的 `code` 与 `message`，
  必要时从 `.btbook` 重新导入；
- 保留策略非法（`maxCount < 1`、两个条件都不给）会抛 `RangeError`，这是防误清历史的保护。

## 22. SQLite 适配器报「没有驱动」/ 事务没生效

**现象**：`new SqliteAdapter({ driver })` 之后所有操作都报错；或以为 `close()` 会关库；
或批量写入失败后留下半份数据。

**根因**：适配器**不安装任何 SQLite 引擎**，`driver` 必须由宿主传入包装好的端口；
`close()` 刻意不关闭宿主驱动（生命周期归宿主）。

**处理与排查**：

- Electron / Node：宿主装 `better-sqlite3`，用 `createBetterSqliteDriver(new Database(path))`；
  浏览器 / 测试：装 `sql.js`，`createSqlJsDriver(new SQL.Database())`；
- 打包器把 `better-sqlite3` 打进 renderer 会失败：数据库只能放主进程 / worker，
  通过 IPC 暴露查询，或改用 sql.js；
- 事务没生效：`driver.transaction` 不支持嵌套（嵌套直接抛错），所有写入放进同一个回调；
- 半份数据：检查是否走了 `transaction`；单条 `run` 之外的多步写入都不具备原子性；
- `clear()` 后资产 / 历史还在是**预期**：只清文档与片；`close()` 后仍可继续读写也是预期。

## 23. 协同重连后出现重复段落 / 连不上

**现象**：断网恢复后同一段内容出现两次；或一直 `connecting` / 反复断开；或换版本后
客户端连不上服务端。

**根因**：更新必须走 Yjs 合并（幂等）；协议版本不一致会被服务端拒绝且**不重试**；
握手超时（缺省 10s）按连接失败处理。

**处理与排查**：

- 重复内容：确认离线期间没有把「全量 `encodeStateAsUpdate`」和增量同时当普通文本写回文档，
  只应交给 Yjs `applyUpdate`；离线队列超限会自动改发全量，这是兜底不是重复发送；
- 连不上：看 `provider.diagnostics.lastError`；`PROTOCOL_MISMATCH` 说明客户端 / 服务端
  `COLLAB_PROTOCOL_VERSION` 不一致，升级两端而不是调大退避；
- 反复重连：检查服务端是否在 `join` 前就要求鉴权、以及 `maxReconnectAttempts` 是否触顶；
- 多标签不同步：`BroadcastChannel` 需要同源同频道名，且 `connect()` 后才会发 `hello`；
- 手动 `disconnect()` 不重连是预期行为，需要恢复请再调 `connect()`。

## 相关

- 核心运行时与三层注册：[13 核心运行时](13-core-runtime.md)
- 编辑器与规格注册：[02 编辑器与插件](02-editor-and-plugins.md)
- 阅读与版式：[04 阅读器与分页](04-reader-and-pagination.md) · [05 版式与 HTML](05-layout-and-html.md)
- 导出与存储：[08 PDF 与打印](08-export-pdf.md) · [10 存储适配器](10-storage-adapters.md)
- 环境要求：[15 SSR 与 Node 同构](15-ssr-and-node.md)
