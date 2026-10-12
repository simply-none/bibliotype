# @bibliotype/exporter-pdf

PDF 导出：IR → 打印文档（`@page` 尺寸 / 预分页固定页）+ 浏览器打印辅助（`window.print`）。

两种模式：

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

### `PrintCssOptions`（`buildPrintCss`）

`options`（布局）、`tokens`（令牌）、`mode`（模式）——生成 `@page` 尺寸、页边距等打印样式，
与书册样式表叠加使用。

### `PrintHtmlOptions`（`printHtml`）

`document?`：宿主 Document（缺省取全局 `document`；非浏览器环境抛错）。

## 相关

- 功能参考：[docs/08-export-pdf.md](../../docs/08-export-pdf.md)
- 分页基础：[docs/04-reader-and-pagination.md](../../docs/04-reader-and-pagination.md)
- 仓库主页：[bibliotype](../../README.md)
