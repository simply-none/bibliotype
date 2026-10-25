# @bibliotype/core

## 26.10.25-rc.1

### Minor Changes

- 新增文档统计与词表检查：`countDocumentStats`（正文字数、注释字数、词数、阅读时长、叶块数、结构节点字数分布，支持注释单独 / 计入 / 忽略与标点口径）、`checkWordList`（按调用方词表做错别字 / 敏感词 / 术语检查，返回块内偏移、摘录与文本锚点）；配套导出 `DEFAULT_READING_CHARS_PER_MINUTE`、`isStructureNode`、`structureLevelOf` 与相关类型。
- 新增术语一致性比对：`checkGlossary(document, glossary, options?)` 按「规范写法 + 异写」分组统计——返回全部异写命中（含 `nodeId` / `offset` / 文本锚点 / `suggestion`）、逐术语的规范用量与异写用量、是否已统一 / 全文未出现；`validateGlossary(glossary)` 校验表本身（空写法 / 重复定义 / 异写等于规范写法）。匹配口径复用 `checkWordList`（文本块内字面匹配，默认含注释）。
- 《能力扩展清单》第一批落地：补齐「位置 / 标注 / 精排 / 引用 / 分发」五块底座。
  
  - `core`：新增锚点契约（`Anchor` / `serializeAnchor` / `resolveAnchor` / `nodePlainText` /
    `locateNode`）、IR 结构校验（`validateDocument` + `DOCUMENT_ISSUE_CODES`）、
    schemaVersion 逐级迁移（`migrateDocument` / `MigrationStep` / `MigrationPathError`）、
    资产存储端口（`AssetStore` / `AssetPayload` / `AssetRef` / `ASSET_KINDS` /
    `toAssetRef` / `hashAssetBytes` / `isAssetStore`）。
  - 新增 `@bibliotype/annotation`：高亮 / 书签 / 笔记 / 评论模型（共用一套结构 + 锚点定位），
    `AnnotationStore` 容器（读写 / 过滤 / 订阅 / hydrate / persist）、确定性序列化与孤儿解析。
  - 新增 `@bibliotype/typography-cjk`：禁则避头尾（含 zh-Hans / zh-Hant / ja 三套配置）、
    标点挤压、中西文混排间距与 CSS 声明输出，全部纯函数、零依赖。
  - 新增 `@bibliotype/xref`：两遍排版页码索引（`buildPageIndex`）、
    `{{page:id}}` / `{{ref:label}}` 占位替换与交叉引用登记表。
  - 新增 `@bibliotype/textconvert`：繁简 / 异体字转换（内置常用字表 + 词组保护 +
    OpenCC 适配 + 歧义安全的反向表）。
  - 新增 `@bibliotype/adapter-http`：远端 REST 存储适配器（文档 + 资产双端口、
    错误语义明确、fetch 可注入）。
  - 新增 `@bibliotype/exporter-site`：静态站点导出（目录页 + 分节页 + 样式 +
    搜索索引 + IR 原文，纯函数、输出确定）。
  - 文档：新增 docs/23～29 七篇；根 README、docs 索引、core README 与开发规范依赖矩阵同步。
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
- P2 收口（G2 网络 Provider / H2 SQLite 适配器）：
  
  - **G2 新增 `@bibliotype/provider-websocket`**：`WebSocketProvider`（join → sync → update 握手、指数退避 + 抖动重连、离线队列 `Y.mergeUpdates` 合并、超限转全量、握手超时与协议版本校验）、`BroadcastProvider`（同源多标签、迟到加入 `hello` / `state`）、协议帧与 8 MiB 上限、`startReferenceServer` 参考服务端（`ws` 为**可选 peer**，客户端入口不依赖）。Awareness（G3）仅留协议扩展位。
  - **H2 新增 `@bibliotype/adapter-sqlite`**：宿主注入驱动（`createBetterSqliteDriver` / `createSqlJsDriver`，包内零引擎依赖），能力对齐 IndexedDB——分片文档、`BookLibraryStore` / `BookSummaryStore` / `AssetStore` / `DocumentVersionStore`、`settings` KV；`PRAGMA user_version` 幂等迁移；保存 / 清理走事务，失败回滚；`clear()` 保留资产与历史，`close()` 不关闭宿主驱动。
  - **`@bibliotype/core`**：新增 `storage/chunking`（分片内核，原 `adapter-indexeddb/chunked-store` 上移）并导出；新增 `@bibliotype/core/testing` 测试子入口（存储契约套件，仅 ESM、external vitest）。
  - **`@bibliotype/adapter-indexeddb`**：分片符号改为从 core 再导出（公开 API 不变），测试改用 `@bibliotype/core/testing` 契约套件。
  - **依赖**：生产依赖零新增；`ws` / `sql.js` 仅 devDependency（`ws` 另为可选 peer）。
  - **发布**：两个新包加入 changeset `fixed` 列车，与其余包同版本发布。
