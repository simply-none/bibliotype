# @bibliotype/layout

## 26.10.25-rc.1

### Minor Changes

- 古籍仿真版式模板按历史考证校准并扩充至十二种，新增大黑口口子与双鱼尾相向：
  
  - **考证修正（现存模板）**：宋刻浙本改左右双边 + 双鱼尾 + 楷体栈（欧体替身）+
    十行二十字；明嘉靖本改左右双边 + 双鱼尾 + 九行十八字；清武英殿本改宋体
    匠字（原楷体）+ 九行二十一字（聚珍版口径）；汲古阁本行款调至十二行二十五
    字；巾箱本改左右双边 + 双鱼尾 + 十三行三十字。
  - **新增六种模板**：宋建本（麻沙本，细黑口双黑鱼尾四周双边竹纸黄褐）、
    宋蜀刻大字本（白口左右边字大如钱八行十六字）、元刻本（大黑口双鱼尾四周
    双边圆润楷书）、明万历本（白口双鱼尾瘦长宋体）、清写刻本（软体精楷行疏
    纸白九行二十字）、四库馆写本（朱丝栏四周双边八行二十一字）。
  - **口子扩展**：`GUTTER_MOUTHS.BLACK_WIDE`（大黑口，象鼻段 14px 宽墨条）；
    口子下拉同步「白口 / 细黑口 / 大黑口」。
  - **双鱼尾修复**：下鱼尾垂直镜像（真实双鱼尾上下相向），此前两尾同向。
  - 行款全部按历史数字反推（字号 ≈ 版心高 /（字数 × (1+字距)）、行距 ≈
    版心宽 / 行数 / 字号），`facsimile-presets.test` 与 docs/22 表格同步锁定。
- 新增「古籍仿真直排」：版框 / 界行 / 版心（书口）与六种古籍版式模板
  
  - `layout`：新增 `LayoutOptions.facsimile`（缺省 `undefined` = 不启用）、
    `FACSIMILE_PRESETS` 六模板、`resolveFacsimileGrid` 行款与几何纯函数；
    版心带宽进入主轴扣减与度量签名，版框 / 界行 / 颜色属纯绘制、不触发重排；
    `buildBookCss` 新增 `pageDecoration`（默认 `false`）与同源版心序列化。
  - `reader`：新增 `getPageGutterTexts` 与 `resolvePageGutterTexts`（书名 / 篇卷 / 叶次）。
  - `vue`：`BtBookView` / `PagedCanvas` 在带 `facsimile` 时开启装饰并注入版心。
  - `exporter-pdf`：`paged` 模式同步版框 / 界行 / 版心，打印与预览一致。
  
  兼容性：既有「古籍直排」与「现代横排」行为不变——未启用 `facsimile` 时样式表、
  版心尺寸与度量签名与改造前逐字符 / 逐数值相同（新增 `classical-isolation` 回归测试守护）。
- 字图内联（K6）：「用图片顶替缺字」的块级图片归入文字流，阅读 / 分页 / 编辑 / 导出四链天然一致。
  
  - **core**：新增 `NODE_TYPES.GLYPH_IMAGE`（`'glyph-image'`，`kind:'inline'` 行内原子节点，与 `math-inline` 同层；attrs `src` / `alt` / `char` / `width` / `height`）与 `normalizeGlyphImages(document, options?)`——导入边界一次归一化：识别出字图特征的块级 image（排除项：与图注配对、宽或高超 `maxGlyphPx`（缺省 64）；强信号：alt ≤ `maxAltChars`（缺省 2）字、近方形小尺寸（宽高比 `aspectRange` 缺省 0.6~1.6）；弱信号：src 命中 `srcHints`、png / svg / gif 扩展名、**内嵌位图 data URI**（docx / epub 主流形态，无 alt 无尺寸）与**位置信号**（前段未收尾 = 切断句子，插图几乎不在句中；仅对该图无任何尺寸元数据时计入）；判定 = 无排除且（强信号 ≥1 或弱信号 ≥2），仅单弱信号保守保留不丢数据），归并按文档序：`auto` 且两侧都是段落、前段未收尾 → **前段 + 字图 + 后段三合一复原**被切断的同一句话（`position: 'restore'`）；前段收尾缝后段头（`'next-start'`）；字图在容器末尾缝前段尾（`'prev-end'`）；强制 `merge: 'auto' | 'prev' | 'next'` 中 prev / next 只缝单侧不复原，返回 `{ document, report }`，原档 structuredClone 不可变；配套 `summarizeGlyphImageReport` / `DEFAULT_GLYPH_IMAGE_OPTIONS` 与 `GlyphImageReport` 等类型。
  - **editor**：classical schema 注册 `glyph-image`（group `inline`、`inline` + `atom`，attrs `src` / `alt` / `char`；parseDOM `img.bt-glyph-image`，toDOM 同 class 回吐），渲染产物可无损回编辑器；`image` 的 `img` 通配对 `bt-glyph-image` 让位（返回 `false`），行内字图不再被 PM 从段落 slicing 出来独立成块。
  - **layout**：序列化器支持 `glyph-image` → `<img class="bt-glyph-image" … />`（src 走 `rewriteSrc`、`data-char` 空省略，与 image 同规）；书册样式新增 `.bt-glyph-image`：`display:inline-block` + **1em 硬限幅**（`width` / `height` / `max-width` / `max-height` 均 1em，原图再大也不超两侧文字的高 / 宽）+ `object-fit:contain` + 基线下沉 `0.15em`（与 `.bt-glyph` 同款口径）；直排（`writingMode` 竖排）构建期追加 `transform: rotate(90deg)`——img 不随 writing-mode 旋转，1em 方形旋转后占位不变；classical CSS 基线哈希同步更新。
  - **分页 / 量尺零改动**：字图是段落行内子节点，随段落实测行盒进 `lineMainSizes`（不等行高既有支持）；跨页切片对零文本 inline atom 按位置整体归属（`math-inline` 先例同口径），不丢图不错位。
  - demo 宿主侧（私有包）：`ImportPanel` 五种格式导入统一在收口处过 `normalizeGlyphImages`，状态行展示摘要（「已将 N 张缺字图归入文字流；M 张按插图保留」）。
