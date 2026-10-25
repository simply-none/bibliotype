# @bibliotype/editor

## 26.10.25-rc.1

### Minor Changes

- 编辑能力补全：新增内容命令 `insertMathBlock` / `insertMathInline` / `insertRuby`（选区注音或插入带注音文字）/ `insertFigure`（图片 + 图注块组）/ `insertHorizontalRule`（末块自动补空段落），并导出 `PLACEHOLDER_IMAGE_SRC`、`HORIZONTAL_RULE_VARIANT`、`FigureOptions`；查找替换支持正则 / 整词 / 范围限定 / 结果上限，新增 `findNextMatch`、`replaceMatch`、`buildSearchRegExp`、`escapeRegExp` 与 `EditorSearchOptions`（`findTextMatches` 三参重载保持兼容）。
- 编辑命令与行为层大幅补全：新增通用属性修改命令 `setNodeAttrs` / `setMarkAttrs`（基于 `setNodeMarkup`，含 `rawAttrs` 合并）；补齐插入 / 结构 / 表格命令（`insertBlockOfType` / `insertStructureBlock` / `insertInlineNodeWrapping` / `insertAtomicNode` / `insertImage` / `insertCodeBlock` / `insertTable` 及 `tableAddRow` / `tableAddColumn` / `tableDeleteRow` / `tableDeleteColumn`、常量 `STRUCTURE_BLOCK_TYPE_NAMES`）、`toggleOrderedList` / `setLink` / `unsetLink` / `toggleMarkByName`；新增编辑态查找替换 API（`findTextMatches` / `selectRange` / `replaceSelectionWith` / `replaceAll` 与 `TextMatch` 类型）与粘贴增强（`looksLikeMarkdown` / `parseInlineToNodes` / `markdownToNodes` / `markdownToFragment` 及 `createPasteMarkdownPlugin` / `buildPasteSlice`，HTML / Markdown → IR）；`BookEditor` 增补 `updateMetadata` 与只读（editable）支持。
- 新增 Markdown 快捷输入（input rules）：块首输入 `# ` / `> ` / `- ` / `1. ` / ` ```ts ` / `---` 即转换为标题、引用、列表、代码块与分隔符（保留块 `id`，分隔符位于末块时自动补空段落承接光标）；`createInputRulesPlugin` 以 `appendTransaction` 实现，无 `EditorView` 的 `BookEditor` 同样生效，并支持按种类关闭（`headings` / `quote` / `lists` / `codeBlock` / `horizontalRule`）；同时导出纯函数 `matchInputRule` / `applyInputRules` 与 `INPUT_RULE_KINDS` 等类型，默认插件集 `createBookEditorPlugins` 纳入该插件。
- Markdown 解析支持脚注语法：引用 `[^label]` 转为正文上标 + `noteref` 标记（`targetId` / `refId`），定义 `[^label]: 注文` 转为紧跟首次引用段落的 `footnote` 块；支持折行定义合并、同一标签多次引用（锚点递增、注文只插一次）、未引用定义落文末、未定义引用保留字面、围栏代码块内不解析。`looksLikeMarkdown` 同步识别脚注特征。
- 新增 `replaceSelectionWithContainer`：把选中文字转换为块级 / 行内容器（「替换为」）。块级目标按选区切分前后段落、删除空片段、原 id 保留给文档序第一个存留片段（其余置空，避免 `tr.split` 复制 attrs 造成重复 id），容器内文本块默认规范化为段落；行内目标复用 `insertInlineNodeWrapping`。支持 `dropEmptyFragments` / `idOwner` / `insertWhenEmpty` / `normalizeTextblocks` 选项，整个转换在单个 transaction 内完成，一次撤销整体还原。
- 优化「编辑 → 保存」链路，大文档编辑不再掉帧：
  
  - **`@bibliotype/editor`**：变更广播改用共享 IR 快照（`getSharedDocument()` 口径，O(变更子树)），逐键事务不再做全量 PM→IR 转换——实测 78 万字 / 12623 块文档单次广播 5.0 ms → 0.7 ms（其中全量转换部分 4.8 → 0.02 ms）。**行为收紧**：`onChange` 回调参数为共享只读快照，未变子树与上一次快照复用同一引用，不得原地修改（需独立可变副本时使用 `getDocument()`）。
  - **`@bibliotype/vue`**：`measurePagination` 新增可选入参 `extracted`（复用调用方已抽好的块序列与节点索引），`buildPagedLayout` 每轮重排的全树抽块由三次降为两次（78 万字文档省约 6 ms/轮）。
- 新增目录生成 / 刷新：`insertToc`（按卷 / 章 / 节等结构节点生成 `toc` 块，标题行与条目带 `toc-title` / `toc-entry` / `toc-subentry` 版式角色与锚点链接；已存在目录时原位替换内容并保留 id，支持 `maxLevel` / `includeHeadings` / `links` / `hrefPrefix` / `title`）、`collectTocEntries`（文档先序收集条目，跳级层级收敛为父级 + 1）与 `buildTocNode`（由条目构造目录节点）。
  
  `layout` 的 `book-css` 补目录链接规则：`.bt-toc .bt-mark-link` 跟随目录版式，不另加颜色与下划线。
- 字图内联（K6）：「用图片顶替缺字」的块级图片归入文字流，阅读 / 分页 / 编辑 / 导出四链天然一致。
  
  - **core**：新增 `NODE_TYPES.GLYPH_IMAGE`（`'glyph-image'`，`kind:'inline'` 行内原子节点，与 `math-inline` 同层；attrs `src` / `alt` / `char` / `width` / `height`）与 `normalizeGlyphImages(document, options?)`——导入边界一次归一化：识别出字图特征的块级 image（排除项：与图注配对、宽或高超 `maxGlyphPx`（缺省 64）；强信号：alt ≤ `maxAltChars`（缺省 2）字、近方形小尺寸（宽高比 `aspectRange` 缺省 0.6~1.6）；弱信号：src 命中 `srcHints`、png / svg / gif 扩展名、**内嵌位图 data URI**（docx / epub 主流形态，无 alt 无尺寸）与**位置信号**（前段未收尾 = 切断句子，插图几乎不在句中；仅对该图无任何尺寸元数据时计入）；判定 = 无排除且（强信号 ≥1 或弱信号 ≥2），仅单弱信号保守保留不丢数据），归并按文档序：`auto` 且两侧都是段落、前段未收尾 → **前段 + 字图 + 后段三合一复原**被切断的同一句话（`position: 'restore'`）；前段收尾缝后段头（`'next-start'`）；字图在容器末尾缝前段尾（`'prev-end'`）；强制 `merge: 'auto' | 'prev' | 'next'` 中 prev / next 只缝单侧不复原，返回 `{ document, report }`，原档 structuredClone 不可变；配套 `summarizeGlyphImageReport` / `DEFAULT_GLYPH_IMAGE_OPTIONS` 与 `GlyphImageReport` 等类型。
  - **editor**：classical schema 注册 `glyph-image`（group `inline`、`inline` + `atom`，attrs `src` / `alt` / `char`；parseDOM `img.bt-glyph-image`，toDOM 同 class 回吐），渲染产物可无损回编辑器；`image` 的 `img` 通配对 `bt-glyph-image` 让位（返回 `false`），行内字图不再被 PM 从段落 slicing 出来独立成块。
  - **layout**：序列化器支持 `glyph-image` → `<img class="bt-glyph-image" … />`（src 走 `rewriteSrc`、`data-char` 空省略，与 image 同规）；书册样式新增 `.bt-glyph-image`：`display:inline-block` + **1em 硬限幅**（`width` / `height` / `max-width` / `max-height` 均 1em，原图再大也不超两侧文字的高 / 宽）+ `object-fit:contain` + 基线下沉 `0.15em`（与 `.bt-glyph` 同款口径）；直排（`writingMode` 竖排）构建期追加 `transform: rotate(90deg)`——img 不随 writing-mode 旋转，1em 方形旋转后占位不变；classical CSS 基线哈希同步更新。
  - **分页 / 量尺零改动**：字图是段落行内子节点，随段落实测行盒进 `lineMainSizes`（不等行高既有支持）；跨页切片对零文本 inline atom 按位置整体归属（`math-inline` 先例同口径），不丢图不错位。
  - demo 宿主侧（私有包）：`ImportPanel` 五种格式导入统一在收口处过 `normalizeGlyphImages`，状态行展示摘要（「已将 N 张缺字图归入文字流；M 张按插图保留」）。
- 注释（脚注 / 尾注 / 边注）端到端补齐：
  
  - `core` 新增注释节点公共契约 `NOTE_NODE_TYPES` / `NOTE_ROLES` / `isNoteNodeType` / `isNoteNode` / `noteRoleOf` / `NOTE_LABEL_STYLES` / `formatNoteLabel` / `collectNotes` / `nextNoteIndex`（按类型分别编号，手写 `attrs.marker` 优先）；`document-stats` 复用同一类型表。
  - `editor` 新增 `insertFootnote` / `insertEndnote` / `insertMarginNote` / `insertNote` 命令：按同类现存注释数量自动编号（arabic / circled / chinese），光标已在注文内时插在该注释之后；注释节点规格补 `marker` 属性（导出 `NOTE_NODE_ATTRS`）。
  - `layout` 序列化器新增 `epubSemantics` 选项：注释块输出 `epub:type`（footnote / endnote / sidebar），注码提为 `.bt-note-marker` 并注入首个段落内与注文同起一行；`book-css` 补注码样式。
  - `exporter-epub` EPUB 3 路径自动开启注释语义（EPUB 2 不输出 `epub:type`）。
- 注释引用闭环：
  
  - `core` 新增 `MARK_TYPES.NOTE_REF`（`noteref`）标记：正文上标指向注释块，attrs 为 `targetId`（注释块 id）与 `refId`（本条引用的锚点 id）。
  - `editor`：`insertNote` 缺省在光标处同时写入上标引用，注释块自动生成 `note-<type>-<序号>` / `ref-<type>-<序号>`（冲突自动追加后缀），并在注文写 `refId`；新增 `insertNoteRef({ targetId, marker?, refId? })` 为已有注释补引；`withRef: false` 可只插注文。
  - `layout`：序列化器输出 `<a class="bt-mark-noteref" href="#…" epub:type="noteref">`，注文末回跳 `<a class="bt-note-backref">↩</a>`；`book-css` 补上标与回跳样式。
  
  EPUB 3 导出自动带 `epub:type="noteref"`，EPUB 2 仅保留普通链接。
- P0 能力接线批次（B5 / C4 / C6 / C9 / D2 / D4 / E9）：
  
  - **B5 页底注区渲染**：`serializePageNotes` + `.bt-page-notes` / `.bt-note-continued` 样式，`PaginatedPage.notesCarried` / `Reader.isPageNotesContinued`，`BtBookView` 输出注区槽（续前页标记、超限告警，不裁剪）。
  - **C4 表格合并 / 拆分**：`mergeCells` / `splitCell`（矩形校验、跨表头冲突拒绝、非矩形不派发事务；拆分补齐空单元格）。
  - **C6 / D2 标注**：`core` 新增 `ExportComment` 契约；`annotationsToMarkdown`；`useAnnotations` + `BtAnnotationSidebar`（书签 / 高亮 / 笔记 / 评论四 tab）；`includeComments`（EPUB / 站点，缺省 false）。
  - **C9 统计**：`useDocumentStats`（300ms 防抖）+ `BtDocumentStats`（字数 / 块数 / 阅读时长 / 注释数 + 章节分布，纯 CSS 条形）。
  - **D4 手势与键盘**：`BtBookView` 新增 `fontSize` / `update:fontSize` 双指缩放（12–32px），scroll 模式可聚焦并支持 PageUp / PageDown / 空格 / Home / End 滚屏。
  - **E9 校验 CLI**：`runValidateCli` + `bt-validate-epub`（`--json` / `--help`，退出码 0/1/2），CI 增加合法样本与损坏文件校验步骤。
  - **依赖**：新增合法方向 `vue → annotation → core`；导出器只消费 `ExportComment`，不依赖 `annotation`。
- P1-A 排印底座（A6 / B4 / C3）：
  
  - **A6 IR 契约（0.2.0）**：`chapter` / `section` 新增 `attrs.columns`（1~3）；新增节点 `page-header` / `page-footer` / `condition`；`evaluateCondition` 提供受控条件表达式（缺省上下文保留内容）；校验覆盖列数范围、页眉页脚唯一性与位置、条件表达式；内置 0.1.0 → 0.2.0 迁移（无改写）。
  - **B4 多栏与对页**：分页器按「页容量 × 栏数」装箱并标记 `page.columns`，栏数变化开新页；`extractBlocks` 沿结构树继承分栏数；多栏量尺改按栏宽实测（移除字符估算回退）；`BtBookView` 以 CSS 多栏渲染正文流，新增 `spread="facing"` 对页模式（偶数页在左、按双页宽缩放）。
  - **C3 分栏符**：`insertColumnBreak` + `break(variant='column')`，CSS `break-before: column`；单栏退化为细分隔标记。
  - **已知边界**：分栏符不触发分页器列填充重算（列内断点由 CSS 执行，极端情况可能留白）；分页编辑画布仍限单栏；PDF 镜像打印待后续批次。
- P1-B1 样式体系与 EPUB 结构（C10 / E2 / E4）：
  
  - **C10 命名样式继承**：`NamedStyle` 新增可选 `basedOn`；新增 `resolveNamedStyleChain` / `resolveNamedStyleDeclarations` / `validateNamedStyleSet`（断链与成环安全降级）；`buildFeatureCss` 按继承链扁平输出 `[data-style-id]`；`normalizeStyleSnapshot` 保留依据并丢弃自引用。
  - **批量样式命令**：新增 `applyNamedStyle(styleId)`（作用于选区内所有文本块，空光标作用于当前块）与 `clearFormat()`（清除 marks 与命名样式，保留结构 / id / 块级 attrs），均为单事务可撤销。
  - **E2 分卷 EPUB**：新增 `exportEpubVolumes(document, options)`，按顶层 `volume` 切分、每卷独立目录、标识符确定性派生；无卷文档与 `exportEpub` 字节一致。
  - **E4 前置页独立 XHTML**：封面 / 书名页 / 版权页 / 封底各成独立文件、不进目录，`body` 输出 `epub:type="cover" / "titlepage" / "copyright-page"`。
  - **demo**：样式面板增加「依据」下拉（自动排除成环候选），工具条增加命名样式批量套用与清除格式。
  - **已知边界**：仓库无 `exporter-docx`，不做 Word `styles.xml` 映射。
- P1-B2a 导入链路（F5 / F6）：
  
  - **Markdown（F6）**：列表改为缩进递归，支持嵌套与松散项（最多 8 层）；新增 GFM 管道表格（对齐、`\|` 转义、缺列补空）；图片 title 或紧随的斜体行转为图注；`parseFrontMatter` 解析开头 YAML 子集并在导入层剥离，调用方 metadata 优先。
  - **DOCX 图片（F5）**：`docxToHtml` 缺省以内联 data URI 输出图片，`convertImage` 仍可覆盖。
  - **DOCX 样式（F5）**：新增 `parseDocxStyleInfo`（解包 `styles.xml`，中文样式名 / basedOn / 常用格式 → `NamedStyle`，仅保留正文引用样式）；新增 `docxToBookDocumentWithStyles` 返回 `{ document, namedStyles }`，段落经 `styleId` 挂载。
  - **DOCX 脚注（F5）**：mammoth 脚注输出归一为 `noteref` 标记 + `footnote` 节点（`fn-docx-N` / `ref-docx-N`），编号连续、可回跳；`noteref` 的 parseDOM 优先级高于通用链接。
  - **依赖**：`import-docx` 增加 `fflate` 与 `@xmldom/xmldom`（工作区既有库）。
  - **边界**：Word 制表位 / 边框 / 主题字体不映射；Markdown HTML 块、引用嵌套、数学公式不在本批。
- P1-B2b：K4 索引 / K5 印章与版心 / K2 校勘对照。
  
  - **core**：新增 `index-term` 行内标记（`term` / `sortKey`），IR 版本升至 `0.3.0`（空迁移）；`collectIndexTerms` / `buildIndexEntries`（页码去重、连续页合并区间、拼音或显式排序）/ `buildIndexAppendix`（书末索引附录节点）。
  - **editor**：`toggleIndexTerm` 命令（选中文本为缺省词条）。
  - **layout**：`renderSealSvg` 确定性 SVG 印谱（朱文 / 白文、方印回文 / 竖排、边框粗细），`seal` 序列化输出内联 SVG（可关闭退化为文字印章）；仿真模板各自声明版心字段序列，`PageGutterTexts` 增 `volumeTitle`，鱼尾按字段分段定位。
  - **reader**：卷次自动推导（`resolveVolumeTitleForNode`），页眉 / 版心支持 `volumeTitle` 字段。
  - **classical**：校勘 `collation-mark` 增 `pairId` / `role`、`collation-note` 增 `pairId` / `marker`；`insertCollationNote` 自动取号、`renumberCollationNotes` 一键重排、`pairCollation` / `unpairCollation` 配对与解绑；`buildCollationSummary` 生成校勘汇总表附录。
  - **vue**：新增 `BtCollationCompare` 对照组件（底本 / 校本并排、同配对联动高亮）。
  - **exporter-epub**：书末自动追加索引章（可关闭）；新增 `appendices` 选项，`#id` 锚点自动改写为跨文件地址；EPUB 2 印章退化为文字印章。
