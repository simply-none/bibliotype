---
"@bibliotype/core": patch
"@bibliotype/editor": patch
"@bibliotype/layout": patch
"@bibliotype/reader": patch
---

字图识别补口：EPUB 内联 SVG 缺字图不再漏判，导入保留图片宽高，纯字图段落整块，demo 打开存量书自动归一化回写。

- **core**：`normalizeGlyphImages` 的内嵌 data URI 信号扩为含 `data:image/svg+xml`——EPUB 缺字图大量以内联 SVG 顶替，此前该形态只剩「切断句子」单弱信号而保守保留成块级插图（脱离上下文独占一行居中）；现与位图 data URI 同为「内嵌图片」弱信号，叠加位置信号即可判定归并。保守语义不变：前段已收尾等单弱信号场景仍保留并写报告，不丢数据。
- **editor**：`image` 的 parseDOM 保留 `<img>` 原生 `width` / `height`（缺省 / 非法归一为 null，`attrs` 新增可空声明）——带尺寸的缺字图（EPUB / 网页主流 `<img width="16" height="16">` 形态）导入即命中「近方形小图」强信号；IR ⇄ PM 往返无损。
- **layout**：块级 `image` 序列化把 `width` / `height` 输出为原生属性（正数才输出），不再降级为 `data-*`——浏览器可在图片加载前预留版位，导出产物尺寸保真。
- **reader**：`isLeafBlock` 对「只含行内字图、无裸文本」的段落判整块——不再下钻把 `glyph-image` 抽成独立块、脱离所在段落；`findNodeById` / `indexNodeAnchors` 复用同函数，口径自动一致。
- demo 宿主侧（私有包）：书架打开旧书时自动跑 `normalizeGlyphImages`，发现可归并字图即回写书库并消息条提示（存量书一次修复永久生效）；草稿恢复同样归并（幂等，进入编辑器后自动保存落盘新基线）。
