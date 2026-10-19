---
"@bibliotype/editor": minor
---

新增 `replaceSelectionWithContainer`：把选中文字转换为块级 / 行内容器（「替换为」）。块级目标按选区切分前后段落、删除空片段、原 id 保留给文档序第一个存留片段（其余置空，避免 `tr.split` 复制 attrs 造成重复 id），容器内文本块默认规范化为段落；行内目标复用 `insertInlineNodeWrapping`。支持 `dropEmptyFragments` / `idOwner` / `insertWhenEmpty` / `normalizeTextblocks` 选项，整个转换在单个 transaction 内完成，一次撤销整体还原。