- 古籍仿真新增纸纹令牌 `page-texture`
  
  - `buildBookCss`：`page-texture` 存在时在装饰段输出 `background-image: var(--bt-page-texture)` + `repeat`，与版框 / 界行同闸门（`pageDecoration && facsimile && 直排`）；缺省不输出任何规则，古典 / 现代路径逐字符不变。
  - 纸纹属纯绘制令牌：不侵占版心、不进度量签名，`page-texture` 留值也不会让「古籍直排 / 现代横排」画出纸纹。
- 纸书排版引擎 Phase 2：`paginate` 支持段落行级拆分与孤寡行控制。`MeasurableBlock` 新增 `lineSize` / `splittable`（仅正文段落可拆，标题 / 封面 / 注文恒整块），`PaginateOptions` 新增 `widowControl`（首页片段 ≥ minFirst 行、末页片段 ≥ minLast 行，默认 2 / 2）；页输出新增 `items: PageItem[]`（`fromLine` / `lineCount` 行级渲染契约，`blocks` 向后兼容），超高可拆块按每页容纳行数连续跨页。不传新字段时行为与块原子版完全一致。
- 分页器新增页底注区（脚注浮注）：`MeasurableBlock.floatToBottom` + `PaginateOptions.noteArea: { maxRatio? }`。
  
  - 脚注不进正文流，落在所在页的 `page.notes`，`page.noteMainSize` 记录注区占高；
  - 正文可用容量 = 页面容量 − 注区高度（注区动态收缩正文）；
  - 注区超过 `maxRatio`（缺省 0.4）时整条续到下一页页底（跨页续注），单条超限独占一页不死循环；
  - 未开启 `noteArea` 时产物结构与旧版完全一致（不出现 `notes` / `noteMainSize`）。
- 新增 `resolvePageMainSize` 导出：依据布局选项与书写方向推导每页可用主轴尺寸，供编辑画布分页参考线与 DOM 实测通道复用同一口径。
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
- P3 古籍能力批次（K3 句读 / 专名标注、K6 缺字兜底、K7 典籍元数据）：
  
  - **K3 句读 / 专名自动标注**：`classical` 新增 `suggestJudou` / `judouMarkerRange` / `JUDOU_SYMBOLS` / `EXISTING_PUNCTUATION`、`detectProperNames` / `BUILTIN_PROPER_NAME_TERMS`（内置人名字典）与 `ProperNameDetector` 模型端口、`buildAnnotationSuggestions` / `collectSuggestionBlocks` / `countSuggestions`（确定性 id、段内 UTF-16 偏移、同偏移去重）；新增 `judou` 标记（`attrs.symbol` / `source=auto` / `suggestionId` / `rule` / `confidence`，编辑画布与序列化同口径）；新增命令 `applyJudouSuggestions` / `applyProperNameSuggestions` / `removeSuggestionMarks` / `commitJudouAsText`（单事务、可一次撤销）。`vue` 新增 `useAnnotationSuggestions`（待处理 / 已接受 / 已拒绝 / 已落地状态机）与 `BtAnnotationSuggestions` 审阅面板；布局侧新增 `.bt-mark-judou::after` 候选符号样式。
  - **K6 缺字与字形回退**：`core` 新增 `parseIds` / `formatIds` / `countIdsLeaves`（U+2FF0–U+2FFB 全部 12 个运算符，组件不足 / 超深给中文 issue）、`resolveGlyphFallback`（主字体链 → IDS → 方框，`GlyphProbe` 缺省视为命中）、`collectGlyphIssues` / `summarizeGlyphIssues`（字符 / 码位 / IR 路径 / 上下文，可按字符去重）；`layout` 新增 `renderIdsSvg` / `renderIdsGlyphHtml`（纯字符串、零依赖、同描述逐字节一致）与 `serializeNode({ glyph })` 逐字替换、书册样式 `.bt-glyph`；`exporter-epub` 新增 `collectEpubGlyphProblems`（`warning` 级 `ValidationProblem[]`，不阻断导出），`exporter-pdf` 新增 `collectPdfGlyphProblems` / `summarizePdfGlyphProblems`。`vue` 新增 `useGlyphAudit` 与 `BtGlyphAuditPanel`。
  - **K7 典籍元数据规范**：`BookMetadata` 新增可选字段 `classicalCategory`（经 / 史 / 子 / 集 + 二级类）、`editionType`（刻本 / 抄本 / 活字本 / 稿本）、`repository`、`callNumber`，配套 `CLASSICAL_DIVISIONS` / `EDITION_TYPES` 与 `validateMetadata` / `isClassicalDivision` / `isEditionType`（中文 issue，非法值拦截）；新增 `toDublinCore` / `serializeDublinCore`（固定键序 JSON）与 `toCnmarc`（001 / 200 / 205 / 210 / 215 / 300 / 606 / 686 / 690 / 801 / 905 字段行）、`migrateLegacyMetadata`（旧 `extra` 提升，幂等、顶层优先）；`exporter-epub` 的 OPF 补 `dc:subject` / `dc:type` / `dc:source`。
  - **兼容性**：均为增量导出与可选字段，既有函数签名不变；`serializeNode` 仅在显式传入 `glyph` / `tagOverrides` 等新选项时改变输出，默认产物逐字节不变；OPF 新增 `dc:subject` / `dc:type` / `dc:source`（无对应元数据时省略）；`judou` 标记为新增，既有文档不受影响。生产依赖零新增，库内仍不写存储。
