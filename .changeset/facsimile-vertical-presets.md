---
"@bibliotype/layout": minor
"@bibliotype/reader": minor
"@bibliotype/vue": minor
"@bibliotype/exporter-pdf": minor
---

新增「古籍仿真直排」：版框 / 界行 / 版心（书口）与六种古籍版式模板

- `layout`：新增 `LayoutOptions.facsimile`（缺省 `undefined` = 不启用）、
  `FACSIMILE_PRESETS` 六模板、`resolveFacsimileGrid` 行款与几何纯函数；
  版心带宽进入主轴扣减与度量签名，版框 / 界行 / 颜色属纯绘制、不触发重排；
  `buildBookCss` 新增 `pageDecoration`（默认 `false`）与同源版心序列化。
- `reader`：新增 `getPageGutterTexts` 与 `resolvePageGutterTexts`（书名 / 篇卷 / 叶次）。
- `vue`：`BtBookView` / `PagedCanvas` 在带 `facsimile` 时开启装饰并注入版心。
- `exporter-pdf`：`paged` 模式同步版框 / 界行 / 版心，打印与预览一致。

兼容性：既有「古籍直排」与「现代横排」行为不变——未启用 `facsimile` 时样式表、
版心尺寸与度量签名与改造前逐字符 / 逐数值相同（新增 `classical-isolation` 回归测试守护）。
