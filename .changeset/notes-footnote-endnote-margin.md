---
"@bibliotype/core": minor
"@bibliotype/editor": minor
"@bibliotype/layout": minor
"@bibliotype/exporter-epub": minor
---

注释（脚注 / 尾注 / 边注）端到端补齐：

- `core` 新增注释节点公共契约 `NOTE_NODE_TYPES` / `NOTE_ROLES` / `isNoteNodeType` / `isNoteNode` / `noteRoleOf` / `NOTE_LABEL_STYLES` / `formatNoteLabel` / `collectNotes` / `nextNoteIndex`（按类型分别编号，手写 `attrs.marker` 优先）；`document-stats` 复用同一类型表。
- `editor` 新增 `insertFootnote` / `insertEndnote` / `insertMarginNote` / `insertNote` 命令：按同类现存注释数量自动编号（arabic / circled / chinese），光标已在注文内时插在该注释之后；注释节点规格补 `marker` 属性（导出 `NOTE_NODE_ATTRS`）。
- `layout` 序列化器新增 `epubSemantics` 选项：注释块输出 `epub:type`（footnote / endnote / sidebar），注码提为 `.bt-note-marker` 并注入首个段落内与注文同起一行；`book-css` 补注码样式。
- `exporter-epub` EPUB 3 路径自动开启注释语义（EPUB 2 不输出 `epub:type`）。
