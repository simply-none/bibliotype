---
"@bibliotype/exporter-pdf": minor
---

P4 批 6（E8）：PDF 精排管线——对页镜像、出血 / 裁切线、图片 DPI 检查与 CMYK 印前提示。

- **对页镜像**：`facing?: boolean | { gutter }`。`paged` 模式逐页打 `bt-page-recto / bt-page-verso`（第 1 页为右页），`.bt-page` padding 四边重写，`gutter` 加在内侧页边距；`auto` 模式走 `@page :right / :left`（Chromium 对页选择器不稳，生产建议 `paged`）。仿真版式书口带宽先并入物理边再叠中缝。
- **出血与裁切线**：`bleed`（mm，单边）→ `resolveBleedPx`（96dpi 四舍五入），页面与 `.bt-page` 同步 +2b、padding 四边 +b，版心尺寸不变；`cropMarks` 在 `paged` 每页插入 `.bt-crop-marks`（四角 L 形，臂长 = 出血、线宽 0.5px）；`auto` 额外下发 `marks: crop cross` 与 `bleed` 说明符（Chromium 忽略，Prince / Vivliostyle 可用）。
- **图片打印规则**：`imageRules` 输出 `max-width: 100%` + `max-height: 版心高` + `height: auto`——等比缩小、不裁切、不放大。
- **图片检查**：`readImagePixelSize` 按文件头嗅探 PNG / JPEG / GIF / BMP；`collectPdfImageProblems(document, { layout, tokens, minDpi })` 输出 `IMAGE-OVERSIZE`（超出版心，>40MP 升 warning）、`IMAGE-LOW-DPI`（有效 DPI 低于阈值，含最大成品尺寸 mm）、`IMAGE-UNMEASURED`（外链 / 非 base64 / 非四种位图）；`summarizePdfImageProblems` 出单行摘要。只提示、不阻断导出。
- **CMYK 提示**：`collectPrintColorAdvice(document, { target, hasIccProfile, rasterImageCount })` 输出 `PRINT-CMYK-UNSUPPORTED` / `PRINT-ICC-MISSING` / `PRINT-RGB-IMAGE`——浏览器打印管线只出 DeviceRGB，正式印刷需下游按 ICC 转 CMYK；`target: 'rgb'`（数字校样）返回空。
- **后端评估**：Paged.js（MIT，polyfill 约 0.8MB）与 `reader` 预分页重叠且不改善 CMYK / 裁切；Vivliostyle（AGPL-3.0，CLI 依赖 Chromium）可经 `PdfExportAdapter` 由宿主接入——两者均不内置，库零新依赖。
- **测试**：新增 `print-refinement.test.ts` 29 例（A4 对页镜像、出血尺寸换算、裁切标记注入、四类位图嗅探、超限 / 低 DPI / 无法测量、CMYK 三类提示与负例），`exporter-pdf` 合计 65 例；`docs/08` 已回写。
