---
"@bibliotype/core": minor
"@bibliotype/editor": minor
"@bibliotype/layout": minor
---

注释引用闭环：

- `core` 新增 `MARK_TYPES.NOTE_REF`（`noteref`）标记：正文上标指向注释块，attrs 为 `targetId`（注释块 id）与 `refId`（本条引用的锚点 id）。
- `editor`：`insertNote` 缺省在光标处同时写入上标引用，注释块自动生成 `note-<type>-<序号>` / `ref-<type>-<序号>`（冲突自动追加后缀），并在注文写 `refId`；新增 `insertNoteRef({ targetId, marker?, refId? })` 为已有注释补引；`withRef: false` 可只插注文。
- `layout`：序列化器输出 `<a class="bt-mark-noteref" href="#…" epub:type="noteref">`，注文末回跳 `<a class="bt-note-backref">↩</a>`；`book-css` 补上标与回跳样式。

EPUB 3 导出自动带 `epub:type="noteref"`，EPUB 2 仅保留普通链接。
