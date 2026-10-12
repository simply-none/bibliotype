# 08 PDF 与打印

> 涉及包：`@bibliotype/exporter-pdf`　·　相关：[04 阅读器与分页](04-reader-and-pagination.md)、[07 EPUB 导出](07-export-epub.md)

PDF 导出走**浏览器打印链路**：生成打印稿 HTML（内联样式），交给 `window.print()`
或（Node 侧）无头浏览器出 PDF。无 DOM 依赖的生成函数可在两端同构调用。

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

## printHtml / printBook —— 浏览器打印

```ts
import { printHtml, printBook } from '@bibliotype/exporter-pdf';

printHtml(html);                                  // 打印一段完整 HTML 文档
printBook(document, { mode: 'paged' });           // renderPrintHtml + printHtml 一步到位
printHtml(html, { document: otherWindow.document }); // 注入宿主 document（多窗口 / 测试）
```

机制：创建隐藏 iframe（0×0、`aria-hidden`）载入打印文档并调用 `window.print()`，
打印样式随 iframe 文档生效、**不污染当前页面**；`afterprint` 后自动移除 iframe。
非浏览器环境（未检测到 `document`）抛错。

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

## Node 侧出 PDF（无头浏览器思路）

```ts
import { renderPrintHtml } from '@bibliotype/exporter-pdf';
import { writeFileSync } from 'node:fs';

const html = renderPrintHtml(document, { mode: 'paged' });
writeFileSync('book.html', html);
// 然后：puppeteer / playwright 打开 book.html → page.pdf({ printBackground: true })
```

## 相关

- 包参考：[`@bibliotype/exporter-pdf`](../packages/exporter-pdf/README.md)
- 预分页与页码：[04 阅读器与分页](04-reader-and-pagination.md)
- 打印文档与 EPUB 共用同一序列化器：[05 版式与 HTML](05-layout-and-html.md)
