# @bibliotype/pageflip-demo · 仿真翻页（Page Curl）实践 Demo

微信读书 / iBooks 级别的**完全仿真翻页**特效实践：WebGL 圆柱卷曲模型 +
内容沿曲面真实透视变形 + 实时光照与三层阴影，支持 PC 鼠标与移动端触摸手势。

## 运行

```bash
pnpm dev:pageflip        # http://localhost:5173
pnpm --filter @bibliotype/pageflip-demo test        # 38 个几何 / 状态机测试
pnpm --filter @bibliotype/pageflip-demo typecheck
```

## 交互

| 输入 | 行为 |
| --- | --- |
| **页面任意位置**按住横向滑动 | 按位移方向判定翻页（行款自适应），位移实时折算为卷曲行程；松手按「进度 > 0.4 或甩动速度 > 0.5px/ms」判定完成或回弹 |
| 按住右缘 / 右角拖拽（LTR） | 抓取式卷曲（触点即折痕），角部带圆锥锥化 |
| 按住左缘 / 左角拖拽 | 掀回上一页（backward，几何为 forward 的镜像复用） |
| 点击边 / 角 | 自动翻页；边界处橡皮筋回弹 |
| ← → / PageUp·Down / 空格 | 键盘翻页（直排 RTL 时 ← 为下一页，与 BtBookView 行款约定一致） |
| 滚轮 | 累计阈值翻页（带冷却） |
| 快速连续手势 | snap 补间可被新手势随时接管（连续快翻不卡顿） |

Demo 内容三套样张（可切换）：横排书页（避头尾断行 + 中文页码 + 右下角
印章）、直排书页（RTL 右起、版框界行鱼尾、书口页码）、画册图片（picsum，
离线自动回退程序绘制）。封面印章为**非对称元素**——卷曲时背面镜像里
印章左右反转，用于直观辨识"这是纸的背面"。

## 引擎架构（src/engine，框架无关，可整体提升为 package）

```
types.ts           共享类型与默认参数（规范空间约定：书脊恒在 x=0）
curl-model.ts      触点/进度 → 折痕姿态（forward/backward 统一求解，纯函数）
flip-decisions.ts  抓取区判定 + 松手决策 + 补间时长（纯函数）
deform.ts          平面 → 2D 卷曲映射（CPU 参照实现，与 shader 同式）
shaders.ts         GLSL ES 1.00（2D 卷曲形变 / 分段渐变着色；兼容 WebGL1/2）
mat4.ts            最小矩阵工具
gl-renderer.ts     上下文 / 网格 / 绘制 / 上下文丢失恢复（FlipRenderAdapter）
page-provider.ts   页面位图源（离屏 canvas，dpr 感知）
texture-store.ts   页面纹理 LRU（WebGL2 NPOT mipmap / WebGL1 退化）
input.ts           Pointer Events 统一鼠标/触摸/笔 + 滚轮 + 键盘
flip-controller.ts 状态机 idle/drag/snap + 帧循环 + 纹理预取
```

### 卷曲数学（2D 卷曲映射，云展网 / StPageFlip 同源）

顶点按「到折痕有符号距离 s」分三段，**页面保持在屏幕平面内（z 恒 0），
立体感全部由分段渐变着色表达**：

1. `s ≤ 0` 桌面料：原位不动；
2. `0 < θ = s/r ≤ π` 卷曲压缩段：`pos = P + n̂·r·sin(θ)`——材料向外鼓出
   （θ=π/2 达最远 r）再折回折痕线，内容沿曲面压缩变形；
3. `s > r·π` 背面平铺段：`pos = P − n̂·(s − r·π)`——掀起材料镜像展开到
   折痕另一侧，内容呈镜像（背面三角），两段在 θ=π 处 C1 连续。

折痕 = 抓取点与触点的**中垂线**（forward，自由端跟随手指）；backward 掀回
为折痕跟手（捏折痕行进）。卷曲半径随拉距增大：
`r = clamp(0.05W + 0.18·dist, 0.035W, 0.24W)`，角部抓取沿折痕轴向锥化。

### 着色渐变（立体感来源）

- 正面卷曲段：由桌面亮渐入折痕背光（−34%）；
- 弧顶高光条：θ≈π/2 处的受光亮线（「卷」的点睛之笔）；
- 背面卷曲段：暗 → 向自由端回升；
- 背面平铺段：亮纸 + 镜像内容透出 + 自由端高光（参考图的过曝白角）；
- 折痕根部 AO + 下层页的书脊常驻 AO 与随折痕行进的接触投影。

## 性能要点

- 每帧仅更新 uniforms（顶点形变全在 GPU），静止时脏标记跳过重绘；
- 页面位图按 `min(dpr, 2)` 离屏绘制，纹理 LRU（≤5 张）预算式上传（每帧 ≤1 张）；
- 触点一阶低通（τ=26ms，与帧率无关）保证跟手且无抖动；
- 实测桌面 Chromium 120fps 满帧。

## 与阅读器集成（下一步）

- 纹理桥：`createDomPageCapture(reader, opts)`（`packages/vue/src/image-export.ts`）
  已能把 Reader 的任意页渲染为位图（竖排/仿真版式感知），可实现一个
  `PageProvider` 直接接真实书页；
- 交互缝：`BtBookView` 的 `pageTransition`/`pageTurnKey` 处替换为本引擎
  （引擎为框架无关 TS，包一层 `usePageFlip()` 组合式即可）；
- 注意：foreignObject 光栅化要求 web 字体以 data-URI 内嵌（CJK 字体体积
  大），接入前需评估字体子集化。
