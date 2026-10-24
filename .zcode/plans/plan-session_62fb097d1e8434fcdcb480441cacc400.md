# 句首缺字图漏判 + 后续文字骑线修复

## 根因（逐行分析 `packages/core/src/glyph-image.ts`）

**漏判**：`keepReasonOf`（L132-183）的评分制下，句首缺字图（前段以句号**收尾**、无 alt、无尺寸元数据——docx/EPUB 导入的主流形态）：
- 强信号 0 条（无 alt 单字、无尺寸对，L155/L156）；
- 弱信号仅「内嵌位图 data URI」1 条（L173，需 ≥2）；位置信号（L176）要求**前段未收尾**（句中切断），句首场景前段已收尾 → 不计分；
- → `weak=1 < 2` 保守保留块级（L182）。既有测试 L115/L152 明文锁定此现状。commit 2d827a5 只覆盖了「句中切断」，句首/句尾没覆盖。

**骑线**：保留的块级 `image` 宽度任意（非列距整数倍），古籍仿真的静态界行网格随之错相，**后续所有文字**压线——与截图一致。

## 修复：内嵌位图真实尺寸嗅探（句首场景的硬证据）

尺寸是区分「一字位小图 vs 插图」最硬的证据，缺的只是数据——data URI 头部即可读出，无需解码整图：

1. **core 新增 `src/image-size.ts`**：`sniffEmbeddedImageSize(dataUri)` 纯函数
   - PNG：签名 + IHDR，宽高大端（偏移 16/20），只需 base64 前 32 字符；
   - GIF：逻辑屏幕宽高小端（偏移 6/8），前 16 字符；
   - SVG：base64 解码前 1KB，根元素 `width/height` 属性（必在 `<svg …>` 开标签内）；
   - JPEG/WebP **不嗅探**（照片插图主流形态、字图罕见；JPEG 需扫 SOF 段），返回 `undefined` 回退现状——绝不因嗅探引入误判；
   - 零依赖、Node/浏览器同构（`atob` 两端全局）、只解前缀（大图零成本）。
2. **`glyph-image.ts` 接入**（`keepReasonOf` 内 3 行）：attrs 无尺寸且 `isEmbeddedBitmap(src)` 时以嗅探值补 `measured`——
   - 句首近方小图（≤64px、宽高比 0.6~1.6）→ 凑足**强信号** → 识别，`auto` 归并语义下前段收尾 → 缝后段头（`next-start`，既有分支已支持）→ 行内 1em 落格，骑线消失；
   - 内嵌大位图 → 嗅探尺寸超阈值 → 反而被**正确排除**为插图（现状误保留为「单弱信号」）；
   - 嗅探失败（非真实头）→ 回退现状。既有 L115/L152 用例的 data URI 无真实图片头，行为不变、断言零翻改。
3. **测试**（`glyph-image.test.ts` 新增）：句首真实 PNG 头 24×24（无 alt 无尺寸）→ merged `next-start`；内嵌 PNG 600×400 → 排除为插图；base64 SVG `width="24" height="24"` 句首 → 识别；内嵌 PNG 60×20（非方）→ 保守保留；嗅探失败用例即现有两条保持绿。
4. **文档与 changeset**：`docs/05` 字图内联一节补「内嵌位图尺寸嗅探（句首/句尾的硬证据）」说明；changeset `@bibliotype/core` patch。

不动识别阈值与其余信号语义；仿真网格层不需要改（行内 1em 字图 < 列距，天然落格——已在前轮探针验证）。

## 验证

`pnpm --filter @bibliotype/core test` + 全量 `pnpm build && pnpm test && pnpm typecheck`；demo 目验由您执行（重新导入带句首缺字图的书，或对存量书重跑导入归一化）。