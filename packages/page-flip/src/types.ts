/**
 * 仿真翻页引擎共享类型。
 *
 * 坐标约定：
 * - 「规范空间」(canonical space)：页面矩形 [0,W]×[0,H]，y 向下（与屏幕一致）；
 *   书脊（装订边）恒在 x=0，自由边（揭页边）在 x=W——**无论实际装订侧**。
 * - 实际装订侧由 `BindEdge` 声明，屏幕 ↔ 规范之间经 page-frame 映射
 *   （恒等 / X 镜像 / 转置 / 转置+镜像），几何求解统一在规范空间进行。
 */

/** 二维点（页面像素坐标，y 向下）。 */
export interface Point {
  x: number;
  y: number;
}

/** 页面尺寸（CSS 像素）。 */
export interface PageSize {
  width: number;
  height: number;
}

/** 翻页方向（相对屏幕的行款）。 */
export type FlipOrientation = 'ltr' | 'rtl';

/**
 * 装订侧（粘胶侧 = 书脊在屏幕上的位置）。
 * - left：西文书 / 横排左开（现状 LTR）；
 * - right：直排右开（现状 RTL）；
 * - top：上侧装订（挂历 / 便签，页底边向上翻）；
 * - bottom：下侧装订（台历，页顶边向下翻）。
 */
export type BindEdge = 'left' | 'right' | 'top' | 'bottom';

/** 翻页动作方向：forward = 当前页自自由边掀起翻向书脊侧，揭示下一页；
 *  backward = 当前页自书脊侧掀起翻向自由边侧，揭示上一页（与 forward 镜像对称）。 */
export type FlipAction = 'forward' | 'backward';

/** 抓取模式：角部拖拽（斜折痕，真实捏角翻页）或边缘拖拽（折痕平行书脊）。 */
export type GrabMode = 'corner' | 'edge';

/**
 * 折痕姿态——驱动顶点形变的完整参数集（规范空间）。
 *
 * - `creaseOrigin`：折痕线上的一点（沿抓取轴推进的当前折点）。
 * - `creaseDir`：折痕方向单位向量（装订书模型恒平行书脊：(0,1)）。
 * - `wrapNormal`：指向「被卷起侧」的单位法向（规范空间平面内，恒水平）。
 *   s = (p − creaseOrigin)·wrapNormal > 0 的顶点进入卷曲区域。
 * - `radius`：卷曲半径（卷曲带宽度基准）。
 * - `taper`：保留字段，装订书折痕恒竖直、无锥化，恒 0。
 * - `flatten ∈ [0,1]`：落页压平系数（折叠完成端收拢卷曲带）。
 * - `progress ∈ [0,1]`：翻页进度（折叠完成比例）。
 * - `strength`：掀起材料全长（像素）——背面平铺段宽度与投影范围的依据。
 */
export interface FoldPose {
  creaseOrigin: Point;
  creaseDir: Point;
  wrapNormal: Point;
  radius: number;
  taper: number;
  flatten: number;
  progress: number;
  strength: number;
  /** 背面斜披段弧拱高度（px）——下落段上拱（真实纸张前冲弧线）。 */
  drapeBulge: number;
}

/** 页面位图提供者：把第 pageIndex 页绘制到位图画布上（同步）。 */
export interface PageProvider {
  /** 总页数。 */
  pageCount: number;
  /** 页面纵横比（宽/高，屏幕向），用于舞台排版。 */
  aspect: number;
  /** 行款：竖排右起为 rtl（影响镜像与抓取侧判定）。 */
  orientation: FlipOrientation;
  /**
   * 装订侧（可选）：缺省由 orientation 映射（ltr→left、rtl→right）。
   * 上 / 下侧装订（挂历、台历）需显式声明，且 aspect 应为屏幕向（横页）。
   */
  bindEdge?: BindEdge;
  /** 就绪 promise（图片类提供者需要预解码；文本类立即 resolve）。 */
  ready: Promise<void>;
  /** 把第 pageIndex 页绘制到 ctx（画布尺寸已按 dpr 缩放）。 */
  renderPage(ctx: CanvasRenderingContext2D, pageIndex: number, width: number, height: number): void;
}

