---
"@bibliotype/import-docx": minor
---

新增 docx 导入包 `@bibliotype/import-docx`：`.docx` → HTML（`mammoth`）→ `BookDocument`（复用 `@bibliotype/import` 的 HTML 通路）。导出 `docxToHtml`（字节 → 标准 HTML，浏览器 / Node 双端输入）与 `docxToBookDocument`（字节 → `BookDocument`）；`metadata` 由调用方注入以保证确定性，内嵌图片默认退化为空 `src` 占位（D4-a，资源解析钩子经 `convertImage` 预留）。`mammoth` 重依赖隔离在本叶子包，使用侧建议按需 `import()` 动态加载。
