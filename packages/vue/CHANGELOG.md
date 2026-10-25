# @bibliotype/vue

## 26.10.25-rc.1

### Minor Changes

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
- H5 移动端改造（批 A–D）：
  
  - 新增断点体系：`BT_BREAKPOINTS` / `BT_TOUCH_TARGET_MIN` / `resolveBreakpointName` 与
    `useBreakpoint()`（宽度、档位、粗指针、竖屏、`revision` 变更计数），宿主据此切换单列骨架并重排；
  - 新增 `useScrollLock()`：模块级共享的计数锁，多层浮层叠加只锁一次，快照并还原 body 内联样式；
  - 新增 `BtDrawer`：统一抽屉容器（`side` start / end / bottom、遮罩关闭、Esc、边缘手势呼出、
    `Teleport` + 锁滚），`snapHeights` 提供底部 sheet 拖拽吸附档位；
  - `BtBookView`：单页模式下左右边缘 20% 点按翻页、中部 emit `tap-center`，与滑动翻页 / 文本选择互斥；
  - `BtNotePreview`：触屏点按切换预览、点外部关闭；`BtSelectionReplaceMenu`：触摸选区重算落点；
    `BtTableSizePicker`：网格触点补到 44px；`BtEditor`：`visualViewport` 软键盘补偿；
  - `BtSidebarResizer` 触屏隐藏、`BtSpreadLayout` 窄屏堆叠、`BtBookShelf` 窄屏两列。
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
- P4 批 5（E7）：新增图片 / 长图导出。`exportChapterImages(reader, options)` 把分页结果按章截图并打包为 ZIP（`01-章名/001.png`，页序全书连续），支持 DPR 1~3、PNG / JPEG、质量与底色、进度回调、单页失败重试（缺省 1 次，用尽抛 `IMAGE_EXPORT_FAILED` 并保留根因）。`exportLongImage(reader, options)` 复用同一截图链路，按页竖向拼接为分享长图（页眉页脚随页截图自带，章间分隔带可绘制章名），布局由纯函数 `layoutLongImage` 计算（高度 = 各页高度之和 + 页间距 + 分隔带 + 上下留白），可在 Node / happy-dom 直接断言。单页截图用「离屏 `.bt-reader-page` + SVG `foreignObject`」栅格化（与 `BtBookView` 同一套书册样式表，零运行时依赖，字体就绪后再截）；`planChapterImages` 按目录层级分组（首章吞并封面 / 前置页，无目录退化为单章）；`createStoredZip` 为 STORE（不压缩）ZIP writer，固定时间戳使同一输入产物逐字节一致。无 DOM / Canvas 环境抛 `IMAGE_EXPORT_UNSUPPORTED`（错误码已登记 `BIBLIOTYPE_ERROR_CODES`）。测试 25 例覆盖选项钳位、像素尺寸、章节分组、ZIP 条目与确定性、进度 / 重试 / 回收、长图高度与分隔带、环境安全门；`pnpm --filter @bibliotype/vue test` 318 passed，`build` / `typecheck` / `size-limit`（163.8 KB gzip，限额 165 KB）通过。回写 `docs/06`。
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
- 表格编辑增强：
  
  - **editor**：`table` / `table-row` / `table-cell` 渲染为语义 `<table><tbody><tr><td>`（保留 `bt-*` class 与 `data-bt-id`），修复插入表格后编辑画布一片空白；
  - **reader**：表格加入复合原子块，`extractBlocks` 不再下钻到单元格段落，分页与序列化保留完整 `<table>` 包裹；
  - **layout**：表格样式随书写方向（`writing-mode: inherit`），空单元格保留最小尺寸，直排下不再塌陷；
  - **vue**：新增 `BtTableSizePicker`（Word / WPS 式行 × 列网格 + 精确输入），配合工具条在直排下同样可插入表格。
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
- `BtDrawer` 开放一组可覆盖的视觉变量（都带原默认值，不传即维持库自身观感，桌面回归不变）：
  `--bt-drawer-mask`（遮罩色）、`--bt-drawer-shadow`（面板投影）、`--bt-drawer-radius`（底部 sheet 上圆角，12 → 16）、
  `--bt-drawer-radius-sm`（关闭按钮圆角）、`--bt-drawer-hover`（关闭按钮悬停底）、`--bt-drawer-ease`（入场缓动）。
  同时为抽屉 / sheet 补入场动效（侧滑推入、底部升起、遮罩淡入），并在 `prefers-reduced-motion: reduce` 下整块关闭；
  关闭按钮加三态过渡，头部标题与内边距按移动端字号微调。皮肤本身仍归宿主（demo 的 `--ui-*` 令牌 + `[data-skin]`），库内不引入主题状态与存储。
