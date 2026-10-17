# 项目长期约定（bibliotype）

## 编辑 / 保存链路（性能红线）

- **禁止在逐键路径调用 `BookEditor.getDocument()`**：它是 O(全文档) PM→IR 转换（实测 78 万字
  / 12623 块 ≈ 4.8 ms/次 + 等量对象分配）。高频路径一律用 `getSharedDocument()`（PM 结构共享，
  O(变更子树)，≈ 0.02 ms）。`BookEditor.emitChange()` 已按此口径广播，订阅方拿到的快照
  **视为只读**（未变子树与上次快照同引用），禁止原地修改。
- **落盘永不落在输入帧上**：`IndexedDbAdapter.save` 自 v2 起是**分片增量写**（骨架 `*-meta` +
  片 `*-chunks`，只写引用变化的那几片），不再整本 `put`；但**仍必须排队**——策略用
  「节流合并 + 后台调度（`scheduler.postTask({priority:'background'})` 优先，回退
  `requestIdleCallback` 且只在 `timeRemaining()>8` 时写）+ 单飞去重 + 上限兜底」
  （delay 2500 / maxWait 30s / idleTimeout 8s），参考 `apps/demo/src/composables/use-draft-autosave.ts`。
- **分片增量依赖 IR 引用共享**：`save` 必须收到 `getSharedDocument()` 的快照；用 `getDocument()`
  会让所有 IR 节点变成新对象 → 增量判定失效、退化为整本重写。
- **快照与保存基准必须同一同步帧**：取快照后立即 `markSaved()`，再 `await` 写库；否则 await 期间的
  新编辑会被误标「已保存」。写失败要保留脏标记并定时重试。
- **改包源码后 demo 不生效**：demo 从各包 `dist` 消费，须先 `pnpm --filter <pkg> build`。

## 性能排查方式

- 先用最小复现量出数字再改代码。可用脚本骨架：构造 N 段落 IR → `new BookEditor` → 订阅 `onChange`
  → 循环 `dispatch` 计时；对比「无订阅者」基线判断成本归属。
- Node 22 可直接跑 TS 校验脚本：`node --experimental-strip-types <file>.ts`（脚本内相对导入需写
  `.ts` 后缀）。适用于 demo 层（无 vitest）的组合式函数行为验证。
- 纯 Node 脚本里跑依赖 DOM 的包（import / import-epub 等）：旁路引 happy-dom
  （`import('file:///<repo>/node_modules/.pnpm/happy-dom@<ver>/lib/index.js')`）→
  `new Window()` → 把 `window/document/Node/Element/HTMLElement/Text/DOMParser/XMLSerializer` 等注入
  `globalThis` → **再动态 `import()` 业务包**（静态 import 会被提升，注入来不及）。

## 量尺与分页

- `extractBlocksIndexed` 的块序列与块 id 只由 IR 结构决定（`blockSizes` / `lineOffsets` / `lineSizes`
  仅影响尺寸字段），故同一文档的结构抽取结果可跨轮复用（`measurePagination` 的 `extracted` 入参）。
- **增量分页**（`paginate(blocks,{resume:{prefix,startIndex}})`）只在 `targetBlockId` 定点路径启用：
  流式贪心下「某页只由它之前的块决定」→ 前缀页原样复用，从目标块所在页的页首续排。
  **坑**：页首必须是「本页第一个片段」，若该片段 `fromLine>0`（上一块的续排部分），必须退到
  **该片段的块所在起始页**，否则会丢掉本页上半段（实测表现为后续全部分页错位）。
  与全量重排结果必须逐片段一致（`paged-layout.test.ts` 有对照用例）。
- 定点路径的首次结构抽取要喂上一轮实测尺寸表（`prev.sizes/lineOffsets/lineSizes`），否则每轮
  都会对全文档跑 estimator（78 万字文本扫描），这是「定点只测一块」之外的另一半收益。

## 字符坐标轴（模型轴 vs DOM 轴）

- **模型轴**（权威口径）：`reader.collectNodeText` / `layout` 的 `nodeTextLength` —— 只拼文本子节点，
  **不含** mark 的 `attrs.text`（如 ruby 注文），也不含任何元素载体的「文本长度 0」。
- **DOM 轴**：`html-serializer` 把 ruby 渲染为 `<ruby>基字<rt>注文</rt></ruby>`，`<rt>` 是真实文本节点
  → DOM 轴比模型轴多出注文长度。
- **红线**：凡把 DOM 文本折算为模型字符偏移的地方，必须跳过注文子树（`<rt>` / `<rp>`），统一用
  `packages/vue/src/ruby-annotation.ts` 的 `isRubyAnnotationElement` / `isRubyAnnotationText`。
  已知使用点：`paged-editor/input-router.fragTextNodes`、`pagination-measure.collectTextOffsets`
  （后者的 `lineOffsets` 同时喂 `sliceNodeByCharRange` 切片与选区映射，口径错了切片与选区一起错）。
- CSS 伪元素（如 `.bt-collation-mark::after` 的 `content`）不是 DOM 文本节点，不污染字符轴；`<rt>` 会。
- 症状速查：同段落选中内容之前有注音时，行内标记落点 / IME 插入 / 光标还原整体右移，偏移量
  = 该位置之前的注文字数。
- 验证限制：`lineOffsets` 依赖真实布局（`getClientRects`），happy-dom 无布局引擎 → 单测覆盖不到，
  需在浏览器 / demo 手工确认。

## EPUB 导出红线（兼容严格的 RMSDK 内核）

