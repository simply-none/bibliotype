---
'@bibliotype/core': patch
---

P4 批 4（I1 / B3）：端到端冒烟与直排像素回归。新增独立工作区 `e2e/`（`@bibliotype/e2e`，private，不进发布产物；脚本名 `e2e*` 避免被 `turbo run test` 抓取），Playwright 消费 demo 的 `vite preview` 产物：`@smoke` 覆盖 Markdown 导入 → 翻页 → 编辑落字 → 导出 EPUB（`fflate` 解包校验 mimetype / OPF / 章节含落字）、TXT 导入 → 古籍直排切换、宿主 `electronPdf` 桥 → 导出 PDF 字节；`@pixel` 覆盖三组固定直排 fixture（古籍单栏 / 仿真版框 / 竖排左起），结构基线用 Range 逐字测行盒锁列数 / 每栏行数 / 逐行断行，几何基线以「文字透明」截图锁页框与界行（`maxDiffPixelRatio: 0.02`），跨平台可比。CI 新增 `e2e` job 并归档失败产物；口径与多栏直排取舍回写 `docs/16`、`docs/18`。无发布包运行时 API 变更。
