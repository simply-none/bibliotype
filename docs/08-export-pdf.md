# 08 PDF 与打印

> 涉及包：`@bibliotype/exporter-pdf`　·　相关：[04 阅读器与分页](04-reader-and-pagination.md)、[07 EPUB 导出](07-export-epub.md)

PDF 导出分两条路：**宿主适配器**（Electron `printToPDF` / Node 无头浏览器，秒级直出文件）
与**浏览器打印降级**（`window.print()`，受 Chromium 打印管线限制）。无 DOM 依赖的
生成函数（`renderPrintHtml`）可在两端同构调用。

## 为什么不是「打印」而是「导出」

浏览器内「打印为 PDF」必须走 Chromium 打印管线：大书（千页 / MB 级内联图片）实测
**数分钟级**且阻塞主线程、必经打印对话框。实测耗时分布（诗经级大书，1185 页）：

| 阶段 | 耗时 |
| --- | --- |
| `renderPrintHtml` auto 模式 | **84ms** |
| `renderPrintHtml` paged 模式 | 4.2s（其中 `getPageFragments` ×1185 页占 2.5s） |
| iframe 写入 5.4MB HTML + `window.print()` | **约 5–6 分钟** ← 主瓶颈 |

HTML 里图片 base64 占 4MB（1162 处引用 / 17 张唯一图），打印引擎逐处解码是放大器。
故：adapter 路径给「真导出」，降级路径做「图片 blob 化去重」瘦身。

## renderPrintHtml —— 生成打印文档

```ts
import { renderPrintHtml } from '@bibliotype/exporter-pdf';

const html = renderPrintHtml(document, {
  mode: 'paged',                     // 'auto'（默认，浏览器分页）| 'paged'（预分页固定页）
  layout: CLASSICAL_LAYOUT_OPTIONS,
  tokens: { ...DEFAULT_THEME, ...CLASSICAL_THEME_OVERRIDES },
  fontToken: FONT_TOKENS.CLASSICAL_BODY,
});
```

两种模式：

| 模式 | 分页方式 | 产物 |
| --- | --- | --- |
| `auto` | 浏览器打印引擎分页；`@page` 声明尺寸与页边距；结构节点经 `break-before: page` 另起页 | 整书语义 HTML 单文档流（`<main class="bt-book">`） |
| `paged` | 复用 `reader.extractBlocks` + `layout.paginate` **预分页**；每页固定尺寸 `.bt-page` + 页脚页码 | `<section class="bt-page">` 序列 |

`paged` 模式下 `@page margin` 置 0，页边距由 `.bt-page` 的 padding 承担，
页码经 `formatPageNumber` 按 `pageNumberStyle` 格式化。

### PrintDocumentOptions

| 选项 | 说明 |
| --- | --- |
| `layout` | 布局选项（缺省 `DEFAULT_LAYOUT_OPTIONS`） |
| `tokens` | 主题令牌表（缺省 `DEFAULT_THEME`） |
| `fontToken` | 正文字体令牌键（缺省 `FONT_TOKENS.BODY`） |
| `mode` | 打印模式（缺省 `'auto'`） |
| `pageMainSize` | 每页可用主轴尺寸 px（仅 `paged`；缺省按页面尺寸与页边距推导） |
| `estimator` / `context` | 块尺寸估算器 / 估算上下文（仅 `paged`；缺省 `reader.defaultEstimator`） |
| `tagOverrides` | 节点类型 → 标签覆盖（透传序列化器） |
| `rewriteSrc` | 图片 src 改写回调（降级路径做 data URI → blob URL 去重，见下） |

## 宿主适配器导出（推荐：Electron / 无头浏览器）

```ts
import { exportPdfBytes, downloadPdf, type PdfExportAdapter } from '@bibliotype/exporter-pdf';

/* 宿主（Electron preload / Node 无头浏览器 / 测试）注入适配器 */
const adapter: PdfExportAdapter = {
  async toPdf(html, options) {
    /* Electron：IPC 到主进程，离屏窗口 printToPDF，见下节 */
    return window.electronPdf.exportPdf(html, options);
  },
};

const bytes = await exportPdfBytes(document, { adapter, mode: 'paged' });
downloadPdf(bytes, '论语.pdf');
```