- P3 古籍能力批次（K3 句读 / 专名标注、K6 缺字兜底、K7 典籍元数据）：
  
  - **K3 句读 / 专名自动标注**：`classical` 新增 `suggestJudou` / `judouMarkerRange` / `JUDOU_SYMBOLS` / `EXISTING_PUNCTUATION`、`detectProperNames` / `BUILTIN_PROPER_NAME_TERMS`（内置人名字典）与 `ProperNameDetector` 模型端口、`buildAnnotationSuggestions` / `collectSuggestionBlocks` / `countSuggestions`（确定性 id、段内 UTF-16 偏移、同偏移去重）；新增 `judou` 标记（`attrs.symbol` / `source=auto` / `suggestionId` / `rule` / `confidence`，编辑画布与序列化同口径）；新增命令 `applyJudouSuggestions` / `applyProperNameSuggestions` / `removeSuggestionMarks` / `commitJudouAsText`（单事务、可一次撤销）。`vue` 新增 `useAnnotationSuggestions`（待处理 / 已接受 / 已拒绝 / 已落地状态机）与 `BtAnnotationSuggestions` 审阅面板；布局侧新增 `.bt-mark-judou::after` 候选符号样式。
  - **K6 缺字与字形回退**：`core` 新增 `parseIds` / `formatIds` / `countIdsLeaves`（U+2FF0–U+2FFB 全部 12 个运算符，组件不足 / 超深给中文 issue）、`resolveGlyphFallback`（主字体链 → IDS → 方框，`GlyphProbe` 缺省视为命中）、`collectGlyphIssues` / `summarizeGlyphIssues`（字符 / 码位 / IR 路径 / 上下文，可按字符去重）；`layout` 新增 `renderIdsSvg` / `renderIdsGlyphHtml`（纯字符串、零依赖、同描述逐字节一致）与 `serializeNode({ glyph })` 逐字替换、书册样式 `.bt-glyph`；`exporter-epub` 新增 `collectEpubGlyphProblems`（`warning` 级 `ValidationProblem[]`，不阻断导出），`exporter-pdf` 新增 `collectPdfGlyphProblems` / `summarizePdfGlyphProblems`。`vue` 新增 `useGlyphAudit` 与 `BtGlyphAuditPanel`。
  - **K7 典籍元数据规范**：`BookMetadata` 新增可选字段 `classicalCategory`（经 / 史 / 子 / 集 + 二级类）、`editionType`（刻本 / 抄本 / 活字本 / 稿本）、`repository`、`callNumber`，配套 `CLASSICAL_DIVISIONS` / `EDITION_TYPES` 与 `validateMetadata` / `isClassicalDivision` / `isEditionType`（中文 issue，非法值拦截）；新增 `toDublinCore` / `serializeDublinCore`（固定键序 JSON）与 `toCnmarc`（001 / 200 / 205 / 210 / 215 / 300 / 606 / 686 / 690 / 801 / 905 字段行）、`migrateLegacyMetadata`（旧 `extra` 提升，幂等、顶层优先）；`exporter-epub` 的 OPF 补 `dc:subject` / `dc:type` / `dc:source`。
  - **兼容性**：均为增量导出与可选字段，既有函数签名不变；`serializeNode` 仅在显式传入 `glyph` / `tagOverrides` 等新选项时改变输出，默认产物逐字节不变；OPF 新增 `dc:subject` / `dc:type` / `dc:source`（无对应元数据时省略）；`judou` 标记为新增，既有文档不受影响。生产依赖零新增，库内仍不写存储。
