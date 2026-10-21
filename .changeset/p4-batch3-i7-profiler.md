---
'@bibliotype/core': patch
'@bibliotype/layout': patch
'@bibliotype/exporter-epub': patch
'@bibliotype/vue': patch
---

P4 批 3（I7）：可观测性。core 新增可插拔 Profiler：端口 `span(phase, labels?)`、缺省 no-op（`NOOP_PROFILER`，零行为零开销）、收集器 `createCollectingProfiler()`（按阶段 × 标签聚合 count/total/min/max/mean，`reportJson()` / `reportText()` / `reset()`）与 `PERF_PHASES` 阶段常量（与 bench 基准同口径）；`paginate` 与 `exportEpub` 接受可选 `profiler` 注入（EPUB 按 plan/xhtml/nav-opf/zip 细分 span，缺省零开销）；vue `PERF_*` 常量与开关语义不变，开启后埋点同步记入 `getVuePerfProfiler()` 模块级收集器；API 回写 docs/13 与 docs/18。
