---
"@bibliotype/editor": patch
---

修复「改块类型」命令清空块 `id`（P0-2 / R2）：`prosemirror-commands` 的 `setBlockType` 以 `type.create(attrsHere, null, marks)` 重建节点，且 `prosemirror-model@1.25` 起 `Node.hasMarkup(type, null)` 不再短路，导致 `setParagraph` / `setHeadingLevel` 把块 `id` 整体归默认（实测 `irId p-1 => undefined`）。现改用新增的 `setBlockTypeKeepingId`：对每个选中文本块以 `tr.setNodeMarkup(pos, nodeType, { ...node.attrs, ...patch })` 改写，显式保留 `id` 与 `rawAttrs`；跨块选区逐块处理、各自保留原 `id`，不再用单一 `attrs` 套用全部块。