- Vue 编辑封装增强：`BtEditor` 新增编辑态整页缩放（`scale`）与只读模式（`editable`）props，分页参考线随实测尺寸联动；新增 DOM 实测分页工具导出 `measureBlockSizes` / `disposeMeasureSheet`（`MeasureBlockSizesInput` 类型），并补导出 `EditorBinding` / `EditorBindingOptions` 类型，供工具条作用域插槽与外部组合复用。
- BtEditor 的 `pagination` 由「分页参考线（虚线）」升级为「分页纸张效果」（纸书排版引擎 Phase 1）：逐页渲染**等高**纸面面板（纸色 + 阴影 + 页码标签），页高固定为版心开本尺寸，短页补足空白、页间留缝露出台面底色（`--bt-editor-stage`）；横排断页尺寸改以**编辑器 DOM 实时实测**（相邻叶块顶边差）为准，不再依赖外部旧 `blockSizes`（仅直排 / 多栏回退），彻底消除编辑后量尺滞后导致的内容溢出纸张；超高页随内容增高不溢纸，通过在页首块叠加页间距让连续正文对齐统一页格；关闭 `pagination` 时恢复连续长纸并清除注入间距。
- `BtEditor` 暴露 `goToNode(nodeId)`：编辑态目录跳转。按 id 或树路径（`/0/1`，导入文档回退口径）解析节点 → PM 位置并设选区、`scrollIntoView`；连续画布态由可见 PM 视图直接响应滚动，分页态据分页索引定位所属页并翻到该页（另请求重排后还原光标兜底）。修复编辑态（横排 / 直排）点击目录「无反应」的问题。
- 图片放大查看（lightbox）：阅读视图点击图片、编辑画布双击图片，弹窗等比放大查看内容。
  
  - **新增 `BtImageLightbox` 组件**：Teleport 到 body 的暗色遮罩 + 居中等比大图（object-fit contain）+ 说明文字（字图显示「原字：X」、插图显示 alt）；关闭途径为遮罩点击 / Esc / 右上角关闭按钮，开启期间 `useScrollLock` 锁背景滚动（计数锁，可与抽屉等浮层叠加）；直排阅读流中字图的 90° 旋转不带入弹窗，恒以原图方向展示。视觉变量 `--bt-lightbox-mask` / `--bt-lightbox-color` / `--bt-lightbox-image-bg` 均带默认值。
  - **弹窗内缩放 / 平移**：滚轮与双指捏合**恒以图片中心为锚居中放大**（1×~8×，只变倍率、视觉中心不动），放大后拖拽平移（限幅不出视野），双击图片复位；缩放与平移状态每次打开重置，拖拽 / 捏合结束的 click 不当点按关闭遮罩。手势 move / up 跟踪挂 window 且仅在手势进行中存在（首指按下挂、末指抬起摘，关闭 / 卸载强制摘），滚轮监听绑在弹窗根元素随 `v-if` 卸载——弹窗一关所有监听归零，不干扰阅读层翻页滚轮与原生手势（`touch-action: none` + `draggable="false"` 接管浏览器默认行为；不用 setPointerCapture——它会把 click 重定向到根元素，导致关闭按钮 / 遮罩点击失效）。
  - **新增 `useImageLightbox` 组合式与 `resolveImageTarget` 纯函数**：统一识别阅读页真 `<img>`（块级插图 / 行内字图，原字在 `data-char`）与编辑画布 `div.bt-image[data-src]` 三种形态，供宿主自定义视图接线。
  - **`BtBookView` 新增 `imageLightbox` prop（缺省 false，向后兼容）**：开启后点击正文插图或行内字图弹窗放大，page / scroll / scroll-flow 三种模式均生效；命中即消费该次点击，不再触发翻页分区（单页模式点图不再翻页）。
  - **`BtEditor` 新增 `imageLightbox` prop（缺省 false）**：开启后双击画布内图片弹窗放大——用双击避免与 ProseMirror 单击选中节点冲突。
  - demo 宿主侧（私有包）：阅读视图与编辑画布开启 `image-lightbox`。
- 阅读视图交互与无障碍补齐：
  
  - `BtBookView` page 模式内置键盘翻页（←→ ↑↓、PageUp/PageDown、空格、Home/End；带修饰键的组合不拦截）与触屏滑动（横排左滑下一页、直排右滑下一页、纵向滑动不误触）；新增 `ariaLabel` prop、`role="document"`、`tabindex="0"`、`:focus-visible` 焦点环与 `aria-live` 页码播报；
  - `BtPager` 补 `role="group"` / `aria-label`，页码状态区加 `aria-live="polite"`。