- P3 阅读交互批次（D6 目录增强 / D9 注释交互 / D10 主题与外观市场）：
  
  - **D6 目录增强**：`Reader` 新增 `getPageOfNode` / `getOutlineItemAtPage`（复用分页索引，不遍历文档），`useReaderBinding` 暴露 `activeOutlineItem` / `activeOutlineKey`；`BtToc` 支持当前章高亮（含 `aria-current` 与滚入视野）、折叠记忆（`v-model:expanded-keys`）、目录内搜索（过滤 + 命中高亮 + 自动展开父级）、缩略图映射（缺省首字占位）；新增 `BtSidebarResizer`（拖拽 / 双击复位 / 方向键步进 / `role="separator"`）与 `useTocView`、`buildTocViewItems` 纯函数。
  - **D9 注释交互**：序列化补可定位锚点——注文 `data-note-id`、注码 `data-note-ref`（不改 `epub:type` 语义），书册 CSS 新增 `.bt-note-active` 激活态；`Reader` 新增 `getNoteAnchors` / `getPageOfNoteRef`；新增 `useNoteInteraction`（页容器事件委托、注码跳转、回跳、双向高亮、悬浮 / 聚焦 / 触屏预览、`Alt+←/→` 循环切换）与 `BtNotePreview`，`BtBookView` 在 page / scroll 两种模式接入。
  - **D10 主题与外观市场**：`core` 新增主题包格式（`kind` + `schemaVersion` + `tokens`，字段顺序确定）与 `serializeThemePreset` / `parseThemePreset` / `validateThemePreset` / `applyThemePreset`、`ThemePresetError`、`createThemePresetCatalog` 与内置 `night` / `eye-care` / `parchment`；令牌校验 `THEME_TOKEN_KEYS` / `validateThemeTokenValue`；字形覆盖 `analyzeGlyphCoverage`（`GlyphProbe` 端口）。`vue` 新增 `BtThemePanel`、`BtFontFallbackPanel`、`useThemePresets`、`createFontCheckProbe`、`splitFontFamilyList`。
  - **兼容性**：均为增量导出，既有函数签名不变；`serializeNode` 仅在注释块额外输出两个 `data-*` 锚点（EPUB / 站点 / PDF 同步），书册样式表新增激活态规则（仅阅读器加类时命中）；`applyThemePreset` 默认保留排版令牌，切换主题不影响用户自定义字号。
  - **依赖**：生产依赖零新增；库内仍不写 localStorage，目录折叠 / 侧栏宽度 / 主题包落盘均由宿主负责。
