---
"@bibliotype/reader": minor
---

块抽取 `extractBlocks` 支持外部传入 `blockSizes`（DOM 实测尺寸映射）：命中某块 id 时以实测主轴尺寸替代按字符数的估算，改善含图 / 表 / 公式文档的分页准确度；未传入时回退原估算器，行为向后兼容。
