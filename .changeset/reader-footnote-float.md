---
"@bibliotype/reader": minor
---

`Reader` 新增脚注浮注（页底注区）：`footnoteFloat` / `noteMaxRatio` 把 `footnote` 块标为分页器的 `floatToBottom`，脚注不进正文流、落所在页页底注区，正文容量按注区高度收缩，注区超限时整条续到下一页页底。

- 新增 `getPageNoteItems(i)` / `getPageNotes(i)` / `getPageNoteMainSize(i)`；注文可 `goToNode` 定位、可被 `search` 命中；
- 只浮脚注：`endnote` / `margin-note` 仍随正文流；关闭时（缺省）行为与旧版完全一致；
- 块提取改用 `extractBlocksIndexed`，页节点 / 片段 / 搜索解析走同源块索引（免逐块全树查找）。