/** 视图模式：单页（居中一页）或双页（左右对开、书脊居中）。 */
export type ViewMode = 'single' | 'spread';

/** 双页场景：两侧面索引 + 翻动侧（null = 无翻动）。 */
export interface SpreadSceneState {
  /** 左侧面（spread s = 面 2s−1；封面 spread s=0 时为 null——不绘制）。 */
  leftPage: number | null;
  /** 右侧面（spread s = 面 2s）。 */
  rightPage: number | null;
  /** 翻动面及其所在侧（left 侧翻动 = 语义 backward）。 */
  flipping: { page: number; side: 'left' | 'right' } | null;
  /**
   * 翻动侧的「当前面」（翻页前的旧面）——作为淡出层压在目标面之上，
   * 随落定淡出消隐：点击/翻起瞬间被翻侧内容不突变，动画结束才切到目标面。
   */
  fadingFace: { page: number; side: 'left' | 'right' } | null;
}

/** 供渲染层的完整场景状态（每帧由控制器产出）。 */
export interface FlipSceneState {
  /** 正在翻动的页（无翻页时为 null；双页模式下为翻动面索引，见 spread）。 */
  flippingPage: number | null;
  /** 压在下层的页（单页：翻页时 = 目标页；静止时 = 当前页；双页 = 右侧面）。 */
  underPage: number;
  /** 双页模式场景（单页模式恒 null）。 */
  spread: SpreadSceneState | null;
  /** 折痕姿态；无翻页时为 null。 */
  pose: FoldPose | null;
  /**
   * 翻动页落定淡出系数 [0,1]：背面平铺段（镜像落定态）在
   * forward 尾段 / backward 起段的消隐比例，其余段恒 0。
   */
  flipFade: number;
  /** 每页纸厚（px，= 2×landRadius）——书口页叠边纹理的层距依据。 */
  paperT: number;
  /** 着色参数（shading 组透传，渲染器每帧上 uniform）。 */
  shading: ShadingOptions;
  /** 调试视图（法线 / 网格着色）。 */
  debug: boolean;
}

/** 渲染适配器：控制器与 GL 渲染器之间的接缝（测试可注入桩实现）。 */
export interface FlipRenderAdapter {
  gl: WebGLRenderingContext;
  isWebGL2: boolean;
  /** size = 规范空间页面尺寸（随装订侧可能与屏幕互为转置）。 */
  updateLayout(size: PageSize, bindEdge: BindEdge): void;
  /** 渲染质量参数（网格分段 / 相机距离系数）；可选——桩适配器可忽略。 */
  setRenderOptions?(render: RenderOptions): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(state: FlipSceneState, resolveTexture: (pageIndex: number) => WebGLTexture | null): void;
  dispose(): void;
}

