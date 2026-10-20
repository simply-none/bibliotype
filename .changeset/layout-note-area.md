---
"@bibliotype/layout": minor
---

分页器新增页底注区（脚注浮注）：`MeasurableBlock.floatToBottom` + `PaginateOptions.noteArea: { maxRatio? }`。

- 脚注不进正文流，落在所在页的 `page.notes`，`page.noteMainSize` 记录注区占高；
- 正文可用容量 = 页面容量 − 注区高度（注区动态收缩正文）；
- 注区超过 `maxRatio`（缺省 0.4）时整条续到下一页页底（跨页续注），单条超限独占一页不死循环；
- 未开启 `noteArea` 时产物结构与旧版完全一致（不出现 `notes` / `noteMainSize`）。
