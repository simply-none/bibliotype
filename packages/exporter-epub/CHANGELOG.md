# @bibliotype/exporter-epub

## 26.10.25-rc.1

### Minor Changes

- 新增尾注聚合：`groupEndnotes(root, { scope, title?, id? })` 与导出选项 `endnoteGrouping: 'keep' | 'chapter' | 'book'`、`endnoteTitle`。
  
  - `chapter`：每章末尾追回「注释」标题行 + 该章尾注（嵌在节内的尾注上提到所属章，无章可归的兜底排到书末）；
  - `book`：全部尾注集中到书末新增一章（id 缺省 `endnotes`，冲突自动追加 `-2`）；
  - 导出期深拷贝重排，不改动原文档；节点 id 不变，正文 `noteref` 链接照旧可跳；
  - 只处理 `endnote`，脚注与边注保持就地。
- 新增 `pageDirection: 'ltr' | 'rtl'`（缺省按书写模式推导：直排 `vertical-rl` → `rtl`），`rtl` 时输出 `<spine page-progression-direction="rtl">`；`buildOpf` 新增 `pageProgressionDirection` 与 `guide` 输入，EPUB 2（`version: '2.0'`）自动输出 `<guide>`（`toc` → `nav.xhtml`、`text` → 首个内容文档），EPUB 3 不输出。
- 注释（脚注 / 尾注 / 边注）端到端补齐：
  
  - `core` 新增注释节点公共契约 `NOTE_NODE_TYPES` / `NOTE_ROLES` / `isNoteNodeType` / `isNoteNode` / `noteRoleOf` / `NOTE_LABEL_STYLES` / `formatNoteLabel` / `collectNotes` / `nextNoteIndex`（按类型分别编号，手写 `attrs.marker` 优先）；`document-stats` 复用同一类型表。
  - `editor` 新增 `insertFootnote` / `insertEndnote` / `insertMarginNote` / `insertNote` 命令：按同类现存注释数量自动编号（arabic / circled / chinese），光标已在注文内时插在该注释之后；注释节点规格补 `marker` 属性（导出 `NOTE_NODE_ATTRS`）。
  - `layout` 序列化器新增 `epubSemantics` 选项：注释块输出 `epub:type`（footnote / endnote / sidebar），注码提为 `.bt-note-marker` 并注入首个段落内与注文同起一行；`book-css` 补注码样式。
  - `exporter-epub` EPUB 3 路径自动开启注释语义（EPUB 2 不输出 `epub:type`）。