- **XML 格式良好是硬约束**，且只能在**序列化出口**兜底：`happy-dom` / `@xmldom/xmldom` **不校验 XML 合法性**，
  导入侧会把 U+000B / U+0007 / U+0001 原样写进 IR（只有 U+000C 因被 HTML 当空白折叠而消失）。
  所以净化统一走 `packages/layout/src/html/html-serializer.ts` 的 `escapeXml`（先 `stripInvalidXmlChars`
  再转义实体）；`escapeHtml` 已委派给它，序列化器内部调用点（text / data-attrs / img src / ruby `<rt>` 等）
  自动受益。**新增 XML 模板一律用 `escapeXml`，不要再写裸 `escapeHtml` 语义的转义。**
- **非法字符区间刻意不含代理对**（emoji 由高/低代理组成，若一并剥离会把 emoji 打成乱码）；`#x9/#xA/#xD`
  也放行。
- **EPUB 版本策略：保守 2.0 + `toc.ncx`**（`epub.ts` 的 `epubVersion` 硬编码 `'2.0'`），不写 `<meta property>`、
  不给 nav 挂 `properties="nav"`、不用 HTML5 doctype —— 京东读书等 Adobe RMSDK 无法本地验证，勿擅自升级 3.0。
- **导入型扁平书没有结构节点**（volume/chapter…），`buildNavItems` 因此补了第二个来源：顶层 heading
  level ≤ 2（`MAX_NAV_HEADING_LEVEL`），无 id 者由 `planDocument` 预分配 `bt-a-N` 锚点注入 XHTML；
  改动此处务必保证 demo 型（有 SECTION_TYPES）行为不变。
- **图片：`import-epub` 的 `inlineImages` 默认 true**（包内图片按 OPF manifest 的 media-type 内联 data URI，
  外链/缺失/>2 MB 跳过）——不同于 docx（`mammoth` 默认 false）：docx 插图多带外链，epub 插图是独立文件，
  不内联导出后就是死链。**导出侧至今仍不打包媒体**（`OEBPS/media/*` 未做，见 `功能完善增改清单.md` §2.2）。

## 已知缺陷 / 第三方 API 陷阱（分析结论，修复前不得「想当然」）

> 详见仓库根 `编辑次工具栏-功能失效分析.md`（含完整实测矩阵与探针原始输出）。

- **`Node.cut()` 返回同类 Node，不是 Fragment**（`prosemirror-model` 类型声明 `Node.cut(from,to): Node`）。
  想拿一段「行内内容碎片」必须用 `Fragment.cut`，即 `paragraph.content.cut(relFrom, relTo)`；
  写成 `paragraph.cut(from,to)` 会把整个 `<paragraph("…")>` 当内容传出。
- **`Selection.content()` 默认 `includeParents=true`** → 切片根是块级祖先
  （`doc.slice(from,to,true)` → `children=["chapter"], openStart=2`）。**行内节点包裹命令绝不能直接拿它当内容**：
  `packages/editor/src/commands.ts` 的 `insertInlineNodeWrapping` 现就是这么写的 → 夹注 / 异体载体 /
  避讳载体在「选中文字」时必抛 `Invalid content for node <type>: <chapter(paragraph(...))>`，
  且因抛在 `dispatch` 之前而**完全无反应**（异常 → 无事务 → `version` 不自增 → 不重排）。
- **prosemirror 1.25 起 `Node.hasMarkup(type, null)` 不再短路**（改为与 `type.defaultAttrs` 比较，
  见 prosemirror-model dist `hasMarkup`）。后果：`prosemirror-commands.setBlockType(type)` /
  `Transform.setBlockType` 最终执行 `type.create(attrsHere, null, node.marks)`，**attrsHere=null →
  节点属性整体归默认** → 用 `setParagraph()` / `setHeadingLevel(n)` 会把块 **`id` 清空**
  （实测 `irId p-1 => undefined`）。自定义「改块类型」命令时须显式保留 `id`
  （`{...node.attrs, ...patch}` 或 `tr.setNodeMarkup`）。`wrapIn`（如 `toggleQuote`）不受影响。
- **IR 属性输出规则**：`schema-registry` / `pm-to-ir` 对「等于 spec 默认值」的属性**省略不输出**。
  因此**兜底默认值必须与 spec 默认一致**：heading spec `level.default = 1`，而
  `html-serializer` 缺省回退 **2** → **H1 经 IR 往返后渲染 / 导出成 `<h2>`**（H2/H3 正常）。
- **`book-css.ts` 样式覆盖存在空洞**（序列化产物有 class，但没有对应规则 → 插入后不可见）：
  `.bt-seal`（印文只在 `attrs.text`，元素为空）、`.bt-fish-tail`、`.bt-border-frame`、`.bt-inline-note`、
  `.bt-variant-char`（注意 `.bt-mark-variant` 有、载体没有，**不对称**）、`.bt-tail-note`（只出现在
  后代选择器里，无基样式）。已覆盖的：double-note / head-note / collation-note / imprint / colophon /
  footnote / endnote / margin-note / collation-mark（`::after{content:attr(data-symbol)}`）/ taboo-char。
- **分页落模丢标记继承**：`packages/vue/src/paged-editor/edit-applier.ts` 的 `applyFragmentEdit` 用
  `state.schema.text(text)`（无 marks）→ 点标记后打字 / 在已标记文本中间打字都不继承（PM 原生
  `insertText` 会继承 `storedMarks || $from.marks()`）。