- 新增版面设置「开本适配」（`LayoutOptions.pageSizeMode`），其中「自适应宽度 / 高度」为 **PDF 式整页视图缩放**（修「自适应时字体没跟着缩放」）：
  
  - **取值表**：`PAGE_SIZE_MODES` = `width / height / h5 / fixed`，默认 `fixed`；缺省与落盘脏值经 `resolvePageSizeMode` 归一为 `fixed`，旧快照与既有主题字面量视觉零变化。
  - **`resolvePageFitScale(options, stage?)`**（layout 新增）：`width` 档返回 `舞台宽 / 页宽`、`height` 档返回 `舞台高 / 页高`（允许 >1 放大，限幅 0.2~4，保留三位小数防每帧新值）——页框与分页**保持开本不动**，整页（文字、版心、页脚）按倍率等比缩放，与 PDF「适合宽度 / 适合高度」一致；不做页框重排（重排只改行宽 / 行数，字号仍按令牌落地）。`fixed` / 量不到同名轴返回 `undefined` = 不覆盖（SSR 安全）；`h5` 档恒返回 `1`（页框已按可视宽高落地，文字保持预设字号）；仿真版式不禁用——width / height 档页框恒为开本、整页 transform 等比缩放（版框 / 界行随缩放保真，不会错位），与古籍仿真兼容。两档不改页框 → 度量签名不变 → **不重量尺**，拖动窗口只是重新缩放，导出与分页几何恒为开本。
  - **`applyPageSizeMode(options, stage?)`**：只有 `h5` 动几何——网页式布局，页框直接取舞台可视宽高（宽高都跟随、不设轴限幅）+ 强制单栏，文字按令牌原尺寸落地；舞台未实测回退 `H5_PAGE_SIZE`（340×560）；`width` / `height` / `fixed` 原样返回。`facsimile` 已启用时只锁几何折算（`h5` 档不覆盖）：版框 / 界行按固定开本，改几何会让界行与文字列错位；`width` / `height` 档不改几何、整页 transform 等比缩放，与仿真兼容。随包导出 `H5_PAGE_SIZE`（340×560，不进 `PAGE_SIZES` 预设表）与 `StageBoxSize` 类型。
  - **`BtBookView.fitScale?: number`**（vue 新增 prop，`page` / `scroll` 模式）：传入有限正数时直接作为整页缩放倍率（覆盖 `contain` 与 `Math.min(1, ratio)` 的「只缩不放」），另受横向安全阀约束（不超过容器可用宽 / 页宽，不致冒出横向滚动条或裁掉页缘），激活时预留 `scrollbar-gutter: stable` 槽位使可用宽不随溢出二次变化（重算 watch 为 post-flush，避免档位切换瞬间读旧宽恰差一个滚动条宽）；page 模式纵向溢出由本容器滚动承接（`overflow: auto` + `margin: auto` 居中退化起点锚定，滚轮在溢出时让位原生滚动，不溢出时零视觉变化），scroll 模式槽位宽同步为 页宽 × 倍率（修「槽位固定页宽两边留白」）。未传 / 非法值回退原 `fit` 策略；`scroll-flow` 模式不受影响。
  
  demo 宿主侧（私有包）：面板下拉四档固定文案（自适应宽度 / 自适应高度 / 自适应 H5 / 固定，不随书写方向换词）；新增 `use-stage-size`（`ResizeObserver` 实测 `.app__stage` 并按 computed style 扣内边距）；`use-layout-tokens` 按「主题基准 → 窄屏适配缺省 → 用户补丁 → 折算」合并生效层并暴露 `fitScale`，同时喂给 `BtBookView :fit-scale` 与编辑画布 `editorScale`（编辑态限幅 0.2~2，超出走画布横向滚动）；面板回显改读声明层，并在宽 / 高档下另回显生效层倍率（「视图缩放 ×N.NNN」，量不到舞台时明示回退固定开本，消除静默失效）；废除旧的 `mobileLayoutPatch` 无条件压页宽，窄屏只在用户未选过适配时缺省按 `h5` 取形；`use-editor-zoom` 的「适应」改用同一份舞台实测值。
- 直排列级拆分补齐主轴契约：`MeasurableBlock` 新增 `axis: 'row' | 'column'`（缺省 `'row'`，导出 `BlockAxis` / `blockAxisOf`）；`extractBlocks` 新增 `axis` 选项，直排给可拆块标注 `'column'`；`MeasurePaginationResult` 与 `buildPagedLayout` 结果新增 `axis`，`Reader` 新增 `axis` / `blockAxis` 并透传（`repaginate({ axis })` 可切换）；demo 量尺同步透传。分页算术仍只认沿主轴的尺寸，横排 / 直排结果一致；文档 04 / 18 与能力清单同步。
- ruby 行盒精修（B6）：注音行高按实测行盒判页，不再用均高近似。
  
  - `layout`：`MeasurableBlock.lineMainSizes`（逐行主轴尺寸）+ `lineCountOfBlock` / `lineMainSizeAt` /
    `lineRangeMainSize`；`paginate` 按行累加判页与结算片段，孤寡行 / keepWithNext 同口径；
    缺省 / 长度不符回退 `lineSize`，行为与旧版一致；
  - `vue`：量尺以基础文本矩形划行（排除 `<rt>` 注文误判为独立行），再把注音矩形按交叉轴并入所在行，
    产出 `MeasurePaginationResult.lineMainSizes`（直排为逐列列宽）；`buildPagedLayout` 增量合并 /
    陈旧项清理 / 片段尺寸同步；`ruby > rt` 增 `line-height: 1.2`（不继承正文大行距）；
  - `reader`：`ExtractBlocksOptions` / `ReaderOptions` / `RepaginateOptions` 新增 `lineMainSizes`，
    块携带逐行尺寸、行数取数组长度、均高取均值作回退；
  - `exporter-pdf`：`PrintDocumentOptions.lineMainSizes` 透传逐页分页，PDF 与屏幕分页一致。
