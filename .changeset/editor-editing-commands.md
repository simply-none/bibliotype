---
"@bibliotype/editor": minor
---

编辑命令与行为层大幅补全：新增通用属性修改命令 `setNodeAttrs` / `setMarkAttrs`（基于 `setNodeMarkup`，含 `rawAttrs` 合并）；补齐插入 / 结构 / 表格命令（`insertBlockOfType` / `insertStructureBlock` / `insertInlineNodeWrapping` / `insertAtomicNode` / `insertImage` / `insertCodeBlock` / `insertTable` 及 `tableAddRow` / `tableAddColumn` / `tableDeleteRow` / `tableDeleteColumn`、常量 `STRUCTURE_BLOCK_TYPE_NAMES`）、`toggleOrderedList` / `setLink` / `unsetLink` / `toggleMarkByName`；新增编辑态查找替换 API（`findTextMatches` / `selectRange` / `replaceSelectionWith` / `replaceAll` 与 `TextMatch` 类型）与粘贴增强（`looksLikeMarkdown` / `parseInlineToNodes` / `markdownToNodes` / `markdownToFragment` 及 `createPasteMarkdownPlugin` / `buildPasteSlice`，HTML / Markdown → IR）；`BookEditor` 增补 `updateMetadata` 与只读（editable）支持。
