---
"@bibliotype/exporter-pdf": minor
---

桌面宿主流式导出支持：书档内联图片去重令牌化 + 分段多文件导出（`renderPageRange`）。

- **新增 `dedupeInlineImages(document, options?)`**：写时复制遍历书档，把 `attrs.src` 的 `data:image/…` 收敛为唯一令牌 `__bibliotype_asset_N__`（同一张图只保留一份、按首现顺序；未触及子树与原档共享引用，不整树深拷贝、不改入参）——EPUB / docx 导入把缺字图逐处内联，同一张图每出现一次就带一份完整 base64，千页级书籍的书档因此膨胀到数百 MB。
- **新增 `rehydrateInlineImages(document, resolve)`**：就地把令牌 src 还原为真实 URL（宿主收到瘦身书档后调用，通常已把图片逐张落盘为相对路径）；未知令牌保持原值。
- **`PrintPager` 新增 `renderPageRange(from, to)`**：输出只含区间内页面的独立 HTML 文档（外壳与 `renderDocument` 一致，全区间逐字节等于 `renderDocument`），供桌面宿主「分段打印、逐段落盘多文件」使用；auto 模式调用抛错。
- 配套的渐离App 会话协议（begin → 逐张 asset → prepare 缓存分页器 → 工作台弹窗逐段 segment，每段独立打印落盘为 `书名_00x.pdf`，弹窗停留逐段显示状态与路径，可中止保留已完成）见该宿主 `electron/main/module/bibliotype.ts` 与其技能文档。