- P3 多形态阅读（D5）与历史遗留修复：
  
  - **遗留修复（恢复链路宽容）**：`restoreLibrary` 与 `restoreSnapshot` 的校验选项现透传 `validateDocument`；**恢复路径默认把未知节点 / 标记类型降级为 warning**（而非直接判非法），因此含古籍插件标记（`collation-mark` / `judou` 等）的合法文档可正常备份恢复、可正常回滚历史版本。显式调用 `validateDocument`、传入 `validate: false` 或 `unknownTypesAsWarning: false` 仍保持严格。`core` 新增 `RESTORE_VALIDATE_DEFAULTS` / `validateRestoredDocument` 与 `RestoreValidationOptions`；`restoreSnapshot` 成功分支可额外回传 `warnings`。
  - **流式阅读（`scroll-flow`，横排）**：`reader` 新增 `buildFlowChunks`（`maxBlocksPerChunk` / `maxCharsPerChunk` 双上限、按章切块、确定性 key）、`Reader.getFlowChunks` / `getNode` / `getBlockIndex` / `getFlowChunkIndex` / `getPositionForNode`（按块序号取锚点位置，与既有 `restorePosition` 兼容）；`vue` 新增 `flow-model` 纯函数（`estimateFlowChunkHeight` / `resolveMountWindow` / `resolveAnchorChunkIndex` / `adjustScrollOffset`）与 `prefers-reduced-motion`，`BtBookView` 新增 `scroll-flow` 模式——按章分块、视口窗口懒挂载、骨架占位、滚动后实测高度校正、以锚点持久化进度（`initialPosition` / `update:position`），并支持 `flowChunkBlocks` / `flowRootMargin` / `estimateFlowHeight`。
  - **翻页动效**：`BtBookView` 新增 `pageTransition`（`none` / `slide` / `fade`，默认 `slide`），横排滑动 / 直排方向自适应，尊重系统「减少动态效果」与显式关闭；`vue` 导出 `usePrefersReducedMotion`。
  - **双页对照容器**：`vue` 新增纯布局容器 `BtSpreadLayout`（双栏 / 对页、中缝、标签）与 `BtCompareView`（单文档退化对页；传第二份文稿时左右并排、页码双向同步含重入守卫与越界钳制），`BtCollationCompare` 的 facing 模式改为复用 `BtSpreadLayout`（保留 `.bt-collation-compare__pane` 与 `data-role`，既有测试不受影响）。
  - **兼容性**：`BtBookView` 的 `mode` 仅扩展联合类型，`page` / `scroll` 分支代码路径与产物不变；`restoreLibrary` / `restoreSnapshot` 增加可选参数，**默认行为由「未知类型即失败」改为「未知类型降级告警」属有意行为修正**——含插件类型的文档此前会被整库恢复 / 历史回滚拒绝，现已可正常恢复；如需维持旧严格口径，传 `unknownTypesAsWarning: false` 即可。生产依赖零新增，库内不写存储。
- P3 阅读交互批次（D6 目录增强 / D9 注释交互 / D10 主题与外观市场）：
  
  - **D6 目录增强**：`Reader` 新增 `getPageOfNode` / `getOutlineItemAtPage`（复用分页索引，不遍历文档），`useReaderBinding` 暴露 `activeOutlineItem` / `activeOutlineKey`；`BtToc` 支持当前章高亮（含 `aria-current` 与滚入视野）、折叠记忆（`v-model:expanded-keys`）、目录内搜索（过滤 + 命中高亮 + 自动展开父级）、缩略图映射（缺省首字占位）；新增 `BtSidebarResizer`（拖拽 / 双击复位 / 方向键步进 / `role="separator"`）与 `useTocView`、`buildTocViewItems` 纯函数。
  - **D9 注释交互**：序列化补可定位锚点——注文 `data-note-id`、注码 `data-note-ref`（不改 `epub:type` 语义），书册 CSS 新增 `.bt-note-active` 激活态；`Reader` 新增 `getNoteAnchors` / `getPageOfNoteRef`；新增 `useNoteInteraction`（页容器事件委托、注码跳转、回跳、双向高亮、悬浮 / 聚焦 / 触屏预览、`Alt+←/→` 循环切换）与 `BtNotePreview`，`BtBookView` 在 page / scroll 两种模式接入。
  - **D10 主题与外观市场**：`core` 新增主题包格式（`kind` + `schemaVersion` + `tokens`，字段顺序确定）与 `serializeThemePreset` / `parseThemePreset` / `validateThemePreset` / `applyThemePreset`、`ThemePresetError`、`createThemePresetCatalog` 与内置 `night` / `eye-care` / `parchment`；令牌校验 `THEME_TOKEN_KEYS` / `validateThemeTokenValue`；字形覆盖 `analyzeGlyphCoverage`（`GlyphProbe` 端口）。`vue` 新增 `BtThemePanel`、`BtFontFallbackPanel`、`useThemePresets`、`createFontCheckProbe`、`splitFontFamilyList`。
  - **兼容性**：均为增量导出，既有函数签名不变；`serializeNode` 仅在注释块额外输出两个 `data-*` 锚点（EPUB / 站点 / PDF 同步），书册样式表新增激活态规则（仅阅读器加类时命中）；`applyThemePreset` 默认保留排版令牌，切换主题不影响用户自定义字号。
  - **依赖**：生产依赖零新增；库内仍不写 localStorage，目录折叠 / 侧栏宽度 / 主题包落盘均由宿主负责。
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

