---
"@bibliotype/layout": minor
"@bibliotype/reader": minor
"@bibliotype/exporter-pdf": minor
---

直排排版引擎 v2 批 4（行款规则全链）：低格 / 抬头 / 提行的分页折算、导出同源与横排降级。

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
