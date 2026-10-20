---
"@bibliotype/import": minor
---

新增纯文本（TXT）导入：`txtToBookDocument` 空行分段、段内硬换行合并（中文直拼 / 西文补空格）、`第X章` `卷X` 起章、章前内容自成无标题章、确定性 id（`idPrefix` + 序号），支持自定义 `chapterPattern` / `chapterType`；`detectImportFormat` 增加 `.txt` / `text/plain` → `'text'`，`importFromText` 第 5 参透传 `TxtImportOptions`。