- BtBookView 新增 `mode` prop（`page` 单页翻页 / `scroll` 连续滚动多页，默认 `page`）。`scroll` 模式把所有分页纵向拼接为可滚动容器，滚动时按可见页回写 Reader 页态，外部翻页（BtPager / 键盘 / 目录）滚动定位到对应页；采用窗口化虚拟滚动（按等高页步长精确推算，仅序列化 / 挂载视口附近的页 + overscan），大部头书籍不再一次性渲染全部分页。useReaderBinding 相应暴露响应式 `pagination` 以支撑分页推算。
- 新增选区「替换为」浮动菜单：`BtSelectionReplaceMenu` 组件、`useSelectionReplace` 组合式与 `placeFloating` 定位纯函数。选中文字后在选区旁弹出，按分组展示目标，点击经 `binding.execute` 执行；优先用可见 DOM 选区定位（连续画布与 paged 画布通用），去抖 120ms，支持只读、Esc / 点外部关闭与自动弹出开关。

### Patch Changes

- 双页对照修正：对照就地替换主区渲染并隐藏目录栏（不再叠加原正文），舞台高度有界、容器禁用内部滚动，
  滚轮专注翻页；单文档对页透传 `tokens` / `fontToken` / `fontSize` / `features` / `namedStyles`，
  古籍仿真纸色与字体同单页；对页中缝 24px、两页各自投影，直排 / 横排不再粘连；Demo 顶栏「逐页」后
  新增「退出对照」，移除对照标题条，进入编辑自动退出。
- 优化「编辑 → 保存」链路，大文档编辑不再掉帧：
  
  - **`@bibliotype/editor`**：变更广播改用共享 IR 快照（`getSharedDocument()` 口径，O(变更子树)），逐键事务不再做全量 PM→IR 转换——实测 78 万字 / 12623 块文档单次广播 5.0 ms → 0.7 ms（其中全量转换部分 4.8 → 0.02 ms）。**行为收紧**：`onChange` 回调参数为共享只读快照，未变子树与上一次快照复用同一引用，不得原地修改（需独立可变副本时使用 `getDocument()`）。
  - **`@bibliotype/vue`**：`measurePagination` 新增可选入参 `extracted`（复用调用方已抽好的块序列与节点索引），`buildPagedLayout` 每轮重排的全树抽块由三次降为两次（78 万字文档省约 6 ms/轮）。
- 文档内锚点跳转：导入保留源元素 id，阅读视图点击 `<a href="#…">` 注码跳到目标内容，修「点击刷新」。
  
  - **editor**：schema 解析层（`buildSchema`）为全部节点 parseDOM 规则统一保留源元素 `id`（覆盖导入的 HTML / docx / EPUB 与 bt-* 渲染产物 HTML 回编辑器的往返）——`<a href="#…">` 的跳转目标块（段落 / 列表项 / 标题等）从此带源 id，阅读器可按块 id 定位页码。
  - **reader**：新增「链接 hash → 叶块 id」索引与 `Reader.getPageOfAnchor(hash)`——链接标记的 hash（EPUB 遗留 `text00012.html#ch1-9` 取末段）反查其所在块再定位页码，首次出现优先。
  - **vue**：`useNoteInteraction` 点击委托新增「文档内锚点链接」分支——书内相对锚点（含 path#hash 形态，文件名段为 EPUB 残留）**一律消费**，绝不交给浏览器默认导航（相对路径导航会把预览页整页「刷新」）。跨页定位三级解析：目标块 id 直查 → **EPUB 回链约定**（注码 `#ch1-9` ↔ 注文回链 `#ch1-9-back`，经 `getPageOfAnchor` 反查注文所在块，**存量书免重导即可跳转**）→ 点击注文回链时剥 `-back` 后缀反查注码；全部落空（坏链）静默消费。绝对地址（http / mailto 等）与无 hash 的普通链接照常放行；同页已渲染的目标直接高亮定位。