- 表格数据与交换层增强：`table-row` 新增 `header`（表头行），`table-cell` 新增 `colspan` / `rowspan` / `align`（默认值在 IR 中省略）；HTML 导入识别 `<thead>` / `<th>` 与 `colspan` / `rowspan` / `align`（含 `data-align`、内联 `text-align`），导出输出 `<thead>` / `<th>`、原生跨行跨列与 `data-align`（无表头行时保持旧输出）；编辑器单元格 `toDOM` 输出原生 `colspan` / `rowspan`；新增命令 `toggleTableHeaderRow` / `setTableCellAlign` 与 `TableCellAlign` 类型；book CSS 增加单元格对齐与表头底色规则；文档 21 与能力清单同步。
- 竖排细节包（B7）：竖排标点 / 引号形态与数字分组。
  
  - `layout` 新增 `vertical-text.ts`：`VERTICAL_PUNCTUATION_FORMS`（`。︒` `、︑` `「﹁`
    `」﹂` 等 22 个竖排呈现形式）、`toVerticalPunctuation`、`toKanjiDigits`、
    `toFullwidthDigits`、`transformVerticalText`、`needsVerticalTextTransform`；
    转换逐字符一一对应，不改字符数 / 文本偏移；
  - `combine-upright` 新增 `longDigits: 'kanji'`（超长数字串转汉字数字直排），
    `segmentForVertical` / `combineUprightCss` 选项改为可部分传入；
  - `serializeNode` 新增 `SerializeNodeOptions.verticalText`（缺省不转换，交给浏览器
    `vert` 特性；代码块逐字输出不受影响）；
  - `exporter-pdf` 新增 `PrintDocumentOptions.verticalText`，`auto` / `paged` 两条
    打印路径透传。
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
- 直排排版引擎 v2 批 2（渲染层）：直排行内流——正文连排 / 双行夹注固定双列 / 低格与抬头标记。
  
  - **行内流渲染**（`serializeVerticalFlow`，`layout/html`）：直排（古籍直排 +
    仿真）页内容改写为行内流——段落行内化（`.bt-vpara`）、容器 `.bt-vflow` 在
    `vertical-rl` 下自然换列，列宽由根行高（= 列距）决定、与界行网格咬合，
    根治「CSS 块流段段换列、版面半空」（连排：段界靠格位标记，古籍原生形态）；
  - **双行夹注固定双列**：`.bt-vnote` 恒 1 大字位宽 × 整列高的双列小字盒
    （「从上排到底」古籍形制）——`splitDoubleNoteLines` 按每子列容量
    （每行大字数 × 2）拆右 / 左子列，竖排 block 流自右向左、DOM 序即阅读序，
    字步进补至半字位（n 字占 ⌈n/2⌉ 字位）；直排 multicol 轴向不可靠已实测
    排除，采用显式双列；
  - **行款标记渲染**（批 1 属性消费）：低格 / 挪抬 → 段首空位盒（`.bt-vpad`
    N 字位高）；提行 / 平抬 → `<br class="bt-vbreak">` 断列 + 抬升列首空位；
    `lineRuleOverhead` / `doubleNotePlaceholderChars` 提供无 DOM 导出折算口径；
  - **三端接入**：预览 `BtBookView`（page / scroll / 对页直排分支）与量尺
    `pagination-measure`（直排同形态实测——行边界与夹注原子性自洽）；
  - 隔离：横排产物逐字符不变；夹注盒宽经间接变量 `--bt-vnote-pitch` 接入
    列距（非仿真直排不出现仿真变量名）；古典基线第十六 / 十七次重锁。
