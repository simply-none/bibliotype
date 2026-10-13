---
"@bibliotype/layout": minor
---

纸书排版引擎 Phase 2：`paginate` 支持段落行级拆分与孤寡行控制。`MeasurableBlock` 新增 `lineSize` / `splittable`（仅正文段落可拆，标题 / 封面 / 注文恒整块），`PaginateOptions` 新增 `widowControl`（首页片段 ≥ minFirst 行、末页片段 ≥ minLast 行，默认 2 / 2）；页输出新增 `items: PageItem[]`（`fromLine` / `lineCount` 行级渲染契约，`blocks` 向后兼容），超高可拆块按每页容纳行数连续跨页。不传新字段时行为与块原子版完全一致。
