/**
 * 折痕姿态求解：触点/进度 → 折痕几何（纯函数）。
 *
 * 装订书模型（forward / backward 完全对称，仅抓取侧与页面序号不同）：
 * - 规范空间书脊在 x=0（装订边）、自由边在 x=W，**抓取点恒在自由边**；
 * - 两种形变模型：
 *   - **rotation（刚体旋转）**——edge 抓取 / 滑动 / 自动翻页：整页绕书脊
 *     刚体旋转 φ = π·R(p)（R 为两端减速的角度迟滞），自由边带小卷筒
 *     （起翻掀角大、飞行中为前缘小卷角、落定收拢），中段叠加飞行拱；
 *     真实书本硬页翻转的观感（页面立起、透视缩短、自由边最高点最后落桌）。
 *   - **fold（折痕卷折）**——corner 捏角拖拽（折角模型）：折痕为抓取点
 *     与触点连线的**中垂线**（斜折痕），折回部分甩出页外、落在装订侧
 *     书体上（经典卷角/折角）；装订侧角部热区（书脊上的角）不可抓，
 *     由控制器拒绝。
 * - progress 语义两模型统一：p ∈ [0,1]（0 全平、1 整页翻过），拖拽
 *   p = 行程/(2×推进终点)，落定淡出等后处理天然对称。
 */
import type { FlipAction, FlipConfig, FoldPose, GrabMode, PageSize, Point } from './types';

const EPSILON = 1e-6;

/** 数值钳制。 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 线性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 平滑阶梯（0→1 过渡），落页压平曲线共用。 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || EPSILON), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 触点约束：限制在页面矩形外扩 margin 的范围内。 */
export function clampTouch(touch: Point, size: PageSize, margin: number): Point {
  return {
    x: clamp(touch.x, -margin, size.width + margin),
    y: clamp(touch.y, -margin, size.height + margin),
  };
}

/**
 * 角部折叠的枢轴点：装订边与抓取边同端的角（规范空间书脊恒 x=0）。
 * 折痕锚定于此并随拖拽转动——折叠区永远是从书脊出发的角部三角。
 */
export function cornerPivot(grab: Point): Point {
  return { x: 0, y: grab.y };
}

/**
 * 角部折叠（折角模型）：折痕锚定书脊枢轴（装订边与抓取边同端的角）、
 * 随触点转动；转角 φ 封顶于 atan(H/W)——折痕恰与自由缘（右缘）下端
 * 相交、不切底缘：折叠区恒为「枢轴→角」一侧的角部三角（装订缘/底缘
 * 不撕裂）。触点距枢轴超出枢轴→角全长时钳制到圆上（折叠封顶 = 全折态）。
 * capPhi=false 时不封顶（完成补间自然过渡到整页翻过）。
 */