- 句首缺字图漏判修复——内嵌位图尺寸嗅探提供硬证据：
  
  - 新增 `sniffEmbeddedImageSize`（`image-size.ts`）：attrs 无尺寸时直接从
    data URI 头部读真实宽高（PNG 签名 + IHDR、GIF 逻辑屏幕、SVG 根元素
    `width/height`），只解 base64 前缀不解整图，零依赖、Node 与浏览器同构；
  - `normalizeGlyphImages` 识别接入嗅探：句首 / 句尾的字图（前段已收尾、无
    alt、无尺寸——docx / epub 导入主流形态）原只有「内嵌位图」单条弱信号被
    保守保留为块级插图，直排仿真下宽度非列距整数倍导致后续文字骑线；嗅探
    出近方小尺寸后凑足强信号，归并为行内 `glyph-image` 缝入后段头；
    内嵌大位图反而被嗅探尺寸正确排除为插图（原误保留）；
  - JPEG / WebP 不嗅探（照片插图主流形态，失败回退保守判定），不引入误判。
- 字图识别补口：EPUB 内联 SVG 缺字图不再漏判，导入保留图片宽高，纯字图段落整块，demo 打开存量书自动归一化回写。
  
  - **core**：`normalizeGlyphImages` 的内嵌 data URI 信号扩为含 `data:image/svg+xml`——EPUB 缺字图大量以内联 SVG 顶替，此前该形态只剩「切断句子」单弱信号而保守保留成块级插图（脱离上下文独占一行居中）；现与位图 data URI 同为「内嵌图片」弱信号，叠加位置信号即可判定归并。保守语义不变：前段已收尾等单弱信号场景仍保留并写报告，不丢数据。
  - **editor**：`image` 的 parseDOM 保留 `<img>` 原生 `width` / `height`（缺省 / 非法归一为 null，`attrs` 新增可空声明）——带尺寸的缺字图（EPUB / 网页主流 `<img width="16" height="16">` 形态）导入即命中「近方形小图」强信号；IR ⇄ PM 往返无损。
  - **layout**：块级 `image` 序列化把 `width` / `height` 输出为原生属性（正数才输出），不再降级为 `data-*`——浏览器可在图片加载前预留版位，导出产物尺寸保真。
  - **reader**：`isLeafBlock` 对「只含行内字图、无裸文本」的段落判整块——不再下钻把 `glyph-image` 抽成独立块、脱离所在段落；`findNodeById` / `indexNodeAnchors` 复用同函数，口径自动一致。
  - demo 宿主侧（私有包）：书架打开旧书时自动跑 `normalizeGlyphImages`，发现可归并字图即回写书库并消息条提示（存量书一次修复永久生效）；草稿恢复同样归并（幂等，进入编辑器后自动保存落盘新基线）。
