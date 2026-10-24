---
"@bibliotype/exporter-pdf": minor
---

PDF 光栅直出：清晰度四档 + 并发流水线 + Worker 离线程 JPEG 编码，清晰度与导出速度双优化。

- **清晰度档位**：`RasterPdfOptions.scale` 从 `1 | 2` 放开为 `number`（clamp 1~4，非有限值回退 2 = 192dpi 标准）——1=96dpi 草稿 / 2=192dpi 标准 / 3=288dpi 高清 / 4=384dpi 印刷；像素量、编码耗时与文件体积按倍率平方增长。
- **并发流水线**：新增 `concurrency` 选项（clamp 1~6，缺省 3）——光栅化按滑动窗口并发，SVG 解码 / Worker 编码与下一页序列化重叠；PDF 页序恒按页码嵌入，进度与中止语义不变（中止停止填入新页、排空在途页后抛 `AbortError`，已完成页计入进度）。
- **Worker 离线程编码**（新增 `raster-worker.ts`）：主线程完成 SVG 解码与按 scale 矢量直绘（清晰度来源，不做先小后大缩放）后，`createImageBitmap` 位图 transfer 给 Worker 池（内联 Blob URL 源码，不依赖打包器 worker 插件；数量随 CPU 收敛，上限 4）做白底 + JPEG 编码，字节零拷贝回传——编码段多核并行且主线程只剩序列化与 pdf-lib 拼装。能力不全（旧浏览器 / Node / happy-dom）自动整体回退主线程 toBlob 路径；`rasterize` 注入时同样不启用 Worker 池。
- **零延迟让出**：逐页让出从 `setTimeout(0)`（嵌套 ~4ms 钳制）改为 `MessageChannel` 宏任务，千页级导出省去纯让出开销数十秒；保留 setTimeout 回退。
- demo 宿主侧（私有包）：「其他」分区新增「光栅清晰度」四档设置（`pdfRasterScale`，随界面偏好快照持久化，缺省标准 192dpi），仅对应用内直出生效。