function solveCornerPose(
  grab: Point,
  touch: Point,
  size: PageSize,
  config: FlipConfig,
  capPhi = true
): FoldPose {
  const pivot = { x: 0, y: grab.y };
  const edgeLen = Math.max(Math.hypot(grab.x - pivot.x, grab.y - pivot.y), EPSILON);
  let toTouch = { x: touch.x - pivot.x, y: touch.y - pivot.y };
  const touchLen = Math.hypot(toTouch.x, toTouch.y);
  if (touchLen > edgeLen) {
    // 折叠封顶：触点钳制在枢轴圆内——全折态后不再推进
    toTouch = { x: (toTouch.x / touchLen) * edgeLen, y: (toTouch.y / touchLen) * edgeLen };
  }
  const v1 = { x: (grab.x - pivot.x) / edgeLen, y: (grab.y - pivot.y) / edgeLen };
  const v2Len = Math.max(Math.hypot(toTouch.x, toTouch.y), EPSILON);
  const v2 = { x: toTouch.x / v2Len, y: toTouch.y / v2Len };
  // 角 α = ∠(v1, v2)；折痕 = 角平分线方向、转角 φ = α/2
  const cosAlpha = clamp(v1.x * v2.x + v1.y * v2.y, -1, 1);
  const alpha = Math.acos(cosAlpha);
  const phiMax = Math.atan(size.height / size.width); // 折痕恰交于右缘下端
  const phi = capPhi ? Math.min(alpha / 2, phiMax) : alpha / 2;
  const cross = v1.x * v2.y - v1.y * v2.x;
  const spin = cross >= 0 ? 1 : -1;
  const cosT = Math.cos(spin * phi);
  const sinT = Math.sin(spin * phi);
  let dir = { x: v1.x * cosT - v1.y * sinT, y: v1.x * sinT + v1.y * cosT };
  if (dir.y < 0) {
    dir = { x: -dir.x, y: -dir.y }; // 既有约定：折痕方向 y 分量 ≥ 0
  }
  // 折叠侧法向：指向角部一侧（v1 在折痕法向上的垂分量）
  const dot = v1.x * dir.x + v1.y * dir.y;
  let wrapNormal = { x: v1.x - dir.x * dot, y: v1.y - dir.y * dot };
  const wnLen = Math.hypot(wrapNormal.x, wrapNormal.y);
  if (wnLen < EPSILON) {
    wrapNormal = { x: -dir.y, y: dir.x };
  } else {
    wrapNormal = { x: wrapNormal.x / wnLen, y: wrapNormal.y / wnLen };
  }
  // 折叠深度：角部材料到折痕的有向距离（占枢轴→角全长比）
  const sCorner = Math.abs(v1.x * wrapNormal.x + v1.y * wrapNormal.y) * edgeLen;
  const progress = clamp(sCorner / edgeLen, 0, 1);
  // 锥化：随触点竖向偏移（与既有公式一致）
  const spread = clamp(Math.abs(touch.y - grab.y) / (size.height * config.geometry.taperSpreadRatio), 0, 1);
  const taper = config.geometry.taperStrength * spread * ((grab.y / size.height - 0.5) * 2);
  // 卷曲半径随折叠深度增长
  const radius = clamp(
    config.geometry.radiusBaseRatio * size.width + config.geometry.radiusGrowRatio * sCorner,
    size.width * config.geometry.radiusMin,
    size.width * config.geometry.radiusMax
  );
  const flatten = smoothstep(config.geometry.flattenStart, 1, progress);
  const drapeBulge = config.geometry.drapeArcRatio * Math.max(edgeLen - radius * Math.PI, 0);
  return {
    creaseOrigin: pivot,
    creaseDir: dir,
    wrapNormal,
    model: 'fold',
    radius,
    taper,
    flatten,
    progress,
    strength: edgeLen,
    drapeBulge,
    flipAngle: 0,
    curlAngle: 0,
    bow: 0,
  };
}

export interface FoldSolveInput {
  /** 抓取点（pointerdown 时规范空间坐标：恒在自由边侧）。 */
  grab: Point;
  /** 当前触点（规范空间）。 */
  touch: Point;
  /** 抓取模式。 */
  mode: GrabMode;
  /** 翻页动作方向（语义记账；折叠几何由抓取点/触点决定）。 */
  action: FlipAction;
  size: PageSize;
  config: FlipConfig;
  /** 角部折痕转角封顶（拖拽=true 防撕裂；完成补间=false 自然过渡到整页翻过）。 */
  capPhi?: boolean;
}

/** 按进度求解所需的冻结会话参数（snap 补间期间轴线 / 锥化偏移保持不变）。 */
export interface FoldSession {
  grab: Point;
  /** 会话轴线单位法向（拖拽开始时由触点方向确定）。 */
  axisNormal: Point;
  mode: GrabMode;
  action: FlipAction;
  /** 抓取时刻的竖向偏移（决定角部锥化幅度；拖拽中随触点同步）。 */
  touchYOffset: number;
  /** 轴线方向上的推进终点距离（拖拽开始时确定）。 */
  distEnd: number;
  /** 角部会话：书脊枢轴（折痕锚定点）与旋转方向（触点绕枢轴的转向）。 */
  pivot?: Point;
  cornerSpin?: 1 | -1;
  size: PageSize;
  config: FlipConfig;
}

