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
完成、点击边/角自动翻页、方向键 / PageUp·Down / 滚轮；松手按「进度阈值
OR 甩动速度」判定完成或回弹；边界橡皮筋；snap 补间可被新手势随时接管。
桌面端鼠标悬停在**角部**热区时显示卷角预览（页角轻轻掀起的翻页提示）；
悬停在**左右边缘**热区时书脊向沟内**微微弯折**（不掀页——书被轻轻掰开的
预览效果）；触摸设备无 hover，不触发。

### 接入约束

- **`touch-action: none`**：画布 CSS 必须加 `touch-action: none`（并建议
  `user-select: none`），否则移动端浏览器手势（滚动/缩放）会与翻页拖拽
  冲突——引擎内部 `preventDefault` 不能替代该 CSS；
- **WebGL 不可用**：`new FlipController()` 在无 WebGL 环境会抛错，调用方
  应 try/catch 并降级（如回退到普通分页视图）；
- **尺寸管理**：视口尺寸变化时由调用方调用 `setViewport(w, h, dpr)`
  （配合 `ResizeObserver`；`@bibliotype/vue` 的 `usePageflip` 已封装）；
  引擎不读取容器尺寸，canvas 本身的 CSS 布局由调用方负责；
- **帧循环空闲停帧**：静止且干净时引擎自动停止 rAF（省电），任何输入、
  跳页、换源、视口变化都会自动唤醒。

## 四向装订（bindEdge）

`PageProvider.bindEdge` 声明装订侧（粘胶侧 = 书脊在屏幕上的位置），
缺省由 `orientation` 映射（ltr→left、rtl→right）：

| bindEdge | 视觉 | forward（下一页）手势 |
| --- | --- | --- |
| `left` | 书脊在左（西书/横排） | 拖左 / 点击右缘 / → |
| `right` | 书脊在右（直排右开） | 拖右 / 点击左缘 / ← |
| `top` | 书脊在上（挂历 / 便签） | 上拖 / 点击底缘 / ↑ |
| `bottom` | 书脊在下（台历） | 下拖 / 点击顶缘 / ↓ |

四向共享同一套折痕数学（规范空间书脊恒 x=0，上下装订经转置映射）；
内容正立显示、书口叠边 / 接触投影 / 落定淡出全部随装订侧自动朝向。

## 双页模式（spread）

`behavior.viewMode: 'spread'`（或运行时 `controller.setViewMode('spread')`）
切换左右对开视图，与单页互斥：

- 分页契约：spread s 显示面 `[2s−1, 2s]`（s=0 封面在右、左面空），
  spread 总数 = ⌊面数/2⌋+1——**偶数面数时末 spread 为左侧孤页**
  （右面为空），保证最后一面可达；`currentPage` 在双页下为 spread 索引；
- forward 折**右面**越书脊落到左面；backward 折**左面**右翻——折痕数学
  恒 forward，两侧各自在自己的规范空间求解（复用帧系统）；
- 面贴书脊侧的热区无效（已装订）；手势映射：右面拖左 / 左面拖右 /
  点击对侧缘 / ← → 键 / 滚轮；
- 非 left 装订下 spread 自动回退单页（上下装订的对开视图暂不支持）；
- **书沟（中缝立体感）**：书页几何保持平铺桌面（页块上下缘平直，无隆起
  与倾斜——贴真实平放的书）；书沟立体感完全由着色表达——窄缝谷阴影 +
  坡面光泽高光（暗-亮-暗节奏）；参数见 shading 组 `gutter*`（双页模式
  生效，单页模式书沟着色不启用）；
- `usePageflip`（@bibliotype/vue/pageflip）暴露 `viewMode` / `toggleViewMode`，
  `pageCount` 随模式切换为 spread 口径。

## 参数自定义（FlipConfig）

`new FlipController(canvas, { config })` 传**部分配置**即可（六组深合并，
只覆盖关心的叶子）：

```ts
import type { DeepPartialFlipConfig } from '@bibliotype/page-flip';

const config: DeepPartialFlipConfig = {
  timing: { autoFlipMs: 1200, snapMaxMs: 1100 },     // 翻页更从容
  shading: { shadowStrength: 0.2, backPaperWash: 0.9 }, // 投影更淡、纸背更实
  behavior: { enableSwipe: false },                   // 关闭中部滑动
};
new FlipController(canvas, { config });
```

