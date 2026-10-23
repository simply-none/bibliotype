---
'@bibliotype/exporter-pdf': minor
---

PDF 导出新增「应用内直出」路径，并修复古籍直排打印分页：

- 新增 `createPrintPager(book, options)`：打印分页器（Reader 构建、全量分页与 CSS 拼装缓存一次），暴露 `pageCount` / `renderPage(index)` / `documentCss` / `renderDocument()`；`renderPrintHtml` 改为基于 pager 实现，对外产物逐字节不变。
- 新增 `exportRasterPdf(book, options)`（纯浏览器免打印对话框）：逐页 `<foreignObject>` 光栅化 → JPEG → pdf-lib（新依赖 `pdf-lib@^1.17.1`）拼装 PDF 直接下载；支持 `scale` / `quality` / `onProgress` / `signal`（中止）/ `rasterize`（注入式单页光栅化，Node 测试用）。产物为图片型 PDF；矢量文本仍走 `exportPdfBytes` 宿主适配器。
- 直排修复：paged 模式内部打印分页 Reader 显式传 `axis`（竖排 → `'column'`）与 `tokens`，与屏幕量尺同口径——此前直排书的块推进量（列向宽度）被按横排行高解释，分页与跨页行切片错位（古籍直排导出后续页只剩版框空白的根因）。

demo（私有包，不随版本发布）：设置面板新增「其他」分区，「PDF 导出方式」（`pdfExportMode: 'in-app' | 'browser-dialog'`，应用级偏好随界面偏好快照持久化，缺省 `in-app`）在应用内直出与打印对话框之间路由；Electron 宿主恒走矢量适配器；导出中按钮显示「导出中 N/M」，再次点击中止。
