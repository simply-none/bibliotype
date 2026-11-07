# 23 · 仿真翻页（Page Curl）实践 Demo

> 对应应用：`apps/pageflip-demo`（`pnpm dev:pageflip`）。
> 调研结论与方案确认记录见该轮会话；本文为能力与集成说明。

## 目标与结论

实现微信读书 / iBooks 级别的**完全仿真翻页**（内容沿曲面透视变形，不可降级），
作为后续接入阅读器的技术验证。已达成：

- WebGL 2D 卷曲映射（云展网 / StPageFlip 同源：卷曲压缩段 + 背面
  镜像平铺段，立体感由分段渐变着色表达），顶点形变全在 GPU，120fps；
- **页面任意位置滑动即可翻页**（按位移方向判定方向，位移折算为卷曲行程；
  边缘 / 角部抓取为「触点即折痕」模式，角部带圆锥锥化）；
- 卷曲时**背面镜像内容全程可见**（半径随剩余材料收紧，`r·π < 已掀长度`
  即出现平背段；样张封面带非对称印章便于辨识背面）；
- PC 鼠标与移动端触摸统一（Pointer Events），跟手拖拽、甩动完成、回弹、
  点击 / 键盘 / 滚轮翻页、边界橡皮筋；
- 直排 RTL 行款完整支持（书脊镜像到屏幕右侧，几何 X 镜像复用同一套数学）；
- 光照与阴影三件套：卷背面（镜像 + 偏暖降亮度）、接触投影（随折痕行进）、
  书脊常驻 AO，另有纸面高光与折痕根部 AO。

## 工程落点

- 新增独立应用 `apps/pageflip-demo`（`apps/*` 通配自动纳入 workspace/turbo），
  根脚本 `dev:pageflip`；
- 引擎为框架无关 TS 模块（`src/engine/`，含决策纯函数与 38 个单元测试），
  零新增依赖（原生 WebGL，GLSL ES 1.00 同时兼容 WebGL1/2 上下文）；
- 核心接缝：`FlipRenderAdapter`（渲染可注入）、`PageProvider`（内容可插拔），
  未来整体提升为 `@bibliotype/page-flip` 包的路径已在 README 中记录。

## 后续集成路径（未做，留待下一步）

1. **纹理桥**：`packages/vue` 的 `createDomPageCapture` 可直接包装为
   `PageProvider` 接真实书页；注意 foreignObject 光栅化要求 web 字体
   data-URI 内嵌（CJK 字体需子集化评估）。
2. **交互缝**：`BtBookView` 的 `pageTransition: 'curl'` 新模式 +
   `usePageFlip()` 组合式；翻页期间页面位图化，动画结束后回落真 DOM
   （保证选择 / 批注 / 搜索不受影响）。
3. 可调参数集中在 `FlipConfig`（半径曲线、锥化、投影强度、判定阈值），
   调参入口已预留。