- P2 能力批次（H3 书架 / H4 备份 / H5 加密 / C5 修订 / C7 历史）：
  
  - **H3 书架**：`DocumentSummary` 追加可选字段（`author` / `isbn` / `tags` / `coverThumbnail` / `wordCount` / `progress` / `lastOpenedAt`），旧记录经 `mergeDocumentSummary` 回退；新增可选端口 `BookLibraryStore`（`query`）与 `BookSummaryStore`（`updateSummary`），`StorageAdapter` 必选方法不变；`.btbook` 单书档（`packBookArchive` / `unpackBookArchive`，ZIP 经 `BookPackCodec` 端口由宿主注入）；`BtBookShelf` + `useBookLibrary`。
  - **H4 备份**：`buildLibraryBackupFiles` / `restoreLibrary`（`merge` / `overwrite` / `keep-both` 三策略、逐书校验、进度回调、失败清单不中断整批）；`BtBackupPanel`。
  - **H5 加密**：`deriveKeyPbkdf2` / `createStringCipher` / `createByteCipher`、存储与资产加密装饰器、注记独立密钥（`createEncryptedAnnotationStorage`）、导出脱敏（`redactDocument` / `redactAnnotations`）；`CryptoError` 稳定错误码，禁止静默降级为明文；`BtEncryptionPanel`。
  - **C5 修订**：新增 `insertion` / `deletion` / `format-change` 标记与 `createRevisionTrackingPlugin`（删除内容保留，拒绝可无损还原）；`acceptRevision` / `rejectRevision` / 全部接受拒绝、`setRevisionMode` / `setRevisionView` / `setRevisionAuthor`；序列化新增 `revisionView`（`marked` / `final` / `original`），EPUB / PDF / 站点导出缺省终稿；`BtRevisionSidebar`。
  - **C7 历史版本**：`createSnapshot` / `restoreSnapshot`（校验和 + `validateDocument` 双检）、`diffDocuments`（节点级 LCS + 字符级内联 diff）、保留策略；`DocumentVersionStore` 端口与 `IndexedDbVersionStore` / `MemoryVersionStore`；`BtVersionHistory`。
  - **兼容性**：三个适配器共用 `storage-contract.ts` 公共契约套件；HTTP 适配器的 `query` 在客户端过滤，不新增服务端端点，且不实现 `BookSummaryStore`。
  - **依赖**：生产依赖零新增；demo 的 `.btbook` codec 为仓库内零依赖 STORE 实现，未引入压缩库。