/** 翻页引擎可调参数（六组，深合并——只需覆盖关心的叶子）。 */
export interface GeometryOptions {
  /** 卷曲半径基准：r = radiusBaseRatio·W + radiusGrowRatio·dist。 */
  radiusBaseRatio: number;
  /** 卷曲半径随掀起量的增长系数。 */
  radiusGrowRatio: number;
  /** 最紧卷曲半径（相对页宽）。 */
  radiusMin: number;
  /** 最松卷曲半径（相对页宽，起止端的“平”态）。 */
  radiusMax: number;
  /** 落页时纸张残余厚度半径（像素）——每页纸厚，折缝高度 = 2×此值。 */
  landRadius: number;
  /** 折痕轴向锥化幅度上限（角部抓取的圆锥感，0 关闭）。 */
  taperStrength: number;
  /** 锥化随触点纵向偏移的展幅（相对页高）。 */
  taperSpreadRatio: number;
  /**
   * 飞行抬升半径（相对页宽）：翻页中段纸张立起（弧顶 ≈ 2×此值×页宽），
   * 按 sin²(π·p) 弧起落——起止端回落到自然卷曲半径，落页压平不受影响。
   */
  flightRadiusRatio: number;
  /**
   * 背面斜披段的弧拱比：材料过弧顶后的下落段带向上拱起（真实纸张
   * 前冲弧线），拱高 = 此值 × 斜披段材料长。
   */
  drapeArcRatio: number;
  /**
   * 角部折痕的书脊锚定上限（相对页高）：折痕与枢轴侧边缘（书脊/自由缘）
   * 的交点最深只到页高上部此比例处，防止折痕横在页中（撕纸观感）。
   */
  creaseAnchorRatio: number;
  /** edge 模式折痕中点随触点的纵向跟随比。 */
  creaseFollowRatio: number;
  /** 落页压平起点（progress，0.86 = 尾段 14% 收拢卷筒）。 */
  flattenStart: number;
  /** 拖拽触点可越出页缘的幅度（相对页宽）。 */
  dragMarginRatio: number;
  /** 角部热区半径（相对 min(W,H)）。 */
  cornerRadiusRatio: number;
  /** 边缘热区带宽（相对页宽）。 */
  edgeZoneRatio: number;
  /** 边界橡皮筋回弹幅度（progress 上限）。 */
  bounceProgress: number;
  /** 触点判定区沿装订轴可越出页缘的比例（onDown 热区外沿）。 */
  touchBeyondAxisRatio: number;
  /** 触点判定区沿书脊轴越出页缘的像素余量。 */
  touchBeyondSpinePx: number;
}

export interface TimingOptions {
  /** 自动翻页（点击/键盘/滚轮）补间时长（毫秒）。 */
  autoFlipMs: number;
  /** 释放补间时长 = snapBaseMs + snapSlopeMs·剩余进度。 */
  snapBaseMs: number;
  /** 释放补间随剩余进度的斜率（毫秒）。 */
  snapSlopeMs: number;
  /** 释放补间下限（毫秒，快甩尾段仍干脆）。 */
  snapMinMs: number;
  /** 释放补间上限（毫秒）。 */
  snapMaxMs: number;
  /** 边界橡皮筋去程时长（毫秒）。 */
  bounceOutMs: number;
  /** 边界橡皮筋回程时长（毫秒）。 */
  bounceBackMs: number;
  /** 落定微颤起点（补间进度 t）。 */
  wobbleStart: number;
  /** 落定微颤周期数。 */
  wobbleCycles: number;
  /** 落定微颤幅度（卷曲半径扰动比）。 */
  wobbleAmp: number;
  /** 落定淡出起点（progress，背面平铺段开始消隐）。 */
  fadeStart: number;
}

export interface ShadingOptions {
  /** 折页纸背色（RGB 0..1，暖调纸色）。 */
  backPaperTint: [number, number, number];
  /** 折页纸背混色比（1−wash = 正面内容透出/反字强度）。 */
  backPaperWash: number;
  /** 折页均一明度（略暗于下层页）。 */
  backPaperShade: number;
  /** 正面卷曲段渐暗幅度。 */
  frontCurlDark: number;
  /** 折痕根部 AO 强度。 */
  rootAoStrength: number;
  /** 折痕根部 AO 宽度比（相对卷曲半径）。 */
  rootAoWidthRatio: number;
  /** 接触投影强度上限。 */
  shadowStrength: number;
  /** 接触投影带宽 = shadowWidthA·掀起量 + shadowWidthB·半径 + shadowWidthC。 */
  shadowWidthA: number;
  shadowWidthB: number;
  shadowWidthC: number;
  /** 投影强度起坡（掀起量相对页宽的比例）。 */
  shadowBaseSpan: number;
  /** 投影随落页压平的消退比。 */
  shadowFlattenFade: number;
  /** 书脊常驻 AO 强度。 */
  spineAoStrength: number;
  /** 书脊常驻 AO 宽度（相对页宽 UV）。 */
  spineAoWidth: number;
  /** 双页书沟：窄缝谷阴影深度（0 关闭书沟着色）。 */
  gutterCreaseDepth: number;
  /** 双页书沟：窄缝特征宽度（相对页宽）。 */
  gutterCreaseWidthRatio: number;
  /** 双页书沟：坡面光泽高光幅度（缝影外侧窄带）。 */
  gutterRiseStrength: number;
  /** 书口页叠边层数。 */
  stackLayers: number;
  /** 叠边层深（每层明度递减）。 */
  stackLayerDepth: number;
  /** 叠边层缝对比。 */
  stackLayerCrease: number;
  /** 顶层页缘受光亮边强度。 */
  stackTopEdgeLight: number;
  /** 天头地脚带宽比（相对书口带宽）。 */
  stackHeadTailRatio: number;
  /** 飞行中投影衰减比：纸页高举时接触投影变淡（× (1−sin²(πp)·此值)）。 */
  shadowFlightFade: number;
}