- 直排排版引擎 v2 批 4（行款规则全链）：低格 / 抬头 / 提行的分页折算、导出同源与横排降级。
  
  - **分页折算**：`MeasurableBlock` 新增 `breakColumn`（列级断列）——段落行款
    `breakLine` / 平抬（`lift: 'newline'`）在 extractBlocks 时标注，paginator 在
    直排（axis column）下把当前列剩余空间弃用（usedMainSize 对齐列距），块从
    新列顶格起写；横排无操作（降级换段）。`defaultEstimator` 接入
    `lineRuleOverhead`：低格 / 挪抬使首行有效容量扣减，行数估算不再偏少
    （提行 / 平抬的断列空耗由实测路径承载，估算不折算）；
  - **导出同源**（exporter-pdf paged 直排）：段落 / 引文与预览共享
    `serializeVerticalFlow`（连排 / 双行夹注固定双列 / 低格与抬头标记），
    续排片段（fromLine>0）自动省略行款前缀；`serializeVerticalFlow` 新增
    `nodeOptions` 透传（tagOverrides / rewriteSrc / verticalText / revisionView），
    夹注子列内容改用 `sliceNodeByCharRange` 切片——夹注内的行内标记
    （专名号 / 着重等）随所在子列保留（批 2 纯文本简化的修正）；
  - **横排 / EPUB 降级**：book-css 新增行款属性选择器——段落 / 引文的
    `data-indent` 1~4 输出 `text-indent`（覆盖令牌缩进）、挪抬在无低格并存时
    补 1em（`:not([data-indent])` 门；并存时被吸收的口径差异记录于 docs/03）；
    无行款属性的段落不受影响（EPUB 老引擎 flatten 安全降级为令牌缩进）；
  - 古典基线第十八次重锁；docs/03 新增「行款规则」节、docs/08 导出同源说明。
- 直排排版引擎 v2 批 5（版面骨架扩展）：书耳 / 鱼尾扩展 / 眉栏 / 眉批旁批装饰位 / 两截本三截本。
  
  - **书耳（耳题）**：`facsimile.ear` 选项——版框外上角小方框竖排题本页篇名；
    `reader.getPageEarText`（章名 → 卷名 → 书名回退，封面不标）与
    `serializePageEar` 三端共用；预览（page / scroll / 对页）、编辑画布、打印
    paged 同步注入；
  - **鱼尾扩展**：数量枚举至三 / 四尾（多尾沿版心带均布、上下相向交替——偶数
    序尾垂直镜像）；新增 `fishTailStyle`（black / white / line / floral 四态），
    序列化输出 `data-fish-style`；
  - **眉栏**：`facsimile.eyebrow` 选项——版框上方天头横线区；
  - **眉批 / 旁批装饰位**：仿真直排下 `head-note` 分流到天头容器（多列小字）、
    `margin-note` 分流到界行外窄条（预览与打印 paged 同口径；编辑画布保持
    flow 原位可编辑）；
  - **两截本 / 三截本（两截楼）**：结构节点 `bands`（2|3，`bandRatio` 缺省
    0.4/0.6 与 0.25/0.35/0.4）+ 内容节点 `band` 归截——paginator 按截位分组、
    各截以「页容量 × 截高占比」独立装箱、页按序交错合并；渲染层
    `groupNodesByBand` 分组包 `.bt-bands` 分层容器（截间横线、各截独立连排），
    预览与打印 paged 同构。已知限制：与页底浮注并存未支持、`bandRatio` 自定义
    占比渲染读取待后续、编辑画布暂按平铺。
  - 花栏（竹节 / 博古 / 卍字栏）按计划低优先顺延；古典基线零变化（装饰仅
    facsimile 路径）。
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

- 新增目录生成 / 刷新：`insertToc`（按卷 / 章 / 节等结构节点生成 `toc` 块，标题行与条目带 `toc-title` / `toc-entry` / `toc-subentry` 版式角色与锚点链接；已存在目录时原位替换内容并保留 id，支持 `maxLevel` / `includeHeadings` / `links` / `hrefPrefix` / `title`）、`collectTocEntries`（文档先序收集条目，跳级层级收敛为父级 + 1）与 `buildTocNode`（由条目构造目录节点）。
  
  `layout` 的 `book-css` 补目录链接规则：`.bt-toc .bt-mark-link` 跟随目录版式，不另加颜色与下划线。
- 修复「epub 导入后直接导出，产物在部分阅读器打不开」（第四次修复，根因在 XML 格式良好性）
  
  三处缺陷：
  
  1. **P0 非法 XML 字符**：外部 EPUB 正文常含 XML 1.0 非法字符（C0 控制符如 U+000B / U+000C / U+0007、
     U+FFFE / U+FFFF）。xmldom 与浏览器 DOM 解析时**宽容放行且不报错**，实测 IR 层仍会原样携带，
     导出后落在 XHTML / OPF / NCX 里 → 严格 XML 解析器（expat / RMSDK 内核）报
     `not well-formed (invalid token)`，整机拒绝打开。
     现于唯一的序列化出口统一净化：`html-serializer` 新增 `stripInvalidXmlChars` / `escapeXml`，
     并让 `escapeHtml` 委派给 `escapeXml`（既有调用点零改动即获得净化）；
     exporter-epub 的 xhtml / opf / ncx / nav 四个模板改走 `escapeXml`。**代理对（emoji）明确放行**，不被误删。
  2. **P1 导入书目录为空**：`buildNavItems` 原先只认 `SECTION_TYPES`（volume / chapter / section / …），
     而外部 epub 导入后是「无结构节点 + 一串 heading」的扁平 IR → nav / ncx 输出为空。
     现新增第二个来源：**顶层 heading（level ≤ 2）**，h2 嵌套到所属 h1 之下；
     无 id 的候选标题由 `planDocument` 统一预分配 `bt-a-N` 锚点并注入 XHTML
     （SECTION_TYPES 分支行为与 demo 书籍口径保持不变）。
  3. **P1 图片死链**：导入的图片保留包内相对 `src`（如 `../images/cover.png`），导出时不打包媒体 →
     生成指向不存在路径的 `<img>`。现 `epubToHtml` 默认开启 `inlineImages`（可 opt-out），
     把包内图片按 OPF manifest 的 media-type 内联为 data URI；外链（`http(s)` / `data:`）不动，
     资源缺失或超过 2 MB 时跳过不改写。
