# @bibliotype/import-docx

## 26.10.25-rc.1

### Minor Changes

- 新增 docx 导入包 `@bibliotype/import-docx`：`.docx` → HTML（`mammoth`）→ `BookDocument`（复用 `@bibliotype/import` 的 HTML 通路）。导出 `docxToHtml`（字节 → 标准 HTML，浏览器 / Node 双端输入）与 `docxToBookDocument`（字节 → `BookDocument`）；`metadata` 由调用方注入以保证确定性，内嵌图片默认退化为空 `src` 占位（D4-a，资源解析钩子经 `convertImage` 预留）。`mammoth` 重依赖隔离在本叶子包，使用侧建议按需 `import()` 动态加载。
- P1-B2a 导入链路（F5 / F6）：
  
  - **Markdown（F6）**：列表改为缩进递归，支持嵌套与松散项（最多 8 层）；新增 GFM 管道表格（对齐、`\|` 转义、缺列补空）；图片 title 或紧随的斜体行转为图注；`parseFrontMatter` 解析开头 YAML 子集并在导入层剥离，调用方 metadata 优先。
  - **DOCX 图片（F5）**：`docxToHtml` 缺省以内联 data URI 输出图片，`convertImage` 仍可覆盖。
  - **DOCX 样式（F5）**：新增 `parseDocxStyleInfo`（解包 `styles.xml`，中文样式名 / basedOn / 常用格式 → `NamedStyle`，仅保留正文引用样式）；新增 `docxToBookDocumentWithStyles` 返回 `{ document, namedStyles }`，段落经 `styleId` 挂载。
  - **DOCX 脚注（F5）**：mammoth 脚注输出归一为 `noteref` 标记 + `footnote` 节点（`fn-docx-N` / `ref-docx-N`），编号连续、可回跳；`noteref` 的 parseDOM 优先级高于通用链接。
  - **依赖**：`import-docx` 增加 `fflate` 与 `@xmldom/xmldom`（工作区既有库）。
  - **边界**：Word 制表位 / 边框 / 主题字体不映射；Markdown HTML 块、引用嵌套、数学公式不在本批。

### Patch Changes

- P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
