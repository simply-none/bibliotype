---
"@bibliotype/core": minor
"@bibliotype/editor": minor
"@bibliotype/layout": minor
---

字图内联（K6）：「用图片顶替缺字」的块级图片归入文字流，阅读 / 分页 / 编辑 / 导出四链天然一致。

- **core**：新增 `NODE_TYPES.GLYPH_IMAGE`（`'glyph-image'`，`kind:'inline'` 行内原子节点，与 `math-inline` 同层；attrs `src` / `alt` / `char` / `width` / `height`）与 `normalizeGlyphImages(document, options?)`——导入边界一次归一化：识别出字图特征的块级 image（排除项：与图注配对、宽或高超 `maxGlyphPx`（缺省 64）；强信号：alt ≤ `maxAltChars`（缺省 2）字、近方形小尺寸（宽高比 `aspectRange` 缺省 0.6~1.6）；弱信号：src 命中 `srcHints`、png / svg / gif 扩展名、**内嵌位图 data URI**（docx / epub 主流形态，无 alt 无尺寸）与**位置信号**（前段未收尾 = 切断句子，插图几乎不在句中；仅对该图无任何尺寸元数据时计入）；判定 = 无排除且（强信号 ≥1 或弱信号 ≥2），仅单弱信号保守保留不丢数据），归并按文档序：`auto` 且两侧都是段落、前段未收尾 → **前段 + 字图 + 后段三合一复原**被切断的同一句话（`position: 'restore'`）；前段收尾缝后段头（`'next-start'`）；字图在容器末尾缝前段尾（`'prev-end'`）；强制 `merge: 'auto' | 'prev' | 'next'` 中 prev / next 只缝单侧不复原，返回 `{ document, report }`，原档 structuredClone 不可变；配套 `summarizeGlyphImageReport` / `DEFAULT_GLYPH_IMAGE_OPTIONS` 与 `GlyphImageReport` 等类型。
- **editor**：classical schema 注册 `glyph-image`（group `inline`、`inline` + `atom`，attrs `src` / `alt` / `char`；parseDOM `img.bt-glyph-image`，toDOM 同 class 回吐），渲染产物可无损回编辑器；`image` 的 `img` 通配对 `bt-glyph-image` 让位（返回 `false`），行内字图不再被 PM 从段落 slicing 出来独立成块。
- **layout**：序列化器支持 `glyph-image` → `<img class="bt-glyph-image" … />`（src 走 `rewriteSrc`、`data-char` 空省略，与 image 同规）；书册样式新增 `.bt-glyph-image`：`display:inline-block` + **1em 硬限幅**（`width` / `height` / `max-width` / `max-height` 均 1em，原图再大也不超两侧文字的高 / 宽）+ `object-fit:contain` + 基线下沉 `0.15em`（与 `.bt-glyph` 同款口径）；直排（`writingMode` 竖排）构建期追加 `transform: rotate(90deg)`——img 不随 writing-mode 旋转，1em 方形旋转后占位不变；classical CSS 基线哈希同步更新。
- **分页 / 量尺零改动**：字图是段落行内子节点，随段落实测行盒进 `lineMainSizes`（不等行高既有支持）；跨页切片对零文本 inline atom 按位置整体归属（`math-inline` 先例同口径），不丢图不错位。
- demo 宿主侧（私有包）：`ImportPanel` 五种格式导入统一在收口处过 `normalizeGlyphImages`，状态行展示摘要（「已将 N 张缺字图归入文字流；M 张按插图保留」）。
