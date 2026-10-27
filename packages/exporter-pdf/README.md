# @bibliotype/exporter-pdf

PDF 导出：IR → 打印文档（`@page` 尺寸 / 预分页固定页）+ 浏览器打印辅助（`window.print`），
并支持**宿主适配器直出文件**（Electron `printToPDF` / Node 无头浏览器，`exportPdfBytes` →
`downloadPdf`，秒级、矢量、无打印对话框）。印前精排：对页镜像、出血与裁切标记、
图片 DPI 检查、CMYK 转色提示（E8）。

三条导出路径：

- **适配器导出（推荐 Electron / 服务端）**：`exportPdfBytes(book, { adapter })` 拿到 PDF 字节，
  `downloadPdf` 落盘；宿主注入 `PdfExportAdapter`，浏览器不阻塞主线程。
- **应用内直出（纯浏览器推荐）**：`exportRasterPdf` 逐页光栅化（与预览同源的预分页片段 →
  `<foreignObject>` → JPEG → pdf-lib 拼装）直接生成 PDF 文件下载；免打印对话框、
  带进度可中止，大书秒级；产物为图片型（文字不可选中）。
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

### 应用内直出 PDF 文件（纯浏览器，免打印对话框）

```ts
import { exportRasterPdf, downloadPdf } from '@bibliotype/exporter-pdf';

const controller = new AbortController();
const bytes = await exportRasterPdf(document, {
  mode: 'paged',                 // 选项同 PrintDocumentOptions；内部恆按 paged 预分页
  scale: 2,                      // 清晰度：1 = 96dpi / 2 = 192dpi（文件约 4 倍）
  quality: 0.92,
  onProgress: (done, total) => report(done, total),
  signal: controller.signal,     // 中止抛 AbortError
  // rasterize,                 // 可注入单页 HTML→位图实现（Node 测试 mock 用）
});
downloadPdf(bytes, '论语.pdf');
```

逐页消费预分页结果可直接用 `createPrintPager`（`pageCount` / `renderPage(index)` /
`documentCss` / `renderDocument()` / `outline`，与 `renderPrintHtml` 产物逐字节一致）。

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

### 目录书签（PDF `/Outlines`）

```ts
import { exportPdfBytes, buildPdfOutline, writePdfOutline } from '@bibliotype/exporter-pdf';

const bytes = await exportPdfBytes(document, {
  adapter,
  mode: 'paged',
  outline: true,                              // 缺省 true
  onOutline: ({ written, skipped }) => report(written, skipped),
});
```

- 书签源与阅读器目录面板同源（`reader.outline` + `reader.getPageOfNode`），层级与页码一致；
- `exportRasterPdf` 恒写（分段导出按 `from` 重定基）；`exportPdfBytes` 只在引擎页数与
  预分页一致时写（否则原样返回并经 `onOutline` 报原因）；`mode: 'auto'` 无固定页界，不写；
- 自建管线：`writePdfOutline(pdf, entries, { pageOffset })`；目录树 → 书签树用
  `buildPdfOutline(outline, pageOfKey)`；`PrintPager.outline` 已直接给出书签树。

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
| `facing` | 对页镜像（`true` 或 `{ gutter }`）：奇数页装订边在左、偶数页在右 |
| `bleed` | 出血（mm，单边）：页面四周外扩，版心位置不变 |
| `cropMarks` | 四角裁切标记（仅 paged 且 `bleed > 0`） |
| `imageRules` | 图片按版心等比缩小（`max-width` / `max-height`，不裁切） |
| `footnoteFloat` | 页底浮注（仅 paged，与预览 Reader 同源）：脚注不进正文流、落所在页页底注区 `.bt-page-notes` |
| `noteMaxRatio` | 页底注区占页面主轴上限（0~1，缺省 0.4；仅 `footnoteFloat` 生效） |

### `PrintCssOptions`（`buildPrintCss`）

`options`（布局）、`tokens`（令牌）、`mode`（模式）——生成 `@page` 尺寸、页边距等打印样式，
与书册样式表叠加使用。精排选项（均可选，缺省不输出）：`facing`（对页镜像）、
`bleed`（出血 mm）、`cropMarks`（裁切标记）、`imageRules`（图片版心约束）、
`flowColumns`（块级逐页分栏规则；由 `createPrintPager` 按分页结果探测，一般无需手传）。

