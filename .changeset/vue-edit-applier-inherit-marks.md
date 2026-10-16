---
"@bibliotype/vue": patch
---

修复分页落模丢标记继承（P1-1 / R5）：`paged-editor/edit-applier.ts` 的 `applyFragmentEdit` 此前用 `state.schema.text(text)` 重建文本节点（无 marks），导致点标记后打字、或在已标记文本中间打字都不继承既有 marks（而 ProseMirror 原生 `insertText` 会继承 `storedMarks || $from.marks()`）。现改为在构造文本节点时携带 `$from.marks()`，使输入正确继承当前 marks。
