# PDF 光栅直出优化——清晰度档位 + 并发流水线 + Worker 离线程编码

## 现状与瓶颈（调研结论）

应用内光栅直出（`exportRasterPdf`，默认链路）每页严格串行：`renderPage` 序列化 → innerHTML 解析 → **SVG foreignObject 解码渲染（最贵）** → canvas 按 scale 绘制 → `toBlob('image/jpeg')` 编码 → pdf-lib 按序嵌入，每页 `setTimeout(0)` 让出（嵌套钳制 ~4ms/页）。清晰度仅 `scale: 1 | 2` 两档（demo 恒 2 = 192dpi），JEPG 质量 0.92。矢量链路（打印对话框 / Electron）不动。

## 改动清单

### 1. 清晰度档位（`packages/exporter-pdf/src/raster-pdf.ts`）
- `scale?: 1 | 2` → `scale?: number`（clamp 1~4，非法回退 2）：1=96dpi 草稿 / 2=192dpi 标准 / 3=288dpi 高清 / 4=384dpi 印刷；clamp 逻辑抽纯函数导出便于测试。

### 2. 并发流水线 + 零延迟让出（`raster-pdf.ts` 主循环重写）
- **滑动窗口**：新 option `concurrency?: number`（缺省 3，clamp 1~6）。窗口内并发发起 `raster(renderPage(i))`（SVG 解码与序列化重叠），**按页序等待并嵌入**（PDF 页序不变）；每完成一页 `onProgress`；abort 在每轮循环顶检查，注入 mock 的现有测试语义不变。
- **零延迟让出**：`setTimeout(0)` → `MessageChannel` postMessage 宏任务（无 4ms 钳制，保留 setTimeout 回退）。

### 3. Worker 离线程 JPEG 编码（新文件 `packages/exporter-pdf/src/raster-worker.ts`）
- 能力检测（Worker / OffscreenCanvas / createImageBitmap / MessageChannel 全部可用才启用，否则整体回退现有主线程路径，Node/happy-dom 测试自动走回退）。
- 流水线：主线程完成 SVG 解码 + **按 scale 直接 drawImage**（保持矢量直绘清晰度，不做先小后大缩放）→ `createImageBitmap(canvas)` → **transfer** 给 Worker → Worker 用 `OffscreenCanvas` 铺白底 1:1 绘制 → `convertToBlob('image/jpeg', quality)` → transfer 字节回主线程。
- Worker 池（内联 Blob URL 源码，避免打包器 worker 插件依赖）：数量 = min(concurrency, hardwareConcurrency-1, 4)，轮询派发；导出结束/中止 terminate。
- 中止：窗口循环 AbortError + 池 terminate；worker 内错误回传 reject 对应 job。

### 4. demo 接线（清晰度 UI）
- `use-settings-snapshot.ts`：新增 `pdfRasterScale: 1 | 2 | 3 | 4`（缺省 2，随快照持久化）。
- `SettingsMisc.vue`：「PDF 导出方式」下方新增「光栅清晰度」四档选择（标注各档 dpi 与体积/速度代价，印刷档提示超长书内存风险），仅对应用内直出生效。
- `use-export.ts`：`scale: pdfRasterScale`；App.vue 接线；routing 测试更新。

### 5. 测试
- `print-pager.test.ts` raster 部分：注入带延迟的 mock `rasterize` 验证——嵌入顺序 = 页序、onProgress 每页一次递增、in-flight 峰值 ≤ concurrency、窗口中途 abort 正确抛出且已完成页计入进度、scale clamp 纯函数、非法 concurrency clamp。现有 mock 同步用例全部保持通过。
- demo routing 测试：scale 来自设置的断言。

### 6. 文档
- `docs/08-export-pdf.md`：光栅直出章节更新（清晰度四档与体积/速度权衡、并发流水线、Worker 编码与能力回退）。

## 验证
- `pnpm build` + `pnpm test` + `pnpm typecheck` 全量。
- demo 手动：以《杜诗详注》分别以标准/高清档导出，对比清晰度与耗时；导出中点击中止；后台标签导出不停摆。

## 交付
提交文本：`feat(exporter-pdf): 光栅直出清晰度四档 + 并发流水线 + Worker 离线程 JPEG 编码`