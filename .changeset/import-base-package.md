---
"@bibliotype/import": minor
---

新增基础导入包 `@bibliotype/import`：Markdown / HTML → `BookDocument`（零外部重依赖，复用 `@bibliotype/editor` 的 `markdownToNodes` 与扩充后的 `parseDOM`）。导出 `nodesToBookDocument` / `markdownToBookDocument` / `htmlToBookDocument` / `detectImportFormat` / `importFromText`；`metadata` 由调用方注入以保证确定性，docx/epub 留给对应重依赖叶子包。