`PdfAdapterOptions`（透传宿主打印引擎）：`pageSize`（'A4' / 'A5' / {width,height}）、
`margins`、`printBackground`（缺省 true，古籍框线 / 底纹依赖背景）、`preferCssPageSize`
（缺省 true，沿用 `@page` 声明）。

**契约：adapter 收到的 HTML 必须自包含**——离屏窗口 / 跨进程场景不共享 `blob:` URL，
故 adapter 路径不要传 `rewriteSrc`（图片保持 inline data URI，`renderPrintHtml` 缺省行为）。

### Electron 接入示例

preload（`contextBridge.exposeInMainWorld('electronPdf', ...)`）：

```ts
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronPdf', {
  exportPdf: (html: string, options?: unknown) =>
    ipcRenderer.invoke('pdf:export', html, options),
});
```

主进程（离屏窗口 + `webContents.printToPDF`，矢量文本、无对话框、秒级）：

```ts
// main.ts
import { BrowserWindow, ipcMain } from 'electron';

ipcMain.handle('pdf:export', async (event, html: string, options) => {
  const owner = BrowserWindow.fromWebContents(event.sender)!;
  const child = new BrowserWindow({ show: false, width: 800, height: 600 });
  try {
    await child.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(html),
    );
    const pdf = await child.webContents.printToPDF({
      printBackground: options?.printBackground ?? true,
      preferCSSPageSize: options?.preferCssPageSize ?? true,
      pageSize: options?.pageSize,           // 口径见 Electron 文档
      margins: options?.margins,
    });
    return new Uint8Array(pdf);
  } finally {
    child.destroy();
    void owner;
  }
});
```

注意：data: URL 窗口里 **`blob:` 引用会失效**——这正是 adapter 路径必须用 inline 图片的原因。

Node 无头浏览器（puppeteer）同理：`page.setContent(html)` → `page.pdf({ printBackground: true })`，
包成同样的 `PdfExportAdapter` 即可。

## 浏览器打印降级（printHtml / printBook）

无 adapter 时（纯浏览器宿主）走既有打印链路，配图片 blob 化去重：

```ts
import { createImageBlobRewriter, printHtml, renderPrintHtml } from '@bibliotype/exporter-pdf';

const rewriter = createImageBlobRewriter();
try {
  const html = renderPrintHtml(document, { rewriteSrc: rewriter.rewrite });
  printHtml(html, { onAfterPrint: () => rewriter.revokeAll() });
} catch (error) {
  rewriter.revokeAll();
  throw error;
}
```

- `createImageBlobRewriter`：data URI → `blob:` URL 并按内容去重（1162 处引用 / 17 张唯一图
  → HTML 体积与解码负担同步大降）；`onAfterPrint` / 异常时 `revokeAll()` 释放。
- 机制：创建隐藏 iframe（0×0、`aria-hidden`）载入打印文档并调用 `window.print()`，
  打印样式随 iframe 文档生效、**不污染当前页面**；`afterprint` 后自动移除 iframe。
- 大书仍需数十秒（Chromium 打印管线限制），建议 UI 明示「降级模式」。

`printBook(document, options)` = `renderPrintHtml` + `printHtml` 一步到位
（`options` 同时含打印文档选项与 `document` / `onAfterPrint`）。

## 打印样式（buildPrintCss）

`buildPrintCss({ options, tokens, mode })` 与 `buildBookCss` 叠加使用，产出：

- `@page`：页面尺寸（`options.pageSize`）与页边距（`page-margin` 令牌）；
- `auto`：`.bt-volume / .bt-chapter / .bt-section / …` 系列 `break-before: page`，
  首页 `break-before: auto`；
- `paged`：`.bt-page` 固定尺寸 + `break-after: page`（末页 auto）、
  `.bt-page-number` 页脚绝对定位；
- `@media print` 下链接去色去下划线。

```ts
import { buildPrintCss, type PrintMode, type PrintCssOptions } from '@bibliotype/exporter-pdf';

const css = buildPrintCss({ options: layoutOptions, tokens: DEFAULT_THEME, mode: 'paged' });
```

## 相关

- 包参考：[`@bibliotype/exporter-pdf`](../packages/exporter-pdf/README.md)
- 预分页与页码：[04 阅读器与分页](04-reader-and-pagination.md)
- 打印文档与 EPUB 共用同一序列化器：[05 版式与 HTML](05-layout-and-html.md)