- 古籍仿真直排「文字超出界行」修复——新增行款网格对齐层（`buildFacsimileGridCss`）：
  
  - 根行高绝对化为列距 px（`buildRootStyle` 与 `buildBookCss` 根规则同口径），
    倍数行高按后代字号重算导致的行盒偏移消除——未显式设行高的后代恒落格；
  - 显式行高的类归格：标题 / 代码块 / 页底注区 → 列距；字号超列距的标题分级与
    封面 / 书名页大字按构建期折算落 k 格；
  - 双行小注「一格双行」：**不用 CSS 多栏**（Chromium 直排 balancing 拦腰
    分段、溢出栏落位错乱，`column-fill: auto` 被忽略致列高塌缩——均实测不可
    依赖），改为子列行高 = 列距 / 2 的**自然换列**：读序（右子列从上读到底、
    余文续左子列）与子列满高（整条版心高）由换行引擎天然保证，两个子列恰占
    一格；`min-width` 兜底短注占满一格；
  - 块轴装饰归零：引文 / 眉批 / 牌记 / 题跋 / 版框节 / 注区 / 分隔线 / 表格
    单元格的块轴 margin / padding / border 收敛，行内轴间距与配色保留。
  
  三重闸门（pageDecoration + facsimile + 直排）内生效：预览 / 编辑分页 / PDF
  paged 导出三端一致；古籍直排（非仿真）、现代横排、EPUB / auto 产物逐字符
  不变。仿真直排的视觉变化：双行小注子列更紧凑（一格双行，古籍原貌）、页数
  可能微变；残余限制见 docs/22 已知限制（奇数子列超长注 / 表格 / 插图）。
- 修复阅读视图分页越界（现代横排 / 古籍直排 / 古籍仿真直排同一根因），样本：杜诗详注 EPUB。
  
  - **逐行主轴尺寸改为「行推进量」**：`pagination-measure` 原取单个文本矩形的主轴跨度（`boxEnd − boxStart`，16px 字号 / 30.4px 行高时约 23px）作为每行尺寸，比真实行推进小约 1/4；`extractBlocks` 的 `lineMainSizes` / `lineSize` 随之偏小，`paginate` 的 `linesFitting` 高估每页可容纳行数 / 列数，拆分片段渲染后越出版心（横排页底、直排页左）。现按「相邻行起缘之差」累加、末行补齐到块体尺寸，各行之和等于块高 / 宽；ruby 注音撑高的行由增量自动体现（不再需要并入 `<rt>` 矩形）。量测异常（非正增量 / 超块体 / 行数不符）仍回退均高。
  - **图片块按版心限幅**：`.bt-image` 改为块级（消除行盒基线留白）并按版心物理宽高给 px 上限。此前仅 `max-width: 100%`，大图（扫描件常上千 px，图片块不可拆）在空页被强制放入后撑出纸面 / 版心；量尺与渲染共用该样式，实测尺寸随之收敛。
  - **测试**：新增 `lineAdvances` 纯函数用例（等行高 / 注音撑高 / 直排 rl 递减 / 四类异常回退）；古典 CSS 基线快照按有意变更重锁。
- 字图识别补口：EPUB 内联 SVG 缺字图不再漏判，导入保留图片宽高，纯字图段落整块，demo 打开存量书自动归一化回写。
  
  - **core**：`normalizeGlyphImages` 的内嵌 data URI 信号扩为含 `data:image/svg+xml`——EPUB 缺字图大量以内联 SVG 顶替，此前该形态只剩「切断句子」单弱信号而保守保留成块级插图（脱离上下文独占一行居中）；现与位图 data URI 同为「内嵌图片」弱信号，叠加位置信号即可判定归并。保守语义不变：前段已收尾等单弱信号场景仍保留并写报告，不丢数据。
  - **editor**：`image` 的 parseDOM 保留 `<img>` 原生 `width` / `height`（缺省 / 非法归一为 null，`attrs` 新增可空声明）——带尺寸的缺字图（EPUB / 网页主流 `<img width="16" height="16">` 形态）导入即命中「近方形小图」强信号；IR ⇄ PM 往返无损。
  - **layout**：块级 `image` 序列化把 `width` / `height` 输出为原生属性（正数才输出），不再降级为 `data-*`——浏览器可在图片加载前预留版位，导出产物尺寸保真。
  - **reader**：`isLeafBlock` 对「只含行内字图、无裸文本」的段落判整块——不再下钻把 `glyph-image` 抽成独立块、脱离所在段落；`findNodeById` / `indexNodeAnchors` 复用同函数，口径自动一致。
  - demo 宿主侧（私有包）：书架打开旧书时自动跑 `normalizeGlyphImages`，发现可归并字图即回写书库并消息条提示（存量书一次修复永久生效）；草稿恢复同样归并（幂等，进入编辑器后自动保存落盘新基线）。