/** 由触点推算会话轴线与推进终点（拖拽开始时调用一次）。 */
export function createFoldSession(
  grab: Point,
  touch: Point,
  mode: GrabMode,
  action: FlipAction,
  size: PageSize,
  config: FlipConfig
): FoldSession {
  const axisNormal = axisNormalFor(grab, touch, mode, action);
  const session: FoldSession = {
    grab: { ...grab },
    axisNormal,
    mode,
    action,
    touchYOffset: touch.y - grab.y,
    distEnd: distEndFor(grab, axisNormal, size),
    size,
    config,
  };
  if (mode === 'corner') {
    const pivot = cornerPivot(grab);
    session.pivot = pivot;
    const v1 = { x: grab.x - pivot.x, y: grab.y - pivot.y };
    const v2 = { x: touch.x - pivot.x, y: touch.y - pivot.y };
    const cross = v1.x * v2.y - v1.y * v2.x;
    session.cornerSpin = cross >= 0 ? 1 : -1;
  }
  return session;
}

/** 卷起侧法向：从触点指向抓取点；边缘模式锁水平（折痕平行书脊）。 */
function axisNormalFor(grab: Point, touch: Point, mode: GrabMode, _action: FlipAction): Point {
  let nx = grab.x - touch.x;
  let ny = mode === 'edge' ? 0 : grab.y - touch.y;
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len < EPSILON) {
    // 触点与抓取点重合（自动翻页起点 / swipe 提交瞬间）：
    // 抓取点恒在自由边，折痕向书脊推进——默认轴向 +x
    return { x: 1, y: 0 };
  }
  const normal = { x: nx / len, y: ny / len };
  // 触点越出自由边（页缘判定余量内按下）时 grab−touch 指向页外：
  // 回退 +x 默认轴（折叠始终向书脊推进）
  if (normal.x <= 0) {
    return { x: 1, y: 0 };
  }
  return normal;
}

/** 推进终点：页面四角在 −n̂ 方向上距抓取点的最远射影。 */
function distEndFor(grab: Point, normal: Point, size: PageSize): number {
  let distEnd = 1;
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: 0, y: size.height },
    { x: size.width, y: size.height },
  ];
  for (const corner of corners) {
    const projection = -((corner.x - grab.x) * normal.x + (corner.y - grab.y) * normal.y);
    distEnd = Math.max(distEnd, projection);
  }
  return distEnd;
}

/**
 * 拖拽求解：由实时触点解算姿态（跟手）。
 * - edge：刚体旋转模型——progress = 行程/(2×推进终点)（与触点线性对应，
 *   决策阈值语义不变），φ = π·R(progress)；
 * - corner：折角模型——折痕 = 抓取点与触点连线的**中垂线**（2D 刚性折叠），
 *   自由端跟随手指。
 */
export function solveFoldPose(input: FoldSolveInput): FoldPose {
  const { grab, size, config } = input;
  if (input.mode === 'corner') {
    return solveCornerPose(grab, input.touch, size, config, input.capPhi ?? true);
  }
  const touch = input.touch;
  const normal = axisNormalFor(grab, touch, input.mode, input.action);
  const distEnd = distEndFor(grab, normal, size);
  const fingerDist = clamp(
    -((touch.x - grab.x) * normal.x + (touch.y - grab.y) * normal.y),
    0,
    distEnd * 2
  );
  const progress = clamp(fingerDist / (distEnd * 2), 0, 1);
  return buildRotationPose(grab, normal, progress, touch.y - grab.y, distEnd, size, config);
}

/**
 * 按进度求解（snap 补间 / 点击翻页）：轴线与锥化偏移冻结自会话，
 * 保证补间路径与拖拽几何连续。p=1 时整页翻出页外。edge 会话走旋转
 * 模型（φ = π·R(p)）；角部会话走折角模型（不封顶：完成补间自然过渡
 * 到整页翻过）。
 */
