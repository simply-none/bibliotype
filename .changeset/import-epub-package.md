---
"@bibliotype/import-epub": minor
---

新增 epub 导入包 `@bibliotype/import-epub`：`.epub`（zip + OPF + XHTML）→ `BookDocument`（复用 `@bibliotype/import` 的 HTML 通路）。导出 `epubToHtml`（字节 → 合并正文 HTML 片段，**浏览器 / Node 同构、不触碰 DOM**：fflate 解包 + `@xmldom/xmldom` 读取 container.xml / OPF manifest+spine / 逐 XHTML `<body>`）与 `epubToBookDocument`（字节 → `BookDocument`，末步复用 `import.htmlToBookDocument`，需 DOM）。`metadata` 由调用方注入以保证确定性；`fflate` / `@xmldom/xmldom` 重依赖隔离在本叶子包，使用侧建议按需 `import()` 动态加载。