- 表格数据与交换层增强：`table-row` 新增 `header`（表头行），`table-cell` 新增 `colspan` / `rowspan` / `align`（默认值在 IR 中省略）；HTML 导入识别 `<thead>` / `<th>` 与 `colspan` / `rowspan` / `align`（含 `data-align`、内联 `text-align`），导出输出 `<thead>` / `<th>`、原生跨行跨列与 `data-align`（无表头行时保持旧输出）；编辑器单元格 `toDOM` 输出原生 `colspan` / `rowspan`；新增命令 `toggleTableHeaderRow` / `setTableCellAlign` 与 `TableCellAlign` 类型；book CSS 增加单元格对齐与表头底色规则；文档 21 与能力清单同步。
- 直排排版引擎 v2 批 1（模型层）：双行夹注行内化 + 墨钉 / 卷末总评节点 + 行款属性登记。
  
  - **IR 0.4.0 迁移**：`double-note` 由块容器改为**行内容器**（古籍口径：小字≈
    正文之半、随文双行连排不换列，n 字占 n/2 字位）。`migrateDocument` 内置
    `0.3.0→0.4.0` 步骤：容器内段落展平为行内 children；块位夹注包一层段落
    （行内节点落合法段落位）；id / attrs 原样保留，入参不可变。
  - **编辑器**：规格改 `inline*`（与夹注 inline-note 同形态）；`wrapDoubleNote`
    行内包裹命令（选区包裹 / 空光标插入，`insertDoubleNote` 为别名）；IR ⇄ PM
    往返走行内通道；新增 `insertInkNail` / `insertGeneralReview` 命令。
  - **新节点**：`ink-nail`（墨钉——未定字占位黑块，行内原子，1em 实心方）、
    `general-review`（卷末总评，结构块，title 供目录提取）。
  - **行款属性**：`LINE_RULE_ATTRS`（`indent` 低 N 格 / `lift`+`liftLevel` 抬头
    六式 / `breakLine` 提行另起 / `band` 两截本归属）并入 `COMMON_NODE_ATTRS`，
    缺省 null 不参与序列化——未使用行款的文档 IR 逐字节不变；渲染 / 分页侧
    消费属批 2 / 批 4。
  - **reader**：`double-note` 移出版式文本容器清单（随所在段落成块、随行切片）；
    `general-review` 纳入容器清单。
  - **序列化与样式**：`double-note` 恒输出行内 `span`（不再走块级启发式 div）；
    横排括注随文（伪元素括号 + 0.72em 小字，古籍点校整理规范）；墨钉样式；
    仿真网格层移除块级夹注规则（列内双行属批 2 列盒渲染器，行内夹注继承
    根行高天然落格）；古典基线哈希第十五次重锁。
  - demo：《论语》样册夹注改段内行内位；「替换为」菜单的双行夹注移入
    「行内容器」组（同段选区包裹）；工具条插入项同步。
