/**
 * 折痕姿态求解：触点/进度 → 折痕几何（纯函数）。
 *
 * 装订书模型（forward / backward 完全对称，仅抓取侧与页面序号不同）：
 * - 规范空间书脊在 x=0（装订边，左侧胶/线装订）、自由边在 x=W；
 * - 抓取模式：
 *   - edge：捏边翻页，折痕平行书脊（竖直），折回部分贴书翻过；
 *   - corner：捏角翻页（真实"捏着上面翻"），折痕为抓取点与触点连线的
 *     中垂线（斜折痕），折回部分甩出页外、落在装订侧书体上；
 * - forward：折痕自自由边扫向书脊，下层揭示下一页；
 *   backward：折痕自书脊扫向自由边，下层揭示上一页——镜像对称；
 * - 卷曲半径随进度增长，折平端以 landRadius 压成纸厚；
 * - 两方向共用同一进度语义：p ∈ [0,1] = 折叠完成度（0 全平、1 全部
 *   翻出页外），落定淡出等后处理因此天然对称；
 * - 角部模式受「书脊锚定约束」（clampCornerTouch）：折痕与枢轴侧边缘
 *   的交点最深只到页高上部 creaseAnchorRatio 区域——折痕始终"长在
 *   书脊上角"，不会横在页中（书页被撕下的观感）。
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
 * 角部翻页的书脊锚定约束（装订书物理，纯函数）。
 *
 * 抓取角所在端的「枢轴角」：forward 抓自由边角 → 枢轴 = 同端书脊角；
 * backward 抓书脊角 → 枢轴 = 同端自由边角。中垂线折痕与枢轴侧边缘
 * （书脊/自由缘）的交点记 crossY（自枢轴端量起）：
 * - crossY ≤ 0：折痕经页顶边入页（捏角的小三角折，自然起翻态）——放行；
 * - crossY ≥ H：折痕已越出页内（整页翻起的完成态）——放行；
 * - 0 < crossY ≤ anchor（页高上部比例）：折痕锚定在枢轴角附近——放行；
 * - crossY > anchor：折痕锚点滑到页中下部（"书页被撕下"的观感）——
 *   把触点径向投影回「锚定圆」（圆心 = 枢轴角向页内 anchor 处，
 *   半径 √(W²+anchor²)，圆上恒有 crossY = anchor），折痕最深钉在
 *   枢轴角附近——"翻页最多在左上角"。
 */
export function clampCornerTouch(
  touch: Point,
  grab: Point,
  action: FlipAction,
  size: PageSize,
  anchorRatio: number
): Point {
  const { width: w, height: h } = size;
  const pivotX = action === 'forward' ? 0 : w;
  const topEnd = grab.y < h / 2;
  const pivotY = topEnd ? 0 : h;
  const dir = topEnd ? 1 : -1;                // 自枢轴端指向页内的方向
  const dx = touch.x - pivotX;
  const u = (touch.y - pivotY) * dir;         // 自枢轴端向页内的有向距离
  if (u <= 0) {
    return touch;                             // 掀角上扬（触点在枢轴端外侧）
  }
  const d2 = dx * dx + u * u;
  const crossY = (d2 - w * w) / (2 * u);
  const anchor = clamp(anchorRatio, 0.05, 0.5) * h;
  if (crossY <= anchor || crossY >= h) {
    return touch;
  }
  const cx = pivotX;
  const cy = pivotY + dir * anchor;
  const ex = touch.x - cx;
  const ey = touch.y - cy;
  const len = Math.hypot(ex, ey);
  if (len < EPSILON) {
    return touch;
  }
  const r = Math.sqrt(w * w + anchor * anchor);
  return { x: cx + (ex / len) * r, y: cy + (ey / len) * r };
}

export interface FoldSolveInput {
  /** 抓取点（pointerdown 时规范空间坐标：forward 在自由边侧，backward 在书脊侧）。 */
  grab: Point;
  /** 当前触点（规范空间）。 */
  touch: Point;
  /** 抓取模式。 */
  mode: GrabMode;
  /** 翻页动作方向。 */
  action: FlipAction;
  size: PageSize;
  config: FlipConfig;
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
  return {
    grab: { ...grab },
    axisNormal,
    mode,
    action,
    touchYOffset: touch.y - grab.y,
    distEnd: distEndFor(grab, axisNormal, size),
    size,
    config,
  };
}

/** 卷起侧法向：从触点指向抓取点；边缘模式锁水平（折痕平行书脊）。 */
function axisNormalFor(grab: Point, touch: Point, mode: GrabMode, action: FlipAction): Point {
  let nx = grab.x - touch.x;
  let ny = mode === 'edge' ? 0 : grab.y - touch.y;
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len < EPSILON) {
    // 触点与抓取点重合（自动翻页起点 / swipe 提交瞬间）：
    // 按动作方向给默认轴向——forward 抓自由边（+x），backward 抓书脊（-x）
    return action === 'forward' ? { x: 1, y: 0 } : { x: -1, y: 0 };
  }
  return { x: nx / len, y: ny / len };
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
 * 拖拽求解：由实时触点解算姿态（折痕方向 / 锥化随触点实时变化，跟手）。
 * forward / backward 共用同一套数学（仅抓取侧不同）：
 * 折痕 = 抓取点与触点连线的**中垂线**（2D 刚性折叠），自由端跟随手指；
 * 折痕推进 = 手指行程的一半，progress = 手指行程 / 2·distEnd。
 * 角部模式先经书脊锚定约束（clampCornerTouch）收敛触点，
 * 折痕不会锚到页中（撕纸观感）。
 */
