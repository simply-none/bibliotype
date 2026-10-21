---
'@bibliotype/core': patch
'@bibliotype/layout': patch
'@bibliotype/reader': patch
'@bibliotype/import': patch
'@bibliotype/import-epub': patch
'@bibliotype/import-docx': patch
'@bibliotype/exporter-epub': patch
'@bibliotype/exporter-pdf': patch
'@bibliotype/exporter-site': patch
---

P4 批 1（I9）：SSR/Node 矩阵。九个关键包新增 `src/__tests__/exports.test.ts`（node 环境导入包入口，断言关键导出存在且全程无 DOM 全局依赖）；CI `verify` job 改为 Node 20/22 双版本矩阵（`fail-fast: false`）；`docs/15` 补 import / import-epub / import-docx / exporter-site 的 SSR 可用性标注与冒烟护栏说明。
