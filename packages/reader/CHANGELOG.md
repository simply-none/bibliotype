# @bibliotype/reader

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
- 直排列级拆分补齐主轴契约：`MeasurableBlock` 新增 `axis: 'row' | 'column'`（缺省 `'row'`，导出 `BlockAxis` / `blockAxisOf`）；`extractBlocks` 新增 `axis` 选项，直排给可拆块标注 `'column'`；`MeasurePaginationResult` 与 `buildPagedLayout` 结果新增 `axis`，`Reader` 新增 `axis` / `blockAxis` 并透传（`repaginate({ axis })` 可切换）；demo 量尺同步透传。分页算术仍只认沿主轴的尺寸，横排 / 直排结果一致；文档 04 / 18 与能力清单同步。
- 块抽取 `extractBlocks` 支持外部传入 `blockSizes`（DOM 实测尺寸映射）：命中某块 id 时以实测主轴尺寸替代按字符数的估算，改善含图 / 表 / 公式文档的分页准确度；未传入时回退原估算器，行为向后兼容。
- `Reader` 新增脚注浮注（页底注区）：`footnoteFloat` / `noteMaxRatio` 把 `footnote` 块标为分页器的 `floatToBottom`，脚注不进正文流、落所在页页底注区，正文容量按注区高度收缩，注区超限时整条续到下一页页底。
  
  - 新增 `getPageNoteItems(i)` / `getPageNotes(i)` / `getPageNoteMainSize(i)`；注文可 `goToNode` 定位、可被 `search` 命中；
  - 只浮脚注：`endnote` / `margin-note` 仍随正文流；关闭时（缺省）行为与旧版完全一致；
  - 块提取改用 `extractBlocksIndexed`，页节点 / 片段 / 搜索解析走同源块索引（免逐块全树查找）。
- `extractBlocks` 新增 h1 / h2 标题另起页（仿纸质书）。`attrs.level` ≤ 2 的标题（缺省视为 h1）标记 `breakBefore`，从新页页首起排；h3~h6 不强制另起页，仅保留 `keepWithNext` 与下段同页。该标记与结构容器首块标记、分页符标记正交，主轴方向由调用方按书写方向传尺寸，**横排与直排同逻辑**（阅读 / 预览 / 导出共用 `extractBlocks → paginate` 管线，自动生效）。
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
- P4 批 1（I4）：覆盖率统一配置与阈值门槛。各包新增 `test:coverage` 脚本（v8 provider，`text + lcov` 报告，排除 `__tests__` / fixtures / 类型声明）；`core` / `layout` / `reader` 按真实基线略下调设阈值（行 82 / 94 / 95）在 CI 拦截回归，其余包只报告不拦；CI 以 `pnpm test:coverage` 取代测试步骤并把各包 `coverage/lcov.info` 归档为 artifact。
- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
- 表格编辑增强：
  
  - **editor**：`table` / `table-row` / `table-cell` 渲染为语义 `<table><tbody><tr><td>`（保留 `bt-*` class 与 `data-bt-id`），修复插入表格后编辑画布一片空白；
  - **reader**：表格加入复合原子块，`extractBlocks` 不再下钻到单元格段落，分页与序列化保留完整 `<table>` 包裹；
  - **layout**：表格样式随书写方向（`writing-mode: inherit`），空单元格保留最小尺寸，直排下不再塌陷；
  - **vue**：新增 `BtTableSizePicker`（Word / WPS 式行 × 列网格 + 精确输入），配合工具条在直排下同样可插入表格。