- 直排排版引擎 v2 批 3（编辑层）：分页画布直排行内流 + 行款命令。
  
  - **行款命令**（editor）：`setLineIndent(n|null)` 低格、`setLift(type, level?)`
    抬头（空抬 / 挪抬 / 平抬 + 单双三四抬）、`toggleBreakLine()` 提行另起——
    作用于光标所在段落 / 引文（标题不命中），attrs 经 IR ⇄ PM 无损往返；
  - **PagedCanvas 直排行内流**：连排片段（段落 / 引文）改走
    `serializeVerticalFlow`（与预览 BtBookView 同形态）——片段以行内呈现、
    正文跨片段同列连排（`.bt-paged-frag--inline`）；续排片段（fromLine > 0）
    自动省略行款前缀（不重复低格 / 抬头）；空行内段落以零宽字符撑出落点；
  - **字符轴兼容**：行内流标记（空位盒 / 断列 br）不产生文本节点，
    `fragTextNodes` 的 DOM 文本轴与模型轴保持同口径——选区桥 / IME / 点击
    定位无需改动（附测试锁定）；
  - 隔离：横排画布渲染通道不变（无 bt-vflow 类、块级序列化）。
  - demo：工具条「插入」行新增行款组 7 项（低两格 / 顶格 / 挪抬 / 平抬 /
    提行 / 墨钉 / 总评），速查文档同步。
