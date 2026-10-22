---
"@bibliotype/vue": minor
---

P4 批 5（E7）：新增图片 / 长图导出。`exportChapterImages(reader, options)` 把分页结果按章截图并打包为 ZIP（`01-章名/001.png`，页序全书连续），支持 DPR 1~3、PNG / JPEG、质量与底色、进度回调、单页失败重试（缺省 1 次，用尽抛 `IMAGE_EXPORT_FAILED` 并保留根因）。`exportLongImage(reader, options)` 复用同一截图链路，按页竖向拼接为分享长图（页眉页脚随页截图自带，章间分隔带可绘制章名），布局由纯函数 `layoutLongImage` 计算（高度 = 各页高度之和 + 页间距 + 分隔带 + 上下留白），可在 Node / happy-dom 直接断言。单页截图用「离屏 `.bt-reader-page` + SVG `foreignObject`」栅格化（与 `BtBookView` 同一套书册样式表，零运行时依赖，字体就绪后再截）；`planChapterImages` 按目录层级分组（首章吞并封面 / 前置页，无目录退化为单章）；`createStoredZip` 为 STORE（不压缩）ZIP writer，固定时间戳使同一输入产物逐字节一致。无 DOM / Canvas 环境抛 `IMAGE_EXPORT_UNSUPPORTED`（错误码已登记 `BIBLIOTYPE_ERROR_CODES`）。测试 25 例覆盖选项钳位、像素尺寸、章节分组、ZIP 条目与确定性、进度 / 重试 / 回收、长图高度与分隔带、环境安全门；`pnpm --filter @bibliotype/vue test` 318 passed，`build` / `typecheck` / `size-limit`（163.8 KB gzip，限额 165 KB）通过。回写 `docs/06`。
