/**
 * 折痕姿态求解：触点/进度 → 折痕几何（纯函数）。
 *
 * 装订书模型（forward / backward 完全对称，仅抓取侧与页面序号不同）：
 * - 规范空间书脊在 x=0（装订边）、自由边在 x=W，**抓取点恒在自由边**；
 * - 抓取模式：
 *   - edge：捏边翻页，折痕平行书脊（竖直），折回部分贴书翻过；
 *   - corner：捏角翻页（Plan A·折角模型）——折痕**锚定书脊枢轴**
 *     （装订边与抓取边同端的角），随拖拽转动角度，折叠区永远是从
 *     书脊出发的角部三角（真实折角/dog-ear），不会出现悬浮折痕
 *     横穿整页；触点距枢轴超出角半径时钳制（折叠封顶 = 全折）；
 * - forward：折痕自自由边扫向书脊，下层揭示下一页；
 *   backward：同几何（抓取点同样在自由边），下层揭示上一页——
 *   镜像对称；
 * - 卷曲半径随折叠深度增长，折平端以 landRadius 压成纸厚；
 * - 两方向共用同一进度语义：p ∈ [0,1] = 折叠完成比例（0 全平、1 全部
 *   翻出页外），落定淡出等后处理因此天然对称。
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
 * 角部折叠（Plan A·折角模型）：折痕锚定书脊枢轴、随触点转动。
 *
 * 折痕线 = 枢轴→角 与 枢轴→触点 两射线的角平分线（绕枢轴折纸的
 * 物理构型：反射角部到触点方向）；折叠区 = 折痕靠角一侧的三角，
 * 随拖拽增大但始终锚定书脊——不会出现悬浮折痕横穿整页。
 * 触点距枢轴超出枢轴→角全长时钳制到圆上（折叠封顶 = 全折态，
 * 折痕落到书脊缘方向、整页翻过）。
 */
function solveCornerPose(grab: Point, touch: Point, size: PageSize, config: FlipConfig): FoldPose {
  const pivot = cornerPivot(grab);
  const edgeLen = Math.max(Math.hypot(grab.x - pivot.x, grab.y - pivot.y), EPSILON);
  let toTouch = { x: touch.x - pivot.x, y: touch.y - pivot.y };
  const touchLen = Math.hypot(toTouch.x, toTouch.y);
  if (touchLen > edgeLen) {
    // 折叠封顶（Plan B 兜底）：触点钳制在枢轴圆内——全折态后不再推进
    toTouch = { x: (toTouch.x / touchLen) * edgeLen, y: (toTouch.y / touchLen) * edgeLen };
  }
  const v1 = { x: (grab.x - pivot.x) / edgeLen, y: (grab.y - pivot.y) / edgeLen };
  const v2Len = Math.max(Math.hypot(toTouch.x, toTouch.y), EPSILON);
  const v2 = { x: toTouch.x / v2Len, y: toTouch.y / v2Len };
  let dir = { x: v1.x + v2.x, y: v1.y + v2.y };
  let dirLen = Math.hypot(dir.x, dir.y);
  if (dirLen < EPSILON) {
    // 退化（触点在枢轴圆对侧 = 全折态）：折痕取抓取边的垂线
    dir = { x: -v1.y, y: v1.x };
    dirLen = Math.hypot(dir.x, dir.y);
  }
  dir = { x: dir.x / dirLen, y: dir.y / dirLen };
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
    radius,
    taper,
    flatten,
    progress,
    strength: edgeLen,
    drapeBulge,
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
  /** 角部会话：书脊枢轴（折痕锚定点）与旋转方向（触点在枢轴圆上的转向）。 */
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
 * 拖拽求解：由实时触点解算姿态（折痕方向 / 锥化随触点实时变化，跟手）。
 * - edge：折痕平行书脊，中垂线模型（抓取点与触点中点）；
 * - corner：折角模型——折痕锚定书脊枢轴、随触点转动（见 solveCornerPose）。
 */
export function solveFoldPose(input: FoldSolveInput): FoldPose {
  const { grab, mode, size, config } = input;
  if (mode === 'corner') {
    return solveCornerPose(grab, input.touch, size, config);
  }
  const normal = axisNormalFor(grab, input.touch, mode, input.action);
  const distEnd = distEndFor(grab, normal, size);
  const fingerDist = clamp(
    -((input.touch.x - grab.x) * normal.x + (input.touch.y - grab.y) * normal.y),
    0,
    distEnd * 2
  );
  const progress = clamp(fingerDist / (distEnd * 2), 0, 1);
  return buildPose(grab, normal, mode, fingerDist / 2, progress, input.touch.y - grab.y, distEnd, size, config);
}

/**
 * 按进度求解（snap 补间 / 点击翻页）：轴线与锥化偏移冻结自会话，
 * 保证补间路径与拖拽几何连续。dist = distEnd·p——p=1 时折痕到达推进
 * 终点，整页翻出页外。角部会话走折角模型：触点沿枢轴圆转动至全折态
 * （p=1 时触点到达枢轴圆对侧，折痕落到书脊缘方向、整页翻过）。
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
    return solveCornerPose(session.grab, touch, session.size, session.config);
  }
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
