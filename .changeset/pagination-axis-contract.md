---
"@bibliotype/layout": minor
"@bibliotype/reader": minor
"@bibliotype/vue": minor
---

直排列级拆分补齐主轴契约：`MeasurableBlock` 新增 `axis: 'row' | 'column'`（缺省 `'row'`，导出 `BlockAxis` / `blockAxisOf`）；`extractBlocks` 新增 `axis` 选项，直排给可拆块标注 `'column'`；`MeasurePaginationResult` 与 `buildPagedLayout` 结果新增 `axis`，`Reader` 新增 `axis` / `blockAxis` 并透传（`repaginate({ axis })` 可切换）；demo 量尺同步透传。分页算术仍只认沿主轴的尺寸，横排 / 直排结果一致；文档 04 / 18 与能力清单同步。
