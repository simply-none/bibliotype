# @bibliotype/import

## 26.10.25-rc.1

### Minor Changes

- 新增基础导入包 `@bibliotype/import`：Markdown / HTML → `BookDocument`（零外部重依赖，复用 `@bibliotype/editor` 的 `markdownToNodes` 与扩充后的 `parseDOM`）。导出 `nodesToBookDocument` / `markdownToBookDocument` / `htmlToBookDocument` / `detectImportFormat` / `importFromText`；`metadata` 由调用方注入以保证确定性，docx/epub 留给对应重依赖叶子包。
- 新增纯文本（TXT）导入：`txtToBookDocument` 空行分段、段内硬换行合并（中文直拼 / 西文补空格）、`第X章` `卷X` 起章、章前内容自成无标题章、确定性 id（`idPrefix` + 序号），支持自定义 `chapterPattern` / `chapterType`；`detectImportFormat` 增加 `.txt` / `text/plain` → `'text'`，`importFromText` 第 5 参透传 `TxtImportOptions`。
- P1-B2a 导入链路（F5 / F6）：
  
  - **Markdown（F6）**：列表改为缩进递归，支持嵌套与松散项（最多 8 层）；新增 GFM 管道表格（对齐、`\|` 转义、缺列补空）；图片 title 或紧随的斜体行转为图注；`parseFrontMatter` 解析开头 YAML 子集并在导入层剥离，调用方 metadata 优先。
  - **DOCX 图片（F5）**：`docxToHtml` 缺省以内联 data URI 输出图片，`convertImage` 仍可覆盖。
  - **DOCX 样式（F5）**：新增 `parseDocxStyleInfo`（解包 `styles.xml`，中文样式名 / basedOn / 常用格式 → `NamedStyle`，仅保留正文引用样式）；新增 `docxToBookDocumentWithStyles` 返回 `{ document, namedStyles }`，段落经 `styleId` 挂载。
  - **DOCX 脚注（F5）**：mammoth 脚注输出归一为 `noteref` 标记 + `footnote` 节点（`fn-docx-N` / `ref-docx-N`），编号连续、可回跳；`noteref` 的 parseDOM 优先级高于通用链接。
  - **依赖**：`import-docx` 增加 `fflate` 与 `@xmldom/xmldom`（工作区既有库）。
  - **边界**：Word 制表位 / 边框 / 主题字体不映射；Markdown HTML 块、引用嵌套、数学公式不在本批。

### Patch Changes

- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