### 精排（对页 / 出血 / 裁切线）

```ts
const html = renderPrintHtml(document, {
  mode: 'paged',
  facing: { gutter: 40 },  // 中缝装订补偿 40px：右页加左内边距、左页加右内边距
  bleed: 3,                // 出血 3mm：页面四周外扩 11px，版心尺寸不变
  cropMarks: true,         // 四角 L 形裁切标记
  imageRules: true,        // 图片等比缩到版心内（不裁切、不放大）
});
```

- `paged` 逐页打 `bt-page-recto / bt-page-verso`（第 1 页为右页），裁切标记为
  `.bt-crop-marks` 覆盖层；`auto` 走 `@page :right / :left`，出血另下发
  `marks: crop cross` / `bleed` 说明符（Chromium 忽略，供 Prince / Vivliostyle）。
- 宿主打印引擎的纸张尺寸、边距必须留空或跟随 CSS（`preferCssPageSize: true`），
  否则出血 / 对页白做。

### `PrintHtmlOptions`（`printHtml`）

`document?`：宿主 Document（缺省取全局 `document`；非浏览器环境抛错）。
`onAfterPrint?`：打印完成后回调（iframe 移除前触发，用于释放 blob URL 等）。

### 缺字报告（K6）

```ts
import { collectPdfGlyphProblems, summarizePdfGlyphProblems } from '@bibliotype/exporter-pdf';

const issues = collectPdfGlyphProblems(document, {
  families: ['Songti SC', 'SimSun', 'serif'],
  probe: (char, family) => document.fonts.check(`12px ${family}`, char),
  idsFor: (char) => idsDictionary.get(char),
});
// [{ char: '𫞩', code: 'U+2B7A9', path: '0.2.1', context: '山𫞩水', stage: 'ids' | 'tofu', … }]
summarizePdfGlyphProblems(issues); // '缺字 2 处：𫞩（U+2B7A9，可 IDS 合成）；𠀋（U+2000B）'
```

只警告、不阻断导出；`stage: 'ids'` 表示可用 IDS 合成显示，`'tofu'` 表示会显示豆腐块。
探测端口缺省时视为全部命中（宁漏报不误报）。

### 图片 DPI 与印前色彩提示（E8）

```ts
import {
  collectPdfImageProblems,
  summarizePdfImageProblems,
  collectPrintColorAdvice,
  summarizePrintColorAdvice,
} from '@bibliotype/exporter-pdf';

const images = collectPdfImageProblems(document, { minDpi: 300 });
// IMAGE-OVERSIZE（超出版心、缩放不裁切）、IMAGE-LOW-DPI（低于阈值）、
// IMAGE-UNMEASURED（外链 / SVG 等无法量测）
summarizePdfImageProblems(images); // '图片检查 3 条：低 DPI 2 张；超出版面 1 张'

const advice = collectPrintColorAdvice(document, { hasIccProfile: false });
// PRINT-CMYK-UNSUPPORTED / PRINT-ICC-MISSING / PRINT-RGB-IMAGE
```

浏览器打印管线只输出 DeviceRGB PDF，**不能直出 CMYK**：印前需下游按 ICC 转换，
高饱和色会有色域压缩。两类报告与缺字报告同口径——只提示、不阻断导出。

### `PdfExportAdapter`（`exportPdfBytes`）

| 成员 | 说明 |
| --- | --- |
| `toPdf(html, options?)` | 宿主实现：把自包含 HTML 渲染为 PDF 字节（`Uint8Array`）。`options` 透传打印引擎参数（`pageSize` / `margins` / `printBackground` / `preferCssPageSize`） |
| `name?` | 可选标识（调试 / 降级判断） |

`exportPdfBytes(book, { adapter, outline?, onOutline?, ...printOptions })`：`createPrintPager` +
`adapter.toPdf` 一步到位（缺省补写目录书签，页数不一致则回原字节）。
缺 `adapter` 抛错（无适配器应走 `printBook` 降级）。
`downloadPdf(bytes, filename)`：浏览器 Blob 下载（`application/pdf`）。

## 相关

- 功能参考：[docs/08-export-pdf.md](../../docs/08-export-pdf.md)
- 分页基础：[docs/04-reader-and-pagination.md](../../docs/04-reader-and-pagination.md)
- 仓库主页：[bibliotype](../../README.md)
