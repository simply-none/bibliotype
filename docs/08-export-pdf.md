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
| `facing` | 对页镜像（`true` 或 `{ gutter }`）：右页装订边在左、左页在右 |
| `bleed` | 出血（mm，单边）：页面四周外扩，版心尺寸不变 |
| `cropMarks` | 四角裁切标记（仅 `paged` 且 `bleed > 0`） |
| `imageRules` | 图片按版心等比缩小（不裁切、不放大），与 DPI 检查同源 |

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
- 精排（可选）：`facing` 对页镜像、`bleed` / `cropMarks` 出血与裁切线、
  `imageRules` 图片版心约束；
- `@media print` 下链接去色去下划线。

```ts
import { buildPrintCss, type PrintMode, type PrintCssOptions } from '@bibliotype/exporter-pdf';

const css = buildPrintCss({ options: layoutOptions, tokens: DEFAULT_THEME, mode: 'paged' });
```

精排选项（均可选，缺省不输出、与改造前逐字符一致）：`facing` / `bleed` / `cropMarks` / `imageRules`，语义见下节。

## 精排管线（E8）

### 图片打印规则与 DPI 检查

图片在打印稿里只有一个约束：`max-width: 100%` + `max-height: 版心高`，等比缩小、**不裁切也不放大**（`imageRules: true`）。
是否够印由「有效 DPI」判定——浏览器按 96dpi 的 CSS 像素摆图，一张 1000px 宽的图缩到 447px 版心打印，等于 215dpi：

```
打印宽 = min(原始宽, 版心宽, 版心高 × 原始宽/原始高)
有效 DPI = 原始像素宽 × 96 ÷ 打印宽
```

```ts
import { collectPdfImageProblems, summarizePdfImageProblems } from '@bibliotype/exporter-pdf';

const issues = collectPdfImageProblems(document, {
  layout, tokens,          // 版心尺寸由布局 + page-margin 令牌推导（与打印样式同源）
  minDpi: 300,             // 缺省 300（常规胶印彩图）
  // reportUnmeasured: false,  // 外链 / SVG 等不报告
});
summarizePdfImageProblems(issues);
// '图片检查 3 条：低 DPI 2 张；超出版面 1 张'
```

| 码 | 严重度 | 触发条件 | 文案要点 |
| --- | --- | --- | --- |
| `IMAGE-OVERSIZE` | `info`（> 40MP 升 `warning`） | 原始尺寸超出版心，导出时等比缩小 | 实际打印尺寸、不裁切；超大图建议降采样 |
| `IMAGE-LOW-DPI` | `warning` | 有效 DPI < `minDpi` | 当前 DPI、阈值 DPI 下的最大成品尺寸（mm） |
| `IMAGE-UNMEASURED` | `warning` | 外链 / 相对路径 / 非 base64 data URI / 非 PNG·JPEG·GIF·BMP | 说明「无法量测，DPI 未校验」 |

嗅探只看文件头（PNG `IHDR`、JPEG `SOF`、GIF 逻辑屏幕、BMP `DIB`），不信 MIME；`contentWidthPx` / `contentHeightPx` 可覆盖推导值（与自定义量尺同源时传同一口径）。

### 对页镜像（facing）

右页（recto，奇数页）订口在左，左页（verso，偶数页）在右。`gutter` 是装订补偿（px），加在**内侧**页边距上：

```ts
renderPrintHtml(document, { mode: 'paged', facing: { gutter: 38 } });
// A4：右页 padding 48 56 48 94 / 左页 48 94 48 56
```

| 模式 | 实现 | 引擎要求 |
| --- | --- | --- |
| `auto` | `@page { size; margin }` + `@page :right / :left` 镜像 | Chromium 对页选择器支持不稳定，适合 Prince / Vivliostyle |
| `paged` | 逐页打 `bt-page-recto / bt-page-verso` 类，`.bt-page` padding 四边重写 | 任何引擎都确定生效（推荐） |

第 1 页按右页处理；仿真版式的书口带宽先并入对应物理边，再叠加中缝补偿。

### 出血与裁切线

