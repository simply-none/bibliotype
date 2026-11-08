# @bibliotype/page-flip · 仿真翻页（Page Curl）引擎

微信读书 / iBooks 级别的**完全仿真翻页**引擎：WebGL 圆柱卷曲模型 + 内容沿
曲面真实透视变形 + 实时光照与接触投影。框架无关、**零运行时依赖**，
支持 PC 鼠标与移动端触摸手势。Vue 组合式见 `@bibliotype/vue` 的
`pageflip` 子入口。

## 引入

```bash
pnpm add @bibliotype/page-flip
```

## 快速上手

```ts
import { FlipController } from '@bibliotype/page-flip';

const controller = new FlipController(canvasElement, {
  onStateChange: (page) => console.log('当前页', page),
});
controller.setViewport(stageWidth, stageHeight, window.devicePixelRatio || 1);
controller.setProvider(myPageProvider); // 实现 PageProvider：把每页画到位图
```

手势：拖拽角 / 边翻页（捏角斜折痕带书脊锚定约束、捏边平行书脊）、快甩
完成、点击边/角自动翻页、← → 键 / 滚轮；松手按「进度阈值 OR 甩动速度」
判定完成或回弹；边界橡皮筋；snap 补间可被新手势随时接管。

## 坐标与模型约定

- 「规范空间」：页面矩形 [0,W]×[0,H]，y 向下；书脊（装订边）恒在 x=0，
  自由边在 x=W；RTL 行款由渲染层 X 镜像映射，几何统一在规范空间求解；
- 折痕 = 抓取点与触点的**中垂线**；角部拖拽受**书脊锚定约束**
  （`clampCornerTouch`）：折痕与枢轴侧边缘的交点最深只到页高上部
  `creaseAnchorRatio`（默认 0.3）——折痕始终"长在书脊上角"；
- snap 补间为触点直线路径补间（终点 = 抓取点跨装订侧的镜像位），折痕
  全程连续、最终落在装订侧上（整页翻过）；
- 立体感来自几何抬升（z 经透视相机）+ 单调连续渐变；折回的纸背为单一
  暖调纸色（约 18% 正面内容透出，反字透视）。

## API 摘要

| 导出 | 说明 |
| --- | --- |
| `FlipController` | 翻页状态机：`setProvider` / `setViewport` / `autoFlip` / `debug` / `fps` |
| `GlRenderer` | WebGL 渲染适配器（默认注入；上下文丢失自动恢复） |
| `PageBitmapSource` / `TextureStore` | 页面位图源（dpr 感知）与纹理 LRU（≤5 张预算上传） |
| `solveFoldPose` / `solveFoldPoseAtProgress` / `createFoldSession` / `clampCornerTouch` | 折痕姿态纯函数（可单测 / 复用） |
| `resolveGrabZone` / `decideRelease` / `snapDurationFor` | 抓取区判定 / 松手决策 / 补间时长 |
| `deformPoint` | CPU 参照形变（与 shader 同式） |
| `DEFAULT_FLIP_CONFIG` | 默认参数（卷曲半径 / 锥化 / 锚定比 / 阈值 / 低通 τ） |

类型：`PageProvider`、`FoldPose`、`FlipSceneState`、`FlipRenderAdapter`、
`FlipConfig` 等，全部从主入口导出。

## 引入阅读器 / 编辑器（下一步）

- 纹理桥：`createDomPageCapture(reader, opts)`（`packages/vue`）可把 Reader
  任意页渲染为位图，包一层即可实现 `PageProvider` 接真实书页；
- 交互缝：`BtBookView` 的 `pageTransition` 处替换为本引擎（Vue 绑定见
  `@bibliotype/vue` 的 `pageflip` 子入口）。
