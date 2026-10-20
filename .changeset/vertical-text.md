---
"@bibliotype/layout": minor
"@bibliotype/exporter-pdf": minor
---

竖排细节包（B7）：竖排标点 / 引号形态与数字分组。

- `layout` 新增 `vertical-text.ts`：`VERTICAL_PUNCTUATION_FORMS`（`。︒` `、︑` `「﹁`
  `」﹂` 等 22 个竖排呈现形式）、`toVerticalPunctuation`、`toKanjiDigits`、
  `toFullwidthDigits`、`transformVerticalText`、`needsVerticalTextTransform`；
  转换逐字符一一对应，不改字符数 / 文本偏移；
- `combine-upright` 新增 `longDigits: 'kanji'`（超长数字串转汉字数字直排），
  `segmentForVertical` / `combineUprightCss` 选项改为可部分传入；
- `serializeNode` 新增 `SerializeNodeOptions.verticalText`（缺省不转换，交给浏览器
  `vert` 特性；代码块逐字输出不受影响）；
- `exporter-pdf` 新增 `PrintDocumentOptions.verticalText`，`auto` / `paged` 两条
  打印路径透传。
