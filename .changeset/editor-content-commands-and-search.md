---
"@bibliotype/editor": minor
---

编辑能力补全：新增内容命令 `insertMathBlock` / `insertMathInline` / `insertRuby`（选区注音或插入带注音文字）/ `insertFigure`（图片 + 图注块组）/ `insertHorizontalRule`（末块自动补空段落），并导出 `PLACEHOLDER_IMAGE_SRC`、`HORIZONTAL_RULE_VARIANT`、`FigureOptions`；查找替换支持正则 / 整词 / 范围限定 / 结果上限，新增 `findNextMatch`、`replaceMatch`、`buildSearchRegExp`、`escapeRegExp` 与 `EditorSearchOptions`（`findTextMatches` 三参重载保持兼容）。
