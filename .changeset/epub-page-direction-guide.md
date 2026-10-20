---
"@bibliotype/exporter-epub": minor
---

新增 `pageDirection: 'ltr' | 'rtl'`（缺省按书写模式推导：直排 `vertical-rl` → `rtl`），`rtl` 时输出 `<spine page-progression-direction="rtl">`；`buildOpf` 新增 `pageProgressionDirection` 与 `guide` 输入，EPUB 2（`version: '2.0'`）自动输出 `<guide>`（`toc` → `nav.xhtml`、`text` → 首个内容文档），EPUB 3 不输出。
