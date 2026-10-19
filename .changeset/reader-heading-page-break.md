---
"@bibliotype/reader": minor
---

`extractBlocks` 新增 h1 / h2 标题另起页（仿纸质书）。`attrs.level` ≤ 2 的标题（缺省视为 h1）标记 `breakBefore`，从新页页首起排；h3~h6 不强制另起页，仅保留 `keepWithNext` 与下段同页。该标记与结构容器首块标记、分页符标记正交，主轴方向由调用方按书写方向传尺寸，**横排与直排同逻辑**（阅读 / 预览 / 导出共用 `extractBlocks → paginate` 管线，自动生效）。
