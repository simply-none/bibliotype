---
"@bibliotype/layout": minor
"@bibliotype/reader": minor
"@bibliotype/editor": minor
"@bibliotype/annotation": minor
"@bibliotype/vue": minor
"@bibliotype/exporter-epub": minor
"@bibliotype/exporter-site": minor
"@bibliotype/core": minor
---

P0 能力接线批次（B5 / C4 / C6 / C9 / D2 / D4 / E9）：

- **B5 页底注区渲染**：`serializePageNotes` + `.bt-page-notes` / `.bt-note-continued` 样式，`PaginatedPage.notesCarried` / `Reader.isPageNotesContinued`，`BtBookView` 输出注区槽（续前页标记、超限告警，不裁剪）。
- **C4 表格合并 / 拆分**：`mergeCells` / `splitCell`（矩形校验、跨表头冲突拒绝、非矩形不派发事务；拆分补齐空单元格）。
- **C6 / D2 标注**：`core` 新增 `ExportComment` 契约；`annotationsToMarkdown`；`useAnnotations` + `BtAnnotationSidebar`（书签 / 高亮 / 笔记 / 评论四 tab）；`includeComments`（EPUB / 站点，缺省 false）。
- **C9 统计**：`useDocumentStats`（300ms 防抖）+ `BtDocumentStats`（字数 / 块数 / 阅读时长 / 注释数 + 章节分布，纯 CSS 条形）。
- **D4 手势与键盘**：`BtBookView` 新增 `fontSize` / `update:fontSize` 双指缩放（12–32px），scroll 模式可聚焦并支持 PageUp / PageDown / 空格 / Home / End 滚屏。
- **E9 校验 CLI**：`runValidateCli` + `bt-validate-epub`（`--json` / `--help`，退出码 0/1/2），CI 增加合法样本与损坏文件校验步骤。
- **依赖**：新增合法方向 `vue → annotation → core`；导出器只消费 `ExportComment`，不依赖 `annotation`。