export interface InteractionOptions {
  /** 点击判定时长上限（毫秒）。 */
  tapMaxMs: number;
  /** 点击判定位移上限（像素）。 */
  tapMaxDist: number;
  /** 滚轮累计触发阈值（归一化 delta）。 */
  wheelThreshold: number;
  /** 滚轮触发冷却（毫秒）。 */
  wheelCooldownMs: number;
  /** 中部滑动提交阈值（规范 px）。 */
  swipeCommitDist: number;
  /** 滑动提交正交比（|主轴| ≥ ortho·|横轴|）。 */
  swipeCommitOrthoRatio: number;
  /** swipe 行进中沿书脊轴的跟随比。 */
  swipeVerticalFollow: number;
  /** edge 抓取沿书脊轴的按压钳制（0.15 = 钳在 0.15H..0.85H）。 */
  edgePressClampRatio: number;
  /** 松手后继续翻页的进度阈值。 */
  completeProgress: number;
  /** 松手后继续翻页的速度阈值（像素/毫秒）。 */
  flickVelocity: number;
  /** 拖拽跟随低通时间常数（毫秒），越小越跟手。 */
  dragSmoothingTau: number;
}

export interface RenderOptions {
  /** 翻动页网格分段（X 方向，沿装订轴）。 */
  meshSegmentsX: number;
  /** 翻动页网格分段（Y 方向，沿书脊轴）。 */
  meshSegmentsY: number;
  /** 透视相机距离系数（越大透视越弱）。 */
  cameraDistFactor: number;
  /** 渲染分辨率 dpr 上限。 */
  dprCap: number;
  /** 纹理缓存上限（张）。 */
  textureCacheSize: number;
  /** 每帧纹理上传预算（张）。 */
  textureUploadsPerFrame: number;
  /** 页面排版宽度占舞台比例。 */
  layoutWidthRatio: number;
  /** 页面排版高度占舞台比例。 */
  layoutHeightRatio: number;
}

export interface BehaviorOptions {
  /** 启用捏角斜翻热区。 */
  enableCornerGrab: boolean;
  /** 启用捏边翻页热区。 */
  enableEdgeGrab: boolean;
  /** 启用中部滑动手势。 */
  enableSwipe: boolean;
  /** 启用滚轮翻页。 */
  enableWheel: boolean;
  /** 启用键盘翻页。 */
  enableKeyboard: boolean;
  /** 视图模式：单页（默认）或双页对开（仅 left 装订生效，其余装订侧自动回退单页）。 */
  viewMode: ViewMode;
}

/** 翻页引擎可调参数（六组）。 */
export interface FlipConfig {
  geometry: GeometryOptions;
  timing: TimingOptions;
  shading: ShadingOptions;
  interaction: InteractionOptions;
  render: RenderOptions;
  behavior: BehaviorOptions;
}