- P4 批 1（I4）：覆盖率统一配置与阈值门槛。各包新增 `test:coverage` 脚本（v8 provider，`text + lcov` 报告，排除 `__tests__` / fixtures / 类型声明）；`core` / `layout` / `reader` 按真实基线略下调设阈值（行 82 / 94 / 95）在 CI 拦截回归，其余包只报告不拦；CI 以 `pnpm test:coverage` 取代测试步骤并把各包 `coverage/lcov.info` 归档为 artifact。
- P4 批 1（I6）：VERSION 单源自动化。`scripts/version.mjs` 发版时把日期版本自动写回 `packages/core/src/version.ts` 的 `VERSION` 常量（消除手工同步）；新增 `scripts/check-version.mjs` 在 `release:check` 前置校验版本列车一致与 `VERSION` 对账（漂移时非 0 退出并指出文件）；修复 changeset frontmatter 单引号包名（`@changesets/cli` 标准输出）解析失败的问题；`version-sync.test.ts` 覆盖对账 / 列车一致 / 写回幂等与漂移负例。
- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
- P4 批 2（I3）：体积预算门禁。根引入 `size-limit`（v11，兼容 Node 20）+ `@size-limit/preset-small-lib`，`.size-limit.json` 登记四个核心包 gzip 阈值（core 32 KB 最严档，layout 13 KB / editor 54 KB / vue 165 KB 次档，按交付基线上浮约 7–11%）；根脚本 `pnpm size`，CI 在 build 后执行门禁，超限失败并指出包名与超出量；阈值口径与扩容约定回写 docs/12。
- P4 批 2（I8）：统一错误码。core 新增 `BibliotypeError` 基类（稳定 `code` + 结构化 `details` + 中文 `hint` + `cause` 根因链）、`isBibliotypeError()`（instanceof + 跨实例品牌双通道）、`serializeBibliotypeError` / `deserializeBibliotypeError`（JSON 安全往返，cause 链递归还原）与统一错误码表 `BIBLIOTYPE_ERROR_CODES`；`PluginConflictError` / `NodeTypeConflictError` / `MigrationPathError` / `EditorSpecConflictError` / `HttpAdapterError` 改继承基类并新增 code / details / hint（原 `instanceof` 断言、`name`、message 不变），`CryptoError` / `BookPackError` 并入基类且既有稳定码保持原值；错误码表回写 docs/13；测试覆盖 code 稳定 / 序列化往返含 cause 链 / 兼容断言 / 非错误值负例。
- P4 批 3（I5）：性能基准。根新增 `bench/`（`run.mjs` runner + `lib.mjs` 对比纯函数 + `baseline.json` 基线 + `report.md` 报表），三组 node 纯函数基准：`paginate` 千页量级分页装箱、`exportEpub` 50 章打包、`serializeNode` 5000 节点序列化；每项预热 1 轮 + 采样 5 轮取中位数，相对基线劣化 >15% 失败（只看劣化方向），基线带 node 版本与平台；根脚本 `pnpm bench` / `pnpm bench:update`；判定口径回写 docs/18（量尺依赖浏览器布局盒，以分页装箱覆盖并注明）。
- P4 批 3（I7）：可观测性。core 新增可插拔 Profiler：端口 `span(phase, labels?)`、缺省 no-op（`NOOP_PROFILER`，零行为零开销）、收集器 `createCollectingProfiler()`（按阶段 × 标签聚合 count/total/min/max/mean，`reportJson()` / `reportText()` / `reset()`）与 `PERF_PHASES` 阶段常量（与 bench 基准同口径）；`paginate` 与 `exportEpub` 接受可选 `profiler` 注入（EPUB 按 plan/xhtml/nav-opf/zip 细分 span，缺省零开销）；vue `PERF_*` 常量与开关语义不变，开启后埋点同步记入 `getVuePerfProfiler()` 模块级收集器；API 回写 docs/13 与 docs/18。
- P4 批 4（I1 / B3）：端到端冒烟与直排像素回归。新增独立工作区 `e2e/`（`@bibliotype/e2e`，private，不进发布产物；脚本名 `e2e*` 避免被 `turbo run test` 抓取），Playwright 消费 demo 的 `vite preview` 产物：`@smoke` 覆盖 Markdown 导入 → 翻页 → 编辑落字 → 导出 EPUB（`fflate` 解包校验 mimetype / OPF / 章节含落字）、TXT 导入 → 古籍直排切换、宿主 `electronPdf` 桥 → 导出 PDF 字节；`@pixel` 覆盖三组固定直排 fixture（古籍单栏 / 仿真版框 / 竖排左起），结构基线用 Range 逐字测行盒锁列数 / 每栏行数 / 逐行断行，几何基线以「文字透明」截图锁页框与界行（`maxDiffPixelRatio: 0.02`），跨平台可比。CI 新增 `e2e` job 并归档失败产物；口径与多栏直排取舍回写 `docs/16`、`docs/18`。无发布包运行时 API 变更。
- 发版脚本改为按变更说明增量升版：只有出现在变更说明中的公开包才升日期版本并发布，未变更包版本保持不变；私有包（demo / e2e）条目跳过不再中止；新增 `--all`（首次全量）与 `--reuse-pending`（rc → latest 提升）两个开关，并输出 `.release/pending.json` 供批量发布脚本使用。