- 直排排版引擎 v2 批 6（批点与套印）：墨色色层 / 单色模式 / 圈点双位 / 卷末总评样式。
  
  - **套印墨色**：core 新增 `INK_COLORS`（black / red / blue / yellow）；注 / 批
    类节点（footnote / endnote / margin-note / head-note / tail-note /
    collation-note / double-note / inline-note / general-review）与圈点标记的
    规格登记 `inkColor` 属性；命令 `setInkColor(color | null)` 作用于光标所在
    注 / 批节点（black / null 回归全墨）；
  - **渲染**：book-css 新增套印墨色规则——`data-ink` 属性选择器取
    `--bt-ink-*` 变量（朱 / 蓝 / 黄，主题可覆盖），预览 / EPUB / PDF 全路径
    输出（批点套印不限仿真书）；
  - **单色模式**：`buildBookCss({ monoInk })` 跳过色层规则（批注圈点回归全墨）；
    PDF / EPUB 导出选项 `monoInk` 透传——单色印刷交付；
  - **圈点双位**（§11.4）：句读标记居字右下（缺省）、文法符号经圈点标记
    `position: 'grammar'` 居字右（直排惯行，两类不争空间）；密度档受 CSS
    text-emphasis 能力限制顺延（style 实心 / 镂空二维替代，docs 记录）；
  - **卷末总评样式**：`.bt-general-review` 结构块（分隔线起首、注文色、小一号，
    补批 1 节点缺口）；注码圈码由 marker 字形（① ② …）内容层承担。
  - 古典基线第十九次重锁（套印与圈点规则为全路径输出）。