- 修复阅读视图分页越界（现代横排 / 古籍直排 / 古籍仿真直排同一根因），样本：杜诗详注 EPUB。
  
  - **逐行主轴尺寸改为「行推进量」**：`pagination-measure` 原取单个文本矩形的主轴跨度（`boxEnd − boxStart`，16px 字号 / 30.4px 行高时约 23px）作为每行尺寸，比真实行推进小约 1/4；`extractBlocks` 的 `lineMainSizes` / `lineSize` 随之偏小，`paginate` 的 `linesFitting` 高估每页可容纳行数 / 列数，拆分片段渲染后越出版心（横排页底、直排页左）。现按「相邻行起缘之差」累加、末行补齐到块体尺寸，各行之和等于块高 / 宽；ruby 注音撑高的行由增量自动体现（不再需要并入 `<rt>` 矩形）。量测异常（非正增量 / 超块体 / 行数不符）仍回退均高。
  - **图片块按版心限幅**：`.bt-image` 改为块级（消除行盒基线留白）并按版心物理宽高给 px 上限。此前仅 `max-width: 100%`，大图（扫描件常上千 px，图片块不可拆）在空页被强制放入后撑出纸面 / 版心；量尺与渲染共用该样式，实测尺寸随之收敛。
  - **测试**：新增 `lineAdvances` 纯函数用例（等行高 / 注音撑高 / 直排 rl 递减 / 四类异常回退）；古典 CSS 基线快照按有意变更重锁。
- P4 批 3（I7）：可观测性。core 新增可插拔 Profiler：端口 `span(phase, labels?)`、缺省 no-op（`NOOP_PROFILER`，零行为零开销）、收集器 `createCollectingProfiler()`（按阶段 × 标签聚合 count/total/min/max/mean，`reportJson()` / `reportText()` / `reset()`）与 `PERF_PHASES` 阶段常量（与 bench 基准同口径）；`paginate` 与 `exportEpub` 接受可选 `profiler` 注入（EPUB 按 plan/xhtml/nav-opf/zip 细分 span，缺省零开销）；vue `PERF_*` 常量与开关语义不变，开启后埋点同步记入 `getVuePerfProfiler()` 模块级收集器；API 回写 docs/13 与 docs/18。
- 修复导入长文档（尤其直排）后窗口右侧出现竖向滚动条：量尺工作表改用 `position: fixed`
  离屏定位，盒不再参与文档滚动区计算，直排量尺再宽也不会撑出文档横滚条，
  由横滚条引发的 `100vh` 高度差竖滚条随之消失。
- 新增古籍风滚动条样式：`BtBookView` 的滚动条改由 `--bt-scrollbar-*` 令牌驱动（尺寸 / 滑块 /
  轨槽 / 悬停色，均带默认值回落），Demo「设置 → 其他」提供「墨线 / 卷轴 / 竹简」三套预设并随界面
  偏好快照持久化。WebKit 用 `::-webkit-scrollbar` 画轨槽与滑块并隐藏两端按钮；标准属性
  （`scrollbar-width` / `scrollbar-color`）收在 `@supports not selector(::-webkit-scrollbar)` 内，
  避免 Chromium 因命中标准属性而整体丢弃伪元素、退回带箭头的系统滚动条。
- 双页对照翻页步长修正：`BtBookView` 对页（`spread="facing"`）下键盘 / 滚轮 / 触屏滑动 / 边缘点按一次跨一整对（2 页），
  `BtPager` 新增可选 `step`（默认 1，对页传 2），Demo 在桌面双页对照态把 `step=2` 接到状态栏翻页按钮，
  不再需要连点两次或多次滚动才换页对。
- 修复分页落模丢标记继承（P1-1 / R5）：`paged-editor/edit-applier.ts` 的 `applyFragmentEdit` 此前用 `state.schema.text(text)` 重建文本节点（无 marks），导致点标记后打字、或在已标记文本中间打字都不继承既有 marks（而 ProseMirror 原生 `insertText` 会继承 `storedMarks || $from.marks()`）。现改为在构造文本节点时携带 `$from.marks()`，使输入正确继承当前 marks。
- 修复分页编辑态中「同段落选中内容之前有注音时，行内标记落点整体右移」：
  
  - **根因**：字符坐标轴不一致。模型轴（IR / PM / 切片，口径见 `reader.collectNodeText`）**不含** ruby 注文——注文存放于 mark 的 `attrs.text`，不是文本子节点；而片段 / 量尺 DOM 轴**含**注文——`html-serializer` 把 ruby 渲染为 `<ruby>基字<rt>注文</rt></ruby>`，`<rt>` 是真实文本节点。两轴相差「选中位置之前的注文字数」，选区 / 光标 / 行首偏移换算随之整体右移。
  - **修复**：新增 `ruby-annotation` 原子模块（注文识别），DOM 文本采集处一律跳过 `<rt>` / `<rp>` 子树，两处同源修复：
    - `paged-editor/input-router` 的 `fragTextNodes`：纠正行内标记落点右移、含注音段落的 IME 插入位置、光标还原与跨片段导航边界判断；
    - `pagination-measure` 的 `collectTextOffsets`：`lineOffsets` 回到模型轴，纠正含注音多行段落的片段切片边界与选区映射。
