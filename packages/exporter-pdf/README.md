# @bibliotype/exporter-pdf

PDF 导出：IR → 打印文档（`@page` 尺寸 / 预分页固定页）+ 浏览器打印辅助（`window.print`），
并支持**宿主适配器直出文件**（Electron `printToPDF` / Node 无头浏览器，`exportPdfBytes` →
`downloadPdf`，秒级、矢量、无打印对话框）。

两条导出路径：

- **适配器导出（推荐 Electron / 服务端）**：`exportPdfBytes(book, { adapter })` 拿到 PDF 字节，
  `downloadPdf` 落盘；宿主注入 `PdfExportAdapter`，浏览器不阻塞主线程。
- **浏览器打印降级**：`printHtml` / `printBook` 走 `window.print()`，配合
  `createImageBlobRewriter` 做图片去重瘦身（大书仍受 Chromium 打印管线限制，数十秒级）。

两种分页模式：

- `auto`（默认）：输出连续文档，交给浏览器打印引擎分页（`@page` 尺寸与页边距生效）；
- `paged`：复用阅读器分块与分页器，先在内存中完成分页，每页为固定尺寸的独立页面，
  打印结果与屏幕分页严格一致。

## 安装

```bash
pnpm add @bibliotype/exporter-pdf
```

## 快速上手

### 一步打印

```ts
import { printBook } from '@bibliotype/exporter-pdf';
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';

printBook(document, {
  layout: CLASSICAL_LAYOUT_OPTIONS,
  mode: 'paged',
});
```

`printBook` = `renderPrintHtml` + `printHtml`：在隐藏 iframe 中装载打印文档并调用
`window.print()`，打印样式不污染当前页面，`afterprint` 后自动清理；宿主 `document`
可注入（多窗口 / 测试场景）。

### 适配器直出 PDF 文件（Electron / 无头浏览器）

```ts
import { exportPdfBytes, downloadPdf, type PdfExportAdapter } from '@bibliotype/exporter-pdf';

const adapter: PdfExportAdapter = {
  async toPdf(html, options) {
    return window.electronPdf.exportPdf(html, options); // 宿主注入：离屏窗口 printToPDF
  },
};

const bytes = await exportPdfBytes(document, { adapter, mode: 'paged' });
downloadPdf(bytes, '论语.pdf');
```

适配器收到的 HTML 必须自包含：离屏 / 跨进程窗口不共享 `blob:` URL，故 adapter 路径
**不传 `rewriteSrc`**（图片保持 inline data URI）。浏览器降级路径才用
`createImageBlobRewriter` 做 data URI → blob URL 去重。详见 [docs/08-export-pdf.md](../../docs/08-export-pdf.md)。

### 分步使用

```ts
import { renderPrintHtml, printHtml, buildPrintCss } from '@bibliotype/exporter-pdf';
import { DEFAULT_THEME } from '@bibliotype/core';

const html = renderPrintHtml(document, { mode: 'paged' });   // 打印文档 HTML（可另存 / 传输）
printHtml(html);                                             // 打印一段完整 HTML 文档

const css = buildPrintCss({ options: layout, tokens: DEFAULT_THEME, mode: 'paged' });
```

## 选项

### `PrintDocumentOptions`（`renderPrintHtml` / `printBook`）

| 选项 | 说明 |
| --- | --- |
| `layout` | 布局选项（缺省 `DEFAULT_LAYOUT_OPTIONS`；古籍传 `CLASSICAL_LAYOUT_OPTIONS`） |
| `tokens` | 主题令牌表（缺省 `DEFAULT_THEME`） |
| `fontToken` | 正文字体令牌键（古籍传 `FONT_TOKENS.CLASSICAL_BODY`） |
| `mode` | `'auto'`（默认）/ `'paged'`（预分页固定页） |
| `pageMainSize` | 每页可用主轴尺寸（px，仅 paged；缺省按页面尺寸与页边距推导） |
| `estimator` / `context` | 自定义块尺寸估算器 / 估算上下文覆盖（仅 paged） |
| `tagOverrides` | 节点类型 → 标签覆盖（透传序列化器） |
| `rewriteSrc` | 图片 src 改写回调（浏览器降级路径做 data URI → blob URL 去重） |

### `PrintCssOptions`（`buildPrintCss`）

`options`（布局）、`tokens`（令牌）、`mode`（模式）——生成 `@page` 尺寸、页边距等打印样式，
与书册样式表叠加使用。

### `PrintHtmlOptions`（`printHtml`）

`document?`：宿主 Document（缺省取全局 `document`；非浏览器环境抛错）。
`onAfterPrint?`：打印完成后回调（iframe 移除前触发，用于释放 blob URL 等）。

### `PdfExportAdapter`（`exportPdfBytes`）

| 成员 | 说明 |
| --- | --- |
| `toPdf(html, options?)` | 宿主实现：把自包含 HTML 渲染为 PDF 字节（`Uint8Array`）。`options` 透传打印引擎参数（`pageSize` / `margins` / `printBackground` / `preferCssPageSize`） |
| `name?` | 可选标识（调试 / 降级判断） |

`exportPdfBytes(book, { adapter, ...printOptions })`：`renderPrintHtml` + `adapter.toPdf` 一步到位。
缺 `adapter` 抛错（无适配器应走 `printBook` 降级）。
`downloadPdf(bytes, filename)`：浏览器 Blob 下载（`application/pdf`）。

## 相关

- 功能参考：[docs/08-export-pdf.md](../../docs/08-export-pdf.md)
- 分页基础：[docs/04-reader-and-pagination.md](../../docs/04-reader-and-pagination.md)
- 仓库主页：[bibliotype](../../README.md)