- 直排排版引擎 v2 批 7（图文与整叶收尾）：筒子叶版心交替 / 叶次 a/b 页码 / 插图版式。
  
  - **筒子叶版心交替**：`facsimile.gutter.alternate` 选项 + `facsimilePageOf`
    页级变体纯函数（奇数页翻转版心侧，耳框与内缩随页）——预览 BtBookView
    （page / scroll / 对页的版心、耳框、页框内缩）、编辑画布 PagedCanvas
    （页框内缩 + data-gutter-side 打标）、打印 paged（版心 / 耳框随页 +
    `.bt-page[data-gutter-side]` 镜像内缩 CSS）三端接入；分页与度量不分侧
    （带宽尺寸对称，页数与既有口径一致）。docs/22 已知限制 3「版心恒在左侧」
    自本批解除；
  - **叶次 a/b 页码**：`PAGE_NUMBER_STYLES.LEAF_AB`（`leaf-ab`）——一叶两半叶
    页码体系（奇数页「第 X 叶·上」、偶数页「第 X 叶·下」，中文叶数），与
    decimal / chinese / roman 并行；
  - **插图版式**：`image.attrs.layout`（editor 规格登记）——`embedded`（缺省
    嵌入正文）/ `full-width` 整幅独占版心宽 / `half-width` 半幅居中；
    序列化透传 `data-layout`、CSS 属性分支；复合版式（上图下文 / 左图右文 /
    双面连式）由结构层承担（两截本 bands / 对页）；
  - 图文对照阅读按计划列为可选未实现（平台功能非版式规则）。
  - 古典基线第二十次重锁（插图版式属性规则全路径输出）。