### 参数表（默认值）

**geometry · 形态**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `radiusBaseRatio` / `radiusGrowRatio` | 0.035 / 0.05 | 卷曲半径 r = base·W + grow·dist |
| `radiusMin` / `radiusMax` | 0.035 / 0.11 | 半径上下限（相对页宽） |
| `landRadius` | 1.8 | 落定纸厚半径（px） |
| `taperStrength` / `taperSpreadRatio` | 0.45 / 0.5 | 角部锥化幅度 / 展幅 |
| `creaseFollowRatio` | 0.25 | edge 折痕随触点跟随比 |
| `flattenStart` | 0.86 | 落页压平起点（progress） |
| `dragMarginRatio` | 0.3 | 拖拽可越出页缘幅度 |
| `cornerRadiusRatio` / `edgeZoneRatio` | 0.3 / 0.25 | 角部 / 边缘热区 |
| `bounceProgress` | 0.1 | 边界橡皮筋幅度 |
| `touchBeyondAxisRatio` / `touchBeyondSpinePx` | 0.2 / 80 | 触点判定区外沿 |

**timing · 节奏**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `autoFlipMs` | 850 | 自动翻页补间时长 |
| `snapBaseMs` / `snapSlopeMs` | 380 / 540 | 释放补间 = base + slope·剩余 |
| `snapMinMs` / `snapMaxMs` | 360 / 920 | 补间上下限 |
| `bounceOutMs` / `bounceBackMs` | 460 / 420 | 橡皮筋去 / 回程 |
| `wobbleStart` / `wobbleCycles` / `wobbleAmp` | 0.6 / 2.5 / 0.05 | 落定微颤 |
| `fadeStart` | 0.85 | 落定淡出起点 |

**shading · 着色**（运行时 uniform，可动态改观感）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `backPaperTint` | (0.97, 0.945, 0.9) | 折页纸背色 |
| `backPaperWash` / `backPaperShade` | 0.82 / 0.94 | 纸背混色比（透字 = 1−wash）/ 明度 |
| `frontCurlDark` | 0.06 | 正面卷曲段渐暗 |
| `rootAoStrength` / `rootAoWidthRatio` | 0.18 / 0.22 | 折痕根部 AO |
| `shadowStrength` | 0.3 | 接触投影强度上限 |
| `shadowWidthA/B/C` | 0.16 / 0.3 / 12 | 带宽 = A·掀起量 + B·半径 + C |
| `shadowBaseSpan` / `shadowFlattenFade` | 0.75 / 0.7 | 强度起坡 / 压平消退 |
| `spineAoStrength` / `spineAoWidth` | 0.16 / 0.085 | 书脊常驻 AO |
| `gutterCreaseDepth` / `gutterCreaseWidthRatio` | 0.42 / 0.006 | 双页书沟窄缝谷阴影（深度 / 缝宽比） |
| `gutterRiseStrength` | 0.1 | 书沟坡面光泽高光幅度 |
| `gutterFlexDepthRatio` | 0.05 | 边缘悬停书脊弯折深度（相对页高，渐入渐出） |
| `stackLayers` | 5 | 书口叠边层数 |
| `stackLayerDepth` / `stackLayerCrease` | 0.06 / 0.22 | 层深 / 层缝 |
| `stackTopEdgeLight` / `stackHeadTailRatio` | 0.2 / 0.55 | 亮边 / 天头地脚带宽比 |

**interaction · 交互**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `tapMaxMs` / `tapMaxDist` | 280 / 8 | 点击判定 |
| `wheelThreshold` / `wheelCooldownMs` | 90 / 380 | 滚轮累计 / 冷却 |
| `swipeCommitDist` / `swipeCommitOrthoRatio` | 14 / 0.9 | 滑动提交阈值 / 正交比 |
| `swipeVerticalFollow` | 0.5 | 滑动纵向跟随 |
| `edgePressClampRatio` | 0.15 | edge 抓取按压钳制 |
| `completeProgress` / `flickVelocity` | 0.25 / 0.5 | 松手完成阈值 |
| `dragSmoothingTau` | 26 | 拖拽低通（ms，越小越跟手） |

