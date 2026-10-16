---
"@bibliotype/editor": patch
---

修复行内容器包裹命令（夹注 / 异体字载体 / 避讳字载体，P0-1 / R1）：`insertInlineNodeWrapping` 此前直接把 `Selection.content().content`（默认 `includeParents=true`，根为块级祖先）喂给 `type.createChecked`，导致选中文字点击夹注等时抛出 `Invalid content for node <type>: <chapter(paragraph(...))>` 而「完全无反应」。现改为：跨块选区（`$from.parent !== $to.parent`）显式返回 `false`（不抛异常、不改文档）；同块选区改用 `$from.parent.content.cut(...)` 取得行内 Fragment 再 `createChecked`。此外补全非空选区的光标落点——替换后用 `TextSelection` 把光标移入新包裹节点内部，与空选区分支行为一致（修复前光标落在容器之后）。
