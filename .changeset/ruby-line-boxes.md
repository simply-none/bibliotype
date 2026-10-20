---
"@bibliotype/layout": minor
"@bibliotype/reader": minor
"@bibliotype/vue": minor
"@bibliotype/exporter-pdf": minor
---

ruby 行盒精修（B6）：注音行高按实测行盒判页，不再用均高近似。

- `layout`：`MeasurableBlock.lineMainSizes`（逐行主轴尺寸）+ `lineCountOfBlock` / `lineMainSizeAt` /
  `lineRangeMainSize`；`paginate` 按行累加判页与结算片段，孤寡行 / keepWithNext 同口径；
  缺省 / 长度不符回退 `lineSize`，行为与旧版一致；
- `vue`：量尺以基础文本矩形划行（排除 `<rt>` 注文误判为独立行），再把注音矩形按交叉轴并入所在行，
  产出 `MeasurePaginationResult.lineMainSizes`（直排为逐列列宽）；`buildPagedLayout` 增量合并 /
  陈旧项清理 / 片段尺寸同步；`ruby > rt` 增 `line-height: 1.2`（不继承正文大行距）；
- `reader`：`ExtractBlocksOptions` / `ReaderOptions` / `RepaginateOptions` 新增 `lineMainSizes`，
  块携带逐行尺寸、行数取数组长度、均高取均值作回退；
- `exporter-pdf`：`PrintDocumentOptions.lineMainSizes` 透传逐页分页，PDF 与屏幕分页一致。
