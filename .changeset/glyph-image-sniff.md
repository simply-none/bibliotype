---
"@bibliotype/core": patch
---

句首缺字图漏判修复——内嵌位图尺寸嗅探提供硬证据：

- 新增 `sniffEmbeddedImageSize`（`image-size.ts`）：attrs 无尺寸时直接从
  data URI 头部读真实宽高（PNG 签名 + IHDR、GIF 逻辑屏幕、SVG 根元素
  `width/height`），只解 base64 前缀不解整图，零依赖、Node 与浏览器同构；
- `normalizeGlyphImages` 识别接入嗅探：句首 / 句尾的字图（前段已收尾、无
  alt、无尺寸——docx / epub 导入主流形态）原只有「内嵌位图」单条弱信号被
  保守保留为块级插图，直排仿真下宽度非列距整数倍导致后续文字骑线；嗅探
  出近方小尺寸后凑足强信号，归并为行内 `glyph-image` 缝入后段头；
  内嵌大位图反而被嗅探尺寸正确排除为插图（原误保留）；
- JPEG / WebP 不嗅探（照片插图主流形态，失败回退保守判定），不引入误判。