export function solveFoldPose(input: FoldSolveInput): FoldPose {
  const { grab, mode, size, config } = input;
  const touch =
    mode === 'corner'
      ? clampCornerTouch(input.touch, grab, input.action, size, config.geometry.creaseAnchorRatio)
      : input.touch;
  const normal = axisNormalFor(grab, touch, mode, input.action);
  const distEnd = distEndFor(grab, normal, size);
  const fingerDist = clamp(
    -((touch.x - grab.x) * normal.x + (touch.y - grab.y) * normal.y),
    0,
    distEnd * 2
  );
  const progress = clamp(fingerDist / (distEnd * 2), 0, 1);
  return buildPose(grab, normal, mode, fingerDist / 2, progress, touch.y - grab.y, distEnd, size, config);
}

/**
 * 按进度求解（snap 补间 / 点击翻页）：轴线与锥化偏移冻结自会话，
 * 保证补间路径与拖拽几何连续。dist = distEnd·p——p=1 时折痕到达推进
 * 终点，整页翻出页外（forward 越书脊、backward 越自由边）。
 */
export function solveFoldPoseAtProgress(session: FoldSession, p: number): FoldPose {
  const pClamped = clamp(p, 0, 1);
  const dist = session.distEnd * pClamped;
  return buildPose(
    session.grab,
    session.axisNormal,
    session.mode,
    dist,
    pClamped,
    session.touchYOffset,
    session.distEnd,
    session.size,
    session.config
  );
}

/** 姿态装配核心：dist = 折痕推进量，progress = 折叠完成比例（0..1）。 */
function buildPose(
  grab: Point,
  normal: Point,
  mode: GrabMode,
  dist: number,
  progress: number,
  touchYOffset: number,
  distEnd: number,
  size: PageSize,
  config: FlipConfig
): FoldPose {
  const { width: w, height: h } = size;
  const p = progress <= 0 ? 0 : clamp(progress, 0, 1);

  // 折痕点：沿抓取轴推进；边缘模式 y 随触点轻微跟随
  let px = grab.x - normal.x * dist;
  let py = grab.y - normal.y * dist;
  if (mode === 'edge') {
    py = grab.y + touchYOffset * config.geometry.creaseFollowRatio;
  }

  // 折痕方向：垂直于 n̂，约定 y 分量 ≥ 0（边缘模式恒平行书脊）
  let dx = mode === 'edge' ? 0 : -normal.y;
  let dy = mode === 'edge' ? 1 : normal.x;
  if (dy < 0) {
    dx = -dx;
    dy = -dy;
  }

  // 落页压平系数（folded 端把 z 压向纸厚）
  const flatten = smoothstep(config.geometry.flattenStart, 1, p);
  // 紧卷筒 + 大斜披背面（真实书本形态）：卷筒保持细小（纸卷得紧），
  // 掀起材料的大部分以背面斜披段展现——背面内容清晰可见。
  // 若卷筒过大（rπ ≈ 掀起长度），筒上只会缠着页面边距的空白纸，背面消失。
  const rNatural = clamp(
    config.geometry.radiusBaseRatio * w + config.geometry.radiusGrowRatio * dist,
    w * config.geometry.radiusMin,
    w * config.geometry.radiusMax
  );
  // 飞行抬升：翻页中段纸张立起（弧顶高度 ≈ 2×flightRadiusRatio×页宽），
  // 按 sin²(π·p) 弧起落——起止端回落到自然卷曲半径，落页压平不受影响。
  // 斜披段保留（rπ < 掀起长）：自由端仍触及触点（跟手）。
  const flightArc = Math.sin(Math.PI * p) ** 2;
  const rFlight = w * config.geometry.flightRadiusRatio * flightArc;
  const rBase = Math.max(rNatural, rFlight);
  const radius = lerp(rBase, config.geometry.landRadius, flatten);
  // 背面斜披段的弧拱：过弧顶后的下落段带向上拱起（真实纸张前冲弧线）
  const drapeBulge = config.geometry.drapeArcRatio * Math.max(dist - radius * Math.PI, 0);

  // 圆锥锥化：仅角部模式；触点竖向偏移越大、抓取角越靠边越明显，
  // 锥顶在抓取角一侧（抓得近的一端卷得紧）。
  let taper = 0;
  if (mode === 'corner') {
    const spread = clamp(Math.abs(touchYOffset) / (h * config.geometry.taperSpreadRatio), 0, 1);
    taper = config.geometry.taperStrength * spread * ((grab.y / h - 0.5) * 2);
  }

  return {
    creaseOrigin: { x: px, y: py },
    creaseDir: { x: dx, y: dy },
    wrapNormal: { x: normal.x, y: normal.y },
    radius,
    taper,
    flatten,
    progress: p,
    // 掀起材料全长（卷曲压缩段 + 背面斜披段）——背面三角宽度与投影范围依据
    strength: dist,
    // 背面斜披段弧拱高度（px，着色器/形变的下落段上拱依据）
    drapeBulge,
  };
}