### Patch Changes

- 修复「改块类型」命令清空块 `id`（P0-2 / R2）：`prosemirror-commands` 的 `setBlockType` 以 `type.create(attrsHere, null, marks)` 重建节点，且 `prosemirror-model@1.25` 起 `Node.hasMarkup(type, null)` 不再短路，导致 `setParagraph` / `setHeadingLevel` 把块 `id` 整体归默认（实测 `irId p-1 => undefined`）。现改用新增的 `setBlockTypeKeepingId`：对每个选中文本块以 `tr.setNodeMarkup(pos, nodeType, { ...node.attrs, ...patch })` 改写，显式保留 `id` 与 `rawAttrs`；跨块选区逐块处理、各自保留原 `id`，不再用单一 `attrs` 套用全部块。
- 修复行内容器包裹命令（夹注 / 异体字载体 / 避讳字载体，P0-1 / R1）：`insertInlineNodeWrapping` 此前直接把 `Selection.content().content`（默认 `includeParents=true`，根为块级祖先）喂给 `type.createChecked`，导致选中文字点击夹注等时抛出 `Invalid content for node <type>: <chapter(paragraph(...))>` 而「完全无反应」。现改为：跨块选区（`$from.parent !== $to.parent`）显式返回 `false`（不抛异常、不改文档）；同块选区改用 `$from.parent.content.cut(...)` 取得行内 Fragment 再 `createChecked`。此外补全非空选区的光标落点——替换后用 `TextSelection` 把光标移入新包裹节点内部，与空选区分支行为一致（修复前光标落在容器之后）。
- 文档内锚点跳转：导入保留源元素 id，阅读视图点击 `<a href="#…">` 注码跳到目标内容，修「点击刷新」。
  
  - **editor**：schema 解析层（`buildSchema`）为全部节点 parseDOM 规则统一保留源元素 `id`（覆盖导入的 HTML / docx / EPUB 与 bt-* 渲染产物 HTML 回编辑器的往返）——`<a href="#…">` 的跳转目标块（段落 / 列表项 / 标题等）从此带源 id，阅读器可按块 id 定位页码。
  - **reader**：新增「链接 hash → 叶块 id」索引与 `Reader.getPageOfAnchor(hash)`——链接标记的 hash（EPUB 遗留 `text00012.html#ch1-9` 取末段）反查其所在块再定位页码，首次出现优先。
  - **vue**：`useNoteInteraction` 点击委托新增「文档内锚点链接」分支——书内相对锚点（含 path#hash 形态，文件名段为 EPUB 残留）**一律消费**，绝不交给浏览器默认导航（相对路径导航会把预览页整页「刷新」）。跨页定位三级解析：目标块 id 直查 → **EPUB 回链约定**（注码 `#ch1-9` ↔ 注文回链 `#ch1-9-back`，经 `getPageOfAnchor` 反查注文所在块，**存量书免重导即可跳转**）→ 点击注文回链时剥 `-back` 后缀反查注码；全部落空（坏链）静默消费。绝对地址（http / mailto 等）与无 hash 的普通链接照常放行；同页已渲染的目标直接高亮定位。
