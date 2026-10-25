# @bibliotype/classical

## 26.10.25-rc.1

### Minor Changes

- `./editor` 子入口补齐古籍编辑命令：标记切换 `toggleNoteRef` / `toggleTaboo` / `toggleInlineNote` / `toggleVariantChar` / `toggleTabooChar`，节点插入 `insertTailNote` / `insertImprint` / `insertColophon` / `insertBorderFrame` / `insertFishTail` / `insertSeal`（覆盖此前无编辑入口的夹注 / 跋文 / 牌记 / 题记 / 版框 / 鱼尾 / 印章 / 避讳）。
- `./editor` 子入口新增选区替换为古籍块级容器的命令：`replaceWithDoubleNote`、`replaceWithHeadNote`、`replaceWithTailNote`、`replaceWithCollationNote`、`replaceWithImprint`、`replaceWithColophon`、`replaceWithBorderFrame`。它们消费选区、把选中文字搬进目标容器（底层走 `replaceSelectionWithContainer`），与既有「段后插入空容器」命令语义区分。
- P1-B2b：K4 索引 / K5 印章与版心 / K2 校勘对照。
  
  - **core**：新增 `index-term` 行内标记（`term` / `sortKey`），IR 版本升至 `0.3.0`（空迁移）；`collectIndexTerms` / `buildIndexEntries`（页码去重、连续页合并区间、拼音或显式排序）/ `buildIndexAppendix`（书末索引附录节点）。
  - **editor**：`toggleIndexTerm` 命令（选中文本为缺省词条）。
  - **layout**：`renderSealSvg` 确定性 SVG 印谱（朱文 / 白文、方印回文 / 竖排、边框粗细），`seal` 序列化输出内联 SVG（可关闭退化为文字印章）；仿真模板各自声明版心字段序列，`PageGutterTexts` 增 `volumeTitle`，鱼尾按字段分段定位。
  - **reader**：卷次自动推导（`resolveVolumeTitleForNode`），页眉 / 版心支持 `volumeTitle` 字段。
  - **classical**：校勘 `collation-mark` 增 `pairId` / `role`、`collation-note` 增 `pairId` / `marker`；`insertCollationNote` 自动取号、`renumberCollationNotes` 一键重排、`pairCollation` / `unpairCollation` 配对与解绑；`buildCollationSummary` 生成校勘汇总表附录。
  - **vue**：新增 `BtCollationCompare` 对照组件（底本 / 校本并排、同配对联动高亮）。
  - **exporter-epub**：书末自动追加索引章（可关闭）；新增 `appendices` 选项，`#id` 锚点自动改写为跨文件地址；EPUB 2 印章退化为文字印章。
- P3 古籍能力批次（K3 句读 / 专名标注、K6 缺字兜底、K7 典籍元数据）：
  
  - **K3 句读 / 专名自动标注**：`classical` 新增 `suggestJudou` / `judouMarkerRange` / `JUDOU_SYMBOLS` / `EXISTING_PUNCTUATION`、`detectProperNames` / `BUILTIN_PROPER_NAME_TERMS`（内置人名字典）与 `ProperNameDetector` 模型端口、`buildAnnotationSuggestions` / `collectSuggestionBlocks` / `countSuggestions`（确定性 id、段内 UTF-16 偏移、同偏移去重）；新增 `judou` 标记（`attrs.symbol` / `source=auto` / `suggestionId` / `rule` / `confidence`，编辑画布与序列化同口径）；新增命令 `applyJudouSuggestions` / `applyProperNameSuggestions` / `removeSuggestionMarks` / `commitJudouAsText`（单事务、可一次撤销）。`vue` 新增 `useAnnotationSuggestions`（待处理 / 已接受 / 已拒绝 / 已落地状态机）与 `BtAnnotationSuggestions` 审阅面板；布局侧新增 `.bt-mark-judou::after` 候选符号样式。
  - **K6 缺字与字形回退**：`core` 新增 `parseIds` / `formatIds` / `countIdsLeaves`（U+2FF0–U+2FFB 全部 12 个运算符，组件不足 / 超深给中文 issue）、`resolveGlyphFallback`（主字体链 → IDS → 方框，`GlyphProbe` 缺省视为命中）、`collectGlyphIssues` / `summarizeGlyphIssues`（字符 / 码位 / IR 路径 / 上下文，可按字符去重）；`layout` 新增 `renderIdsSvg` / `renderIdsGlyphHtml`（纯字符串、零依赖、同描述逐字节一致）与 `serializeNode({ glyph })` 逐字替换、书册样式 `.bt-glyph`；`exporter-epub` 新增 `collectEpubGlyphProblems`（`warning` 级 `ValidationProblem[]`，不阻断导出），`exporter-pdf` 新增 `collectPdfGlyphProblems` / `summarizePdfGlyphProblems`。`vue` 新增 `useGlyphAudit` 与 `BtGlyphAuditPanel`。
  - **K7 典籍元数据规范**：`BookMetadata` 新增可选字段 `classicalCategory`（经 / 史 / 子 / 集 + 二级类）、`editionType`（刻本 / 抄本 / 活字本 / 稿本）、`repository`、`callNumber`，配套 `CLASSICAL_DIVISIONS` / `EDITION_TYPES` 与 `validateMetadata` / `isClassicalDivision` / `isEditionType`（中文 issue，非法值拦截）；新增 `toDublinCore` / `serializeDublinCore`（固定键序 JSON）与 `toCnmarc`（001 / 200 / 205 / 210 / 215 / 300 / 606 / 686 / 690 / 801 / 905 字段行）、`migrateLegacyMetadata`（旧 `extra` 提升，幂等、顶层优先）；`exporter-epub` 的 OPF 补 `dc:subject` / `dc:type` / `dc:source`。
  - **兼容性**：均为增量导出与可选字段，既有函数签名不变；`serializeNode` 仅在显式传入 `glyph` / `tagOverrides` 等新选项时改变输出，默认产物逐字节不变；OPF 新增 `dc:subject` / `dc:type` / `dc:source`（无对应元数据时省略）；`judou` 标记为新增，既有文档不受影响。生产依赖零新增，库内仍不写存储。
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
