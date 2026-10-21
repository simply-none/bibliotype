---
'@bibliotype/core': patch
---

P4 批 3（I5）：性能基准。根新增 `bench/`（`run.mjs` runner + `lib.mjs` 对比纯函数 + `baseline.json` 基线 + `report.md` 报表），三组 node 纯函数基准：`paginate` 千页量级分页装箱、`exportEpub` 50 章打包、`serializeNode` 5000 节点序列化；每项预热 1 轮 + 采样 5 轮取中位数，相对基线劣化 >15% 失败（只看劣化方向），基线带 node 版本与平台；根脚本 `pnpm bench` / `pnpm bench:update`；判定口径回写 docs/18（量尺依赖浏览器布局盒，以分页装箱覆盖并注明）。
