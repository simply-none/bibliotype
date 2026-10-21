---
"@bibliotype/core": minor
"@bibliotype/classical": minor
"@bibliotype/layout": minor
"@bibliotype/vue": minor
"@bibliotype/exporter-epub": minor
"@bibliotype/exporter-pdf": minor
---

P3 古籍能力批次（K3 句读 / 专名标注、K6 缺字兜底、K7 典籍元数据）：

- **K3 句读 / 专名自动标注**：`classical` 新增 `suggestJudou` / `judouMarkerRange` / `JUDOU_SYMBOLS` / `EXISTING_PUNCTUATION`、`detectProperNames` / `BUILTIN_PROPER_NAME_TERMS`（内置人名字典）与 `ProperNameDetector` 模型端口、`buildAnnotationSuggestions` / `collectSuggestionBlocks` / `countSuggestions`（确定性 id、段内 UTF-16 偏移、同偏移去重）；新增 `judou` 标记（`attrs.symbol` / `source=auto` / `suggestionId` / `rule` / `confidence`，编辑画布与序列化同口径）；新增命令 `applyJudouSuggestions` / `applyProperNameSuggestions` / `removeSuggestionMarks` / `commitJudouAsText`（单事务、可一次撤销）。`vue` 新增 `useAnnotationSuggestions`（待处理 / 已接受 / 已拒绝 / 已落地状态机）与 `BtAnnotationSuggestions` 审阅面板；布局侧新增 `.bt-mark-judou::after` 候选符号样式。
- **K6 缺字与字形回退**：`core` 新增 `parseIds` / `formatIds` / `countIdsLeaves`（U+2FF0–U+2FFB 全部 12 个运算符，组件不足 / 超深给中文 issue）、`resolveGlyphFallback`（主字体链 → IDS → 方框，`GlyphProbe` 缺省视为命中）、`collectGlyphIssues` / `summarizeGlyphIssues`（字符 / 码位 / IR 路径 / 上下文，可按字符去重）；`layout` 新增 `renderIdsSvg` / `renderIdsGlyphHtml`（纯字符串、零依赖、同描述逐字节一致）与 `serializeNode({ glyph })` 逐字替换、书册样式 `.bt-glyph`；`exporter-epub` 新增 `collectEpubGlyphProblems`（`warning` 级 `ValidationProblem[]`，不阻断导出），`exporter-pdf` 新增 `collectPdfGlyphProblems` / `summarizePdfGlyphProblems`。`vue` 新增 `useGlyphAudit` 与 `BtGlyphAuditPanel`。
- **K7 典籍元数据规范**：`BookMetadata` 新增可选字段 `classicalCategory`（经 / 史 / 子 / 集 + 二级类）、`editionType`（刻本 / 抄本 / 活字本 / 稿本）、`repository`、`callNumber`，配套 `CLASSICAL_DIVISIONS` / `EDITION_TYPES` 与 `validateMetadata` / `isClassicalDivision` / `isEditionType`（中文 issue，非法值拦截）；新增 `toDublinCore` / `serializeDublinCore`（固定键序 JSON）与 `toCnmarc`（001 / 200 / 205 / 210 / 215 / 300 / 606 / 686 / 690 / 801 / 905 字段行）、`migrateLegacyMetadata`（旧 `extra` 提升，幂等、顶层优先）；`exporter-epub` 的 OPF 补 `dc:subject` / `dc:type` / `dc:source`。
- **兼容性**：均为增量导出与可选字段，既有函数签名不变；`serializeNode` 仅在显式传入 `glyph` / `tagOverrides` 等新选项时改变输出，默认产物逐字节不变；OPF 新增 `dc:subject` / `dc:type` / `dc:source`（无对应元数据时省略）；`judou` 标记为新增，既有文档不受影响。生产依赖零新增，库内仍不写存储。