export function solveFoldPoseAtProgress(session: FoldSession, p: number): FoldPose {
  const pClamped = clamp(p, 0, 1);
  if (session.mode === 'corner' && session.pivot) {
    // 触点绕枢轴转动：转角 = 2×asin(progress)（角平分线 = 转角一半）
    const v1 = { x: session.grab.x - session.pivot.x, y: session.grab.y - session.pivot.y };
    const v1Len = Math.max(Math.hypot(v1.x, v1.y), EPSILON);
    const angle = 2 * Math.asin(clamp(pClamped, 0, 1)) * (session.cornerSpin ?? 1);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const touch = {
      x: session.pivot.x + (v1.x * cosA - v1.y * sinA) * v1Len,
      y: session.pivot.y + (v1.x * sinA + v1.y * cosA) * v1Len,
    };
    return solveCornerPose(session.grab, touch, session.size, session.config, false);
  }
  return buildRotationPose(
    session.grab,
    session.axisNormal,
    pClamped,
    session.touchYOffset,
    session.distEnd,
    session.size,
    session.config
  );
}

/** 翻页角迟滞：φ/π = p − k·sin(2πp)/(2π)——两端角速度 ×(1−k)、中段 ×(1+k)，
 *  起翻与落定更从容、中段扫过更干脆；R(0)=0、R(1)=1、单调递增。 */
export function flipAngleFraction(p: number, lag: number): number {
  const pc = clamp(p, 0, 1);
  return pc - (lag * Math.sin(2 * Math.PI * pc)) / (2 * Math.PI);
}

/** 旋转模型：自由边卷筒包角 χ(p)——起翻掀角（快起快收）+ 飞行前缘卷角
 *  （sin^1.2 包络，中段最大、两端归零）。 */
function curlAngleAt(p: number, config: FlipConfig): number {
  const g = config.geometry;
  const liftBump = smoothstep(0, 0.05, p) * (1 - smoothstep(0.1, 0.42, p));
  const flightCurl = Math.sin(Math.PI * p) ** 1.2;
  return g.curlLiftAngle * liftBump + g.curlFlightAngle * flightCurl;
}

/** 旋转模型：卷筒半径 r_c(p)——起翻紧（掀页卷筒）、飞行松（前缘软卷）。 */
function curlRadiusAt(p: number, pageWidth: number, config: FlipConfig): number {
  const g = config.geometry;
  return pageWidth * lerp(g.curlRadiusLift, g.curlRadiusFlight, smoothstep(0, 0.45, p));
}

/**
 * 旋转模型姿态装配（edge 抓取 / 滑动 / 自动翻页）：
 * - φ = π·R(p)：整页绕书脊（规范 x=0）刚体旋转；
 * - χ(p)/r_c(p)：自由边卷筒（deform 同式实现掀页卷角与前缘飘角）；
 * - 飞行拱：bow = flipBowRatio·W·sin^1.5(πp)——中段页面向翻越方向
 *   弓出，90° 侧立时呈曲面而非一条线；
 * - creaseOrigin 退化为书脊锚点（vS / 根部 AO 复用），strength 记账
 *   掀起材料全长（= 推进终点×p，与 fold 模型口径一致）。
 */
function buildRotationPose(
  grab: Point,
  normal: Point,
  progress: number,
  touchYOffset: number,
  distEnd: number,
  size: PageSize,
  config: FlipConfig
): FoldPose {
  const p = progress <= 0 ? 0 : clamp(progress, 0, 1);
  const phi = Math.PI * flipAngleFraction(p, config.geometry.flipAngleLag);
  return {
    creaseOrigin: { x: 0, y: grab.y + touchYOffset * config.geometry.creaseFollowRatio },
    creaseDir: { x: 0, y: 1 },
    wrapNormal: { x: normal.x, y: normal.y },
    model: 'rotation',
    radius: curlRadiusAt(p, size.width, config),
    taper: 0,
    flatten: smoothstep(config.geometry.flattenStart, 1, p),
    progress: p,
    strength: distEnd * p,
    drapeBulge: 0,
    flipAngle: phi,
    curlAngle: curlAngleAt(p, config),
    bow: size.width * config.geometry.flipBowRatio * Math.sin(Math.PI * p) ** 1.5,
  };
}
