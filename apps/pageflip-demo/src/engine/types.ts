/**
 * 仿真翻页引擎共享类型。
 *
 * 坐标约定：
 * - 「规范空间」(canonical space)：页面矩形 [0,W]×[0,H]，y 向下（与屏幕一致）；
 *   书脊（装订边）恒在 x=0，自由边（揭页边）在 x=W。
 * - 直排右起（RTL）时屏幕上的书脊在右侧，由渲染层做 X 镜像映射到规范空间，
 *   几何求解统一在规范空间进行。
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

/** 翻页动作方向：forward = 揭过当前页看下一页；backward = 掀回上一页。 */
export type FlipAction = 'forward' | 'backward';

/** 抓取模式：角部拖拽（折痕倾斜、圆锥感）或边缘拖拽（折痕平行书脊）。 */
export type GrabMode = 'corner' | 'edge';

/**
 * 折痕姿态——驱动顶点形变的完整参数集（规范空间）。
 *
 * - `creaseOrigin`：折痕线上的一点（沿抓取轴推进的当前折点）。
 * - `creaseDir`：折痕方向单位向量（垂直于拉扯方向，约定 y 分量 ≥ 0）。
 * - `wrapNormal`：指向「被卷起侧」的单位法向（规范空间平面内）。
 *   s = (p − creaseOrigin)·wrapNormal > 0 的顶点进入卷曲区域。
 * - `radius`：卷曲半径（卷曲带宽度基准）；沿折痕轴向按 `taper` 线性锥化。
 * - `flatten ∈ [0,1]`：落页压平系数（折叠完成端收拢卷曲带）。
 * - `progress ∈ [0,1]`：翻页进度（自由端推进比例）。
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
}

/** 形变输出：规范空间平面坐标 + 抬升高度 + 表面法线（世界系，z 朝观察者）。 */
export interface DeformedPoint {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

/** 页面位图提供者：把第 pageIndex 页绘制到位图画布上（同步）。 */
export interface PageProvider {
  /** 总页数。 */
  pageCount: number;
  /** 页面纵横比（宽/高），用于舞台排版。 */
  aspect: number;
  /** 行款：竖排右起为 rtl（影响镜像与抓取侧判定）。 */
  orientation: FlipOrientation;
  /** 就绪 promise（图片类提供者需要预解码；文本类立即 resolve）。 */
  ready: Promise<void>;
  /** 把第 pageIndex 页绘制到 ctx（画布尺寸已按 dpr 缩放）。 */
  renderPage(ctx: CanvasRenderingContext2D, pageIndex: number, width: number, height: number): void;
}

/** 供渲染层的完整场景状态（每帧由控制器产出）。 */
export interface FlipSceneState {
  /** 正在翻动的页（无翻页时为 null）。 */
  flippingPage: number | null;
  /** 压在下层的页（翻页时 = 目标页；静止时 = 当前页）。 */
  underPage: number;
  /** 折痕姿态；无翻页时为 null。 */
  pose: FoldPose | null;
  /**
   * 翻动页落定淡出系数 [0,1]：背面平铺段（镜像落定态）在
   * forward 尾段 / backward 起段的消隐比例，其余段恒 0。
   */
  flipFade: number;
  /** 每页纸厚（px，= 2×landRadius）——书口页叠边纹理的层距依据。 */
  paperT: number;
  /** 调试视图（法线 / 网格着色）。 */
  debug: boolean;
}

/** 渲染适配器：控制器与 GL 渲染器之间的接缝（测试可注入桩实现）。 */
export interface FlipRenderAdapter {
  gl: WebGLRenderingContext;
  isWebGL2: boolean;
  updateLayout(size: PageSize, orientation: FlipOrientation): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(state: FlipSceneState, underTex: WebGLTexture | null, flipTex: WebGLTexture | null): void;
  dispose(): void;
}

/** 翻页引擎可调参数。 */
export interface FlipConfig {
  /** 最紧卷曲半径（相对页宽）。 */
  radiusMin: number;
  /** 最松卷曲半径（相对页宽，起止端的“平”态）。 */
  radiusMax: number;
  /** 落页时纸张残余厚度半径（像素）——每页纸厚，折缝高度 = 2×此值。 */
  landRadius: number;
  /** 折痕轴向锥化幅度上限（圆锥感，0 关闭）。 */
  taperStrength: number;
  /** 平背延伸段下垂幅度（相对抬升高度）。 */
  /** 松手后继续翻页的进度阈值。 */
  completeProgress: number;
  /** 松手后继续翻页的速度阈值（像素/毫秒）。 */
  flickVelocity: number;
  /** 拖拽跟随低通时间常数（毫秒），越小越跟手。 */
  dragSmoothingTau: number;
}

export const DEFAULT_FLIP_CONFIG: FlipConfig = {
  radiusMin: 0.035,
  radiusMax: 0.11,
  landRadius: 1.8,
  taperStrength: 0.45,
  completeProgress: 0.25,
  flickVelocity: 0.5,
  dragSmoothingTau: 26,
};
