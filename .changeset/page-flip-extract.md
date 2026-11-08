---
'@bibliotype/page-flip': patch
'@bibliotype/vue': patch
---

@bibliotype/page-flip（新包）：仿真翻页（Page Curl）引擎——WebGL 圆柱卷曲 + 书脊锚定中垂线折痕 + 手势状态机（idle/drag/snap），框架无关、零运行时依赖；自 apps/pageflip-demo/src/engine 原样迁入（git mv 保留历史），公共导出面含 FlipController / GlRenderer / 折痕姿态纯函数（solveFoldPose、clampCornerTouch 等）/ 抓取与松手决策 / deformPoint / 全部类型；55 个引擎测试随包迁移并改用包内 stub-provider。

@bibliotype/vue：新增 `./pageflip` 子入口——`usePageflip(canvasRef, stageRef, { providers })` 组合式（生命周期 / 视口自适应 / 提供者切换 / FPS / 自动演示），独立轻量构建（gzip ≈ 1KB，不牵涉主图）；apps/pageflip-demo 同步改为引用包。