- 字图识别补口：EPUB 内联 SVG 缺字图不再漏判，导入保留图片宽高，纯字图段落整块，demo 打开存量书自动归一化回写。
  
  - **core**：`normalizeGlyphImages` 的内嵌 data URI 信号扩为含 `data:image/svg+xml`——EPUB 缺字图大量以内联 SVG 顶替，此前该形态只剩「切断句子」单弱信号而保守保留成块级插图（脱离上下文独占一行居中）；现与位图 data URI 同为「内嵌图片」弱信号，叠加位置信号即可判定归并。保守语义不变：前段已收尾等单弱信号场景仍保留并写报告，不丢数据。
  - **editor**：`image` 的 parseDOM 保留 `<img>` 原生 `width` / `height`（缺省 / 非法归一为 null，`attrs` 新增可空声明）——带尺寸的缺字图（EPUB / 网页主流 `<img width="16" height="16">` 形态）导入即命中「近方形小图」强信号；IR ⇄ PM 往返无损。
  - **layout**：块级 `image` 序列化把 `width` / `height` 输出为原生属性（正数才输出），不再降级为 `data-*`——浏览器可在图片加载前预留版位，导出产物尺寸保真。
  - **reader**：`isLeafBlock` 对「只含行内字图、无裸文本」的段落判整块——不再下钻把 `glyph-image` 抽成独立块、脱离所在段落；`findNodeById` / `indexNodeAnchors` 复用同函数，口径自动一致。
  - demo 宿主侧（私有包）：书架打开旧书时自动跑 `normalizeGlyphImages`，发现可归并字图即回写书库并消息条提示（存量书一次修复永久生效）；草稿恢复同样归并（幂等，进入编辑器后自动保存落盘新基线）。
- P4 批 2（I8）：统一错误码。core 新增 `BibliotypeError` 基类（稳定 `code` + 结构化 `details` + 中文 `hint` + `cause` 根因链）、`isBibliotypeError()`（instanceof + 跨实例品牌双通道）、`serializeBibliotypeError` / `deserializeBibliotypeError`（JSON 安全往返，cause 链递归还原）与统一错误码表 `BIBLIOTYPE_ERROR_CODES`；`PluginConflictError` / `NodeTypeConflictError` / `MigrationPathError` / `EditorSpecConflictError` / `HttpAdapterError` 改继承基类并新增 code / details / hint（原 `instanceof` 断言、`name`、message 不变），`CryptoError` / `BookPackError` 并入基类且既有稳定码保持原值；错误码表回写 docs/13；测试覆盖 code 稳定 / 序列化往返含 cause 链 / 兼容断言 / 非错误值负例。
- 表格编辑增强：
  
  - **editor**：`table` / `table-row` / `table-cell` 渲染为语义 `<table><tbody><tr><td>`（保留 `bt-*` class 与 `data-bt-id`），修复插入表格后编辑画布一片空白；
  - **reader**：表格加入复合原子块，`extractBlocks` 不再下钻到单元格段落，分页与序列化保留完整 `<table>` 包裹；
  - **layout**：表格样式随书写方向（`writing-mode: inherit`），空单元格保留最小尺寸，直排下不再塌陷；
  - **vue**：新增 `BtTableSizePicker`（Word / WPS 式行 × 列网格 + 精确输入），配合工具条在直排下同样可插入表格。
