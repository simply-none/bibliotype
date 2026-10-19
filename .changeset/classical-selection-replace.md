---
"@bibliotype/classical": minor
---

`./editor` 子入口新增选区替换为古籍块级容器的命令：`replaceWithDoubleNote`、`replaceWithHeadNote`、`replaceWithTailNote`、`replaceWithCollationNote`、`replaceWithImprint`、`replaceWithColophon`、`replaceWithBorderFrame`。它们消费选区、把选中文字搬进目标容器（底层走 `replaceSelectionWithContainer`），与既有「段后插入空容器」命令语义区分。