- P0 能力接线批次（B5 / C4 / C6 / C9 / D2 / D4 / E9）：
  
  - **B5 页底注区渲染**：`serializePageNotes` + `.bt-page-notes` / `.bt-note-continued` 样式，`PaginatedPage.notesCarried` / `Reader.isPageNotesContinued`，`BtBookView` 输出注区槽（续前页标记、超限告警，不裁剪）。
  - **C4 表格合并 / 拆分**：`mergeCells` / `splitCell`（矩形校验、跨表头冲突拒绝、非矩形不派发事务；拆分补齐空单元格）。
  - **C6 / D2 标注**：`core` 新增 `ExportComment` 契约；`annotationsToMarkdown`；`useAnnotations` + `BtAnnotationSidebar`（书签 / 高亮 / 笔记 / 评论四 tab）；`includeComments`（EPUB / 站点，缺省 false）。
  - **C9 统计**：`useDocumentStats`（300ms 防抖）+ `BtDocumentStats`（字数 / 块数 / 阅读时长 / 注释数 + 章节分布，纯 CSS 条形）。
  - **D4 手势与键盘**：`BtBookView` 新增 `fontSize` / `update:fontSize` 双指缩放（12–32px），scroll 模式可聚焦并支持 PageUp / PageDown / 空格 / Home / End 滚屏。
  - **E9 校验 CLI**：`runValidateCli` + `bt-validate-epub`（`--json` / `--help`，退出码 0/1/2），CI 增加合法样本与损坏文件校验步骤。
  - **依赖**：新增合法方向 `vue → annotation → core`；导出器只消费 `ExportComment`，不依赖 `annotation`。
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
- P4 批 6（E3）：新增字体内核包 `@bibliotype/fonts`，EPUB / 站点导出支持内嵌子集字体。
  
  - **用字统计**：`collectDocumentChars(document)` 遍历 IR 文本节点（含 ruby / 标题 / 注文，过滤控制符、保留空白与标点），输出去重升序字符集 `chars` 与逐字 `counts`；80 万字文档只保留唯一字（测试：8 字）。
  - **可插拔子集后端**：`prepareFontBundle(document, fonts, { backend })`（异步，后端可为 wasm / 子进程，如 `subset-font` / `fonttools`），本包不内置字体解析二进制；未提供后端时按原始字节嵌入并告警。后端抛错或返回空字节抛 `FONT_SUBSET_FAILED`（新错误码，含 `fontId` / `family` / `backend` 与根因）。
  - **@font-face 与命名**：按格式嗅探（woff2 / woff / otf / ttf）与内容哈希生成确定性文件名 `bt-<family>-<weight><i>-<hash8>.<ext>`，`font-display` 可配，产物 `FontBundle{ faces, css, licensePath, license, rights, report, warnings }`。
  - **缺字回退**：后端可返回 `missingChars`，告警按主题字体栈给出降级链（与 K6 同口径）；未返回时标记「覆盖信息不完整」，不假阴性。
  - **体积与许可**：覆盖报告含 `sourceBytes / subsetBytes / reduction`（80 万字测试下降 ≥60%）；许可写入 `fonts/LICENSE.txt`，简短版权行写入 OPF `dc:rights`。
  - **exporter-epub**：新选项 `fonts?: FontBundle` —— `@font-face` 前置到 `style.css`，字体字节写入 `OEBPS/fonts/`，manifest 登记 `font-N` / `font-license`，告警以 `FONT-REPORT` 经 `onValidation` 报告（`validate: false` 仍报告）；EPUB 2 路径同样支持。
  - **exporter-site**：新选项 `fonts?: FontBundle`，`SiteFile` 新增可选 `data: Uint8Array`（字体二进制，`text` 为空串），`@font-face` 前置到站点 `style.css`，告警并入 `SiteExportResult.warnings`。
  - **测试**：`@bibliotype/fonts` 21 例（统计 / 体积 / 缺字回退 / 许可 / 确定性 / 错误）、`exporter-epub` 5 例、`exporter-site` 4 例；`docs/07`、`docs/28` 已回写。
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

### Patch Changes

- 修复 EPUB 导出后在京东读书等阅读器一直"加载中"打不开（P0）。上一轮已改为 EPUB 2.0 + `toc.ncx`，但仍残留 EPUB 3 专属结构；京东读书底层为 Adobe RMSDK（EPUB 2 严格 XML 解析器），解析 `version="2.0"` 包时遇到这些节点会失败而卡死。本轮补齐为"标准 EPUB 2.0"：
  
  - OPF：`version="2.0"` 路径不再输出 EPUB 3 专属 `<meta property>`（`dcterms:modified`、副标题 `refines`），改以 `dc:date` 承载修改日期；补 `xmlns:opf` 命名空间与 `dc:date`。（`version="3.0"` 路径仍保留 EPUB 3 meta 以兼容 EPUB 3 阅读系统。）
  - manifest：EPUB 2 路径下 nav 条目去掉 EPUB 3 专属 `properties="nav"`（RMSDK 不识别）；保留 `toc.ncx` 与 `nav.xhtml` 并存。
  - 内容 XHTML：doctype 由 HTML5 `<!DOCTYPE html>` 改为 XHTML 1.1（`PUBLIC "-//W3C//DTD XHTML 1.1//EN"`），`<head>` 以 `<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>` 替代 HTML5 `<meta charset>`，匹配 RMSDK 严格的 XHTML 1.1 解析要求。
  
  导出确定性不受影响，exporter-epub 单测覆盖 EPUB 2 / EPUB 3 两条路径。
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
- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
- P4 批 3（I7）：可观测性。core 新增可插拔 Profiler：端口 `span(phase, labels?)`、缺省 no-op（`NOOP_PROFILER`，零行为零开销）、收集器 `createCollectingProfiler()`（按阶段 × 标签聚合 count/total/min/max/mean，`reportJson()` / `reportText()` / `reset()`）与 `PERF_PHASES` 阶段常量（与 bench 基准同口径）；`paginate` 与 `exportEpub` 接受可选 `profiler` 注入（EPUB 按 plan/xhtml/nav-opf/zip 细分 span，缺省零开销）；vue `PERF_*` 常量与开关语义不变，开启后埋点同步记入 `getVuePerfProfiler()` 模块级收集器；API 回写 docs/13 与 docs/18。