- 直排字图不再旋转 90°：移除书册样式表对 `.bt-glyph-image` 的 `transform:
  rotate(90deg)` 直排分支。缺字字形图是「正立文字的图片」——直排下汉字本身
  直立不旋转，字图同理，无论横排 / 直排恒以原图方向展示（与行内 SVG 合成
  字形 `.bt-glyph` 的既有口径一致，弹窗放大原本即按原图方向展示）。
- 补全 `book-css.ts` 样式空洞（P1-3 / R4）：html-serializer 序列化产物带有 class 但 `book-css` 缺少对应规则，导致这些元素插入后不可见。现补上 `.bt-seal`（印文只存于 `attrs.text`、元素为空）、`.bt-fish-tail`、`.bt-border-frame`、`.bt-inline-note`、`.bt-variant-char`（注意 `.bt-mark-variant` 已有、载体此前缺失，存在不对称）、`.bt-tail-note`（此前只出现在后代选择器、无基样式）的基样式。已覆盖的 double-note / head-note / collation-note / imprint / colophon / footnote / endnote / margin-note / collation-mark（`::after{content:attr(data-symbol)}`）/ taboo-char 不受影响。
- 修复标题经 IR 往返后层级错位（P1-2 / R3）：schema 中 heading 的 `level` 默认值与 html-serializer 的缺省回退不一致——`heading` spec `level.default = 1`，而 `html-serializer` 缺省回退为 `2`，导致 H1 经 IR 往返后被渲染 / 导出成 `<h2>`（H2/H3 正常）。现统一回退为 `1`，使 `equals spec 默认值` 的省略输出与缺省回退口径一致（兜底默认值须与 spec 默认一致）。
- P4 批 1（I4）：覆盖率统一配置与阈值门槛。各包新增 `test:coverage` 脚本（v8 provider，`text + lcov` 报告，排除 `__tests__` / fixtures / 类型声明）；`core` / `layout` / `reader` 按真实基线略下调设阈值（行 82 / 94 / 95）在 CI 拦截回归，其余包只报告不拦；CI 以 `pnpm test:coverage` 取代测试步骤并把各包 `coverage/lcov.info` 归档为 artifact。
- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
- P4 批 3（I7）：可观测性。core 新增可插拔 Profiler：端口 `span(phase, labels?)`、缺省 no-op（`NOOP_PROFILER`，零行为零开销）、收集器 `createCollectingProfiler()`（按阶段 × 标签聚合 count/total/min/max/mean，`reportJson()` / `reportText()` / `reset()`）与 `PERF_PHASES` 阶段常量（与 bench 基准同口径）；`paginate` 与 `exportEpub` 接受可选 `profiler` 注入（EPUB 按 plan/xhtml/nav-opf/zip 细分 span，缺省零开销）；vue `PERF_*` 常量与开关语义不变，开启后埋点同步记入 `getVuePerfProfiler()` 模块级收集器；API 回写 docs/13 与 docs/18。
- 设置面板预设值增强：版面与页面新增版式套餐（现代标准 / 紧凑电子 / 疏朗典藏 /
  古籍刻本 / 大字阅读）、正文字号 / 行距 / 字距 / 首行缩进单项 chips 与宋体 / 黑体 /
  楷体 / 仿宋字体栈预设；古籍仿真补全鱼尾数量（三 / 四）、新增鱼尾样式 chips、
  带宽四档预设与书耳 / 眉栏 / 版心交替开关；页眉页脚新增关闭 / 经典 / 学术 / 宽裕
  组合预设。`PAGE_NUMBER_STYLES` 补 `LEAF_AB`（`leaf-ab`）枚举，面板页码下拉可选
  叶次 a/b。
- 表格编辑增强：
  
  - **editor**：`table` / `table-row` / `table-cell` 渲染为语义 `<table><tbody><tr><td>`（保留 `bt-*` class 与 `data-bt-id`），修复插入表格后编辑画布一片空白；
  - **reader**：表格加入复合原子块，`extractBlocks` 不再下钻到单元格段落，分页与序列化保留完整 `<table>` 包裹；
  - **layout**：表格样式随书写方向（`writing-mode: inherit`），空单元格保留最小尺寸，直排下不再塌陷；
  - **vue**：新增 `BtTableSizePicker`（Word / WPS 式行 × 列网格 + 精确输入），配合工具条在直排下同样可插入表格。