/** 部分配置：各组均可只覆盖关心的叶子。 */
export type DeepPartialFlipConfig = {
  [K in keyof FlipConfig]?: Partial<FlipConfig[K]>;
};

export const DEFAULT_FLIP_CONFIG: FlipConfig = {
  geometry: {
    radiusBaseRatio: 0.035,
    radiusGrowRatio: 0.05,
    radiusMin: 0.035,
    radiusMax: 0.11,
    landRadius: 1.8,
    taperStrength: 0.45,
    taperSpreadRatio: 0.5,
    flightRadiusRatio: 0.13,
    drapeArcRatio: 0.15,
    creaseAnchorRatio: 0.3,
    creaseFollowRatio: 0.25,
    flattenStart: 0.86,
    dragMarginRatio: 0.3,
    cornerRadiusRatio: 0.3,
    edgeZoneRatio: 0.25,
    bounceProgress: 0.1,
    touchBeyondAxisRatio: 0.2,
    touchBeyondSpinePx: 80,
  },
  timing: {
    autoFlipMs: 850,
    snapBaseMs: 380,
    snapSlopeMs: 540,
    snapMinMs: 360,
    snapMaxMs: 920,
    bounceOutMs: 460,
    bounceBackMs: 420,
    wobbleStart: 0.6,
    wobbleCycles: 2.5,
    wobbleAmp: 0.05,
    fadeStart: 0.85,
  },
  shading: {
    backPaperTint: [0.97, 0.945, 0.9],
    backPaperWash: 0.82,
    backPaperShade: 0.94,
    frontCurlDark: 0.06,
    rootAoStrength: 0.18,
    rootAoWidthRatio: 0.22,
    shadowStrength: 0.3,
    shadowWidthA: 0.16,
    shadowWidthB: 0.3,
    shadowWidthC: 12,
    shadowBaseSpan: 0.75,
    shadowFlattenFade: 0.7,
    spineAoStrength: 0.16,
    spineAoWidth: 0.085,
    gutterCreaseDepth: 0.42,
    gutterCreaseWidthRatio: 0.006,
    gutterRiseStrength: 0.1,
    stackLayers: 5,
    stackLayerDepth: 0.06,
    stackLayerCrease: 0.22,
    stackTopEdgeLight: 0.2,
    stackHeadTailRatio: 0.55,
    shadowFlightFade: 0.45,
  },
  interaction: {
    tapMaxMs: 280,
    tapMaxDist: 8,
    wheelThreshold: 90,
    wheelCooldownMs: 380,
    swipeCommitDist: 14,
    swipeCommitOrthoRatio: 0.9,
    swipeVerticalFollow: 0.5,
    edgePressClampRatio: 0.15,
    completeProgress: 0.25,
    flickVelocity: 0.5,
    dragSmoothingTau: 26,
  },
  render: {
    meshSegmentsX: 64,
    meshSegmentsY: 88,
    cameraDistFactor: 3.2,
    dprCap: 2,
    textureCacheSize: 8,
    textureUploadsPerFrame: 1,
    layoutWidthRatio: 0.94,
    layoutHeightRatio: 0.92,
  },
  behavior: {
    enableCornerGrab: true,
    enableEdgeGrab: true,
    enableSwipe: true,
    enableWheel: true,
    enableKeyboard: true,
    viewMode: 'single',
  },
};

/** 深合并部分配置到默认配置（浅层组内合并，不做递归数组合并）。 */
export function resolveFlipConfig(partial?: DeepPartialFlipConfig): FlipConfig {
  const d = DEFAULT_FLIP_CONFIG;
  const p = partial ?? {};
  return {
    geometry: { ...d.geometry, ...p.geometry },
    timing: { ...d.timing, ...p.timing },
    shading: { ...d.shading, ...p.shading },
    interaction: { ...d.interaction, ...p.interaction },
    render: { ...d.render, ...p.render },
    behavior: { ...d.behavior, ...p.behavior },
  };
}