**render · 渲染质量**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `meshSegmentsX/Y` | 64 / 88 | 翻动页网格分段 |
| `cameraDistFactor` | 3.2 | 透视强度（越大越弱） |
| `dprCap` | 2 | 分辨率上限 |
| `textureCacheSize` / `textureUploadsPerFrame` | 5 / 1 | 纹理缓存 / 每帧上传预算 |
| `layoutWidthRatio` / `layoutHeightRatio` | 0.94 / 0.92 | 页面排版占比 |

**behavior · 行为开关**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `enableCornerGrab` / `enableEdgeGrab` | true | 捏角 / 捏边热区 |
| `enableSwipe` / `enableWheel` / `enableKeyboard` | true | 滑动 / 滚轮 / 键盘 |

## 坐标与模型约定

- 「规范空间」：页面矩形 [0,W]×[0,H]，y 向下；书脊（装订边）恒在 x=0，
  自由边在 x=W；实际装订侧（bindEdge）由页面帧映射承接（恒等 / X 镜像 /
  转置 / 转置+镜像），几何统一在规范空间求解；
- 折叠抓取点**恒在自由边**（canonical x=W）——前翻向后翻同几何（折痕
  从自由边扫向书脊、整页越过书脊），仅语义记账不同；
- 角部拖拽为**折角模型**：折痕锚定书脊枢轴（装订边与抓取边同端的角）、
  随拖拽转动；转角 φ 封顶于 atan(H/W)——折痕恰与自由缘下端相交、
  不切底缘：折叠区恒为「枢轴→角」一侧的角部三角，装订缘/底缘不撕裂
  （完成补间不封顶，自然过渡到整页翻过）；
- snap 补间为触点直线路径补间（终点 = 抓取点跨书脊的镜像位），折痕
  全程连续、最终落在装订侧上（整页翻过）；
- 立体感来自几何抬升（z 经透视相机）+ 单调连续渐变；折回的纸背为单一
  暖调纸色（透字强度 = 1−`backPaperWash`，反字透视）。

## API 摘要

| 导出 | 说明 |
| --- | --- |
| `FlipController` | 翻页状态机：`setProvider` / `setViewport` / `autoFlip` / `goToPage` / `next` / `prev` / `setViewMode`；`isFlipping` / `viewMode` / `debug` / `fps`；选项回调 `onStateChange` / `onFlipStart` / `onFlipEnd`（`FlipEventInfo`：action / fromPage / toPage，end 含 completed） |
| `GlRenderer` | WebGL 渲染适配器（默认注入；上下文丢失自动恢复；`setRenderOptions` 收渲染质量参数） |
| `PageBitmapSource` / `TextureStore` | 页面位图源（dpr 感知）与纹理 LRU（预算式上传） |
| `solveFoldPose` / `solveFoldPoseAtProgress` / `createFoldSession` / `clampCornerTouch` | 折痕姿态纯函数（可单测 / 复用） |
| `resolveGrabZone` / `decideRelease` / `snapDurationFor` | 抓取区判定 / 松手决策 / 补间时长 |
| `resolveBindEdge` / `screenToCanonical` / `canonicalToScreen` / `canonicalSize` / `frameIndex` | 页面帧映射（四向装订） |
| `deformPoint` | CPU 参照形变（与 shader 同式） |
| `DEFAULT_FLIP_CONFIG` / `resolveFlipConfig` | 默认参数 / 部分配置深合并 |

类型：`PageProvider`（含可选 `bindEdge`）、`BindEdge`、`FoldPose`、
`FlipSceneState`、`FlipRenderAdapter`、`FlipConfig` 及六组参数接口，全部
从主入口导出。

## 引入阅读器 / 编辑器（下一步）

- 纹理桥：`createDomPageCapture(reader, opts)`（`packages/vue`）可把 Reader
  任意页渲染为位图，包一层即可实现 `PageProvider` 接真实书页；
- 交互缝：`BtBookView` 的 `pageTransition` 处替换为本引擎（Vue 绑定见
  `@bibliotype/vue` 的 `pageflip` 子入口）。