`bleed` 为单边出血（mm）：页面尺寸 + 2b、`padding` 四边 + b，**版心位置与尺寸不变**。

```ts
renderPrintHtml(document, { mode: 'paged', bleed: 3, cropMarks: true });
// A5：@page / .bt-page 581×816（= 559+22 / 794+22），padding 59px 67px
```

- `paged`：每页插入 `.bt-crop-marks`（四角各一条 L 形），角点在裁切框（版心 + 页边距）的角上、臂长 = 出血量、伸到页面边；线宽 0.5px（≈0.13mm），印后随裁切去掉。
- `auto`：`@page` 额外下发 `marks: crop cross` 与 `bleed: 3mm`；Chromium 忽略这两个说明符（故需要真实角标时用 `paged`），Prince / Vivliostyle 会照做。
- 不含裁切标记时，仅外扩页面并补 padding 也能让满版底纹越过裁切线。

### CMYK 提示

浏览器打印管线只输出 **DeviceRGB（sRGB）** PDF——`@page` 写什么都改不了这一点，正式印刷必须在下游用 ICC 转 CMYK：

```ts
import { collectPrintColorAdvice, summarizePrintColorAdvice } from '@bibliotype/exporter-pdf';

const advice = collectPrintColorAdvice(document, { hasIccProfile: false });
// PRINT-CMYK-UNSUPPORTED（warning）：RGB 不可直出 CMYK，需下游转换
// PRINT-ICC-MISSING（warning）：未提供 ICC 输出配置文件（ISO Coated v2 等）
// PRINT-RGB-IMAGE（info）：文档含 N 张 sRGB 位图，转换后高饱和 / 暗部有色域压缩
summarizePrintColorAdvice(advice); // '印前色彩提示 2 条：RGB 不可直出 CMYK；未配置 ICC'
```

`target: 'rgb'`（数字校样 / 屏幕分发）直接返回空数组；三类报告与缺字报告同口径——**只提示，不阻断导出**。

### 后端评估：Paged.js / Vivliostyle

| 方案 | 许可 | 体积 | 能力 | 结论 |
| --- | --- | --- | --- | --- |
| Paged.js（`pagedjs` 0.5.x） | MIT | polyfill 单文件约 0.8MB（未压缩，含 css-tree） | 浏览器内按 CSS Paged Media 切页、页边距盒、运行页眉 | **不引入**：与 `reader` 预分页能力重叠，且产物仍是 DOM，最终仍靠 Chromium 打印——CMYK / 裁切一个都解决不了 |
| Vivliostyle | AGPL-3.0 | CLI 依赖 Chromium（puppeteer），安装体积百 MB 级 | 完整 CSS Paged Media：`@page :left/:right`、`marks` / `bleed`、直出 PDF | **不内置**：AGPL 传染性与体积都不适合进库；需要时由宿主用 `PdfExportAdapter` 接入，库零依赖 |

结论：精排能力留在 `exporter-pdf` 的 CSS 与报告层，**不引入新的排版引擎**（与执行约定「不新增自研排版引擎 / 不引入栅格化重依赖」一致）。`auto` 模式已按标准下发 `marks` / `bleed`，宿主换成 Prince / Vivliostyle 时无需改库。

### 已知取舍

- 出血只支持四边等值（单值 `mm`）；异形出血 / 折页标记不在本项范围。
- `@page :left/:right` 在 Chromium 的实现随版本波动，生产对页请用 `paged`（DOM 类）而非 `auto`。
- DPI 检查只覆盖 data URI 的四种位图；矢量（SVG）不计 DPI，WebP 等新格式按「无法量测」提示。
- 图片规则不会让图**放大**到版心宽：小图仍按原尺寸打印，这正是低 DPI 告警的来源。

## 相关

- 包参考：[`@bibliotype/exporter-pdf`](../packages/exporter-pdf/README.md)
- 预分页与页码：[04 阅读器与分页](04-reader-and-pagination.md)
- 打印文档与 EPUB 共用同一序列化器：[05 版式与 HTML](05-layout-and-html.md)
