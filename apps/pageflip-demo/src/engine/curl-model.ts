/**
 * 折痕姿态求解：触点/进度 → 折痕几何（纯函数）。
 *
 * 统一模型（forward / backward 共用同一套数学）：
 * - 规范空间书脊在 x=0、自由边在 x=W；折痕从自由边（p=0，全平）扫向书脊
 *   （p=1，镜像折平），折痕沿「抓取点 → 触点」轴线推进。
 * - 折痕左侧（s<0）材料平铺在桌面上，右侧（s>0）绕圆柱卷起并在弧长超过
 *   radius·π 后平背延伸、悬于折痕另一侧——即「卷曲 + 平背」两段式。
 * - 卷曲半径随进度正弦鼓包（起止松、中段最紧），折平端以 landRadius
 *   压成纸厚：forward 末段（翻过去贴落）/ backward 起段（折平隐藏）。
 * - backward（掀回上一页）= 上一页以镜像抓取点走同一 forward 求解：
 *   抓取点镜像到自由边（w − grab.x），触点直接复用（手指捏住折痕行进），
 *   掀回进度 = 1 − p。折平态恰好是跨书脊镜像（材料落在页外，仅书脊处
 *   留 ~纸厚折脊，形成"上一页边缘微露"的效果）。
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
  /** 角部模式的竖向偏移（冻结于释放时刻，决定锥化幅度）。 */
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
  const axisNormal = axisNormalFor(grab, touch, mode, action, size);
  return {
    grab: { ...grab },
    axisNormal,
    mode,
    action,
    touchYOffset: touch.y - grab.y,
    distEnd: distEndFor(mirrorGrab(grab, action, size), axisNormal, size),
    size,
    config,
  };
}

/** 卷起侧法向：从触点指向抓取点；边缘模式锁水平（折痕平行书脊）。 */
function axisNormalFor(grab: Point, touch: Point, mode: GrabMode, action: FlipAction, size: PageSize): Point {
  const grabF = mirrorGrab(grab, action, size);
  const touchF = action === 'forward' ? touch : { x: touch.x, y: touch.y };
  let nx = grabF.x - touchF.x;
  let ny = mode === 'edge' ? 0 : grabF.y - touchF.y;
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len < EPSILON) {
    return { x: 1, y: 0 };
  }
  return { x: nx / len, y: ny / len };
}

/** backward：抓取点镜像到自由边（w − grab.x），使上一页复用 forward 几何。 */
function mirrorGrab(grab: Point, action: FlipAction, size: PageSize): Point {
  return action === 'forward' ? grab : { x: size.width - grab.x, y: grab.y };
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
 * 返回 pose.progress 以「自由端推进比例」计（手指拖过页面中线 ≈ 0.5）：
 * forward 为 0→1，backward 为 1→0 的掀回度。
 *
 * 折痕语义（各自模拟真实手势）：
 * - forward：捏住自由端拖拽 → 折痕 = 抓取点与触点连线的**中垂线**
 *   （2D 刚性折叠，云展网/StPageFlip 同款），自由端跟随手指，
 *   已掀材料绕大半径圆柱卷起，背面（镜像内容）自 θ>π/2 起大面积朝上；
 * - backward：捏住折痕（折叠态的纸脊）行进 → 折痕跟随手指，逐渐铺开。
 */
export function solveFoldPose(input: FoldSolveInput): FoldPose {
  const { grab, touch, mode, action, size, config } = input;
  const grabF = mirrorGrab(grab, action, size);
  const touchF = action === 'forward' ? touch : { x: touch.x, y: touch.y };
  const normal = axisNormalFor(grab, touch, mode, action, size);
  const distEnd = distEndFor(grabF, normal, size);
  const fingerDist = clamp(
    -((touchF.x - grabF.x) * normal.x + (touchF.y - grabF.y) * normal.y),
    0,
    distEnd * 2
  );
  const fraction = clamp(fingerDist / (distEnd * 2), 0, 1);
  if (action === 'forward') {
    // 中垂线：折痕推进 = 手指行程的一半；progress = 手指行程 / 2·distEnd
    //（手指拖满两个页宽 = 折痕到达书脊 = 整页翻过）
    return buildPose(grabF, normal, mode, action, fingerDist / 2, fraction, touchF.y - grabF.y, distEnd, size, config);
  }
  // backward：progress = 掀回度 = 手指行程 / distEnd（书脊=0，达自由边=1）；
  // 折痕跟随手指：forwardProgress = fingerDist/distEnd（folded 端折痕在书脊）。
  const backFraction = clamp(fingerDist / distEnd, 0, 1);
  return buildPose(grabF, normal, mode, action, fingerDist, backFraction, touchF.y - grabF.y, distEnd, size, config);
}

/**
 * 按进度求解（snap 补间 / 点击翻页）：轴线与锥化偏移冻结自会话，
 * 保证补间路径与拖拽几何连续。
 * forward：dist = distEnd·p —— p=1 时折痕恰达书脊，整页翻过（镜像平贴）。
 */
export function solveFoldPoseAtProgress(session: FoldSession, p: number): FoldPose {
  const grabF = mirrorGrab(session.grab, session.action, session.size);
  const pClamped = clamp(p, 0, 1);
  const dist = session.action === 'forward' ? session.distEnd * pClamped : session.distEnd * (1 - pClamped);
  const forwardP = session.action === 'forward' ? pClamped : 1 - pClamped;
  return buildPose(
    grabF,
    session.axisNormal,
    session.mode,
    session.action,
    dist,
    forwardP,
    session.touchYOffset,
    session.distEnd,
    session.size,
    session.config
  );
}

/** 姿态装配核心：dist = 折痕推进量，forwardProgress = 自由端推进比例（0..1）。 */
function buildPose(
  grabF: Point,
  normal: Point,
  mode: GrabMode,
  action: FlipAction,
  dist: number,
  forwardProgress: number,
  touchYOffset: number,
  distEnd: number,
  size: PageSize,
  config: FlipConfig
): FoldPose {
  const { width: w, height: h } = size;
  // progress 以「自由端推进比例」计：手指拖过页面中线 ≈ 0.5，拖满一个页宽 = 1
  const p = forwardProgress <= 0 ? 0 : clamp(forwardProgress, 0, 1);

  // 折痕点：沿抓取轴推进；边缘模式 y 随触点轻微跟随
  let px = grabF.x - normal.x * dist;
  let py = grabF.y - normal.y * dist;
  if (mode === 'edge') {
    py = grabF.y + touchYOffset * 0.25;
  }

  // 折痕方向：垂直于 n̂，约定 y 分量 ≥ 0（边缘模式恒平行书脊）
  let dx = mode === 'edge' ? 0 : -normal.y;
  let dy = mode === 'edge' ? 1 : normal.x;
  if (dy < 0) {
    dx = -dx;
    dy = -dy;
  }

  // 落页压平系数（folded 端把 z 压向纸厚）
  const flatten = smoothstep(0.86, 1, p);
  // 紧卷筒 + 大斜披背面（真实书本形态）：卷筒保持细小（纸卷得紧），
  // 掀起材料的大部分以背面斜披段展现——背面内容清晰可见。
  // 若卷筒过大（rπ ≈ 掀起长度），筒上只会缠着页面边距的空白纸，背面消失。
  const rNatural = clamp(0.03 * w + 0.05 * dist, w * config.radiusMin, w * config.radiusMax);
  const radius = lerp(rNatural, config.landRadius, flatten);

  // 圆锥锥化：仅角部模式；触点竖向偏移越大、抓取角越靠边越明显，
  // 锥顶在抓取角一侧（抓得近的一端卷得紧）。
  let taper = 0;
  if (mode === 'corner') {
    const spread = clamp(Math.abs(touchYOffset) / (h * 0.5), 0, 1);
    taper = config.taperStrength * spread * ((grabF.y / h - 0.5) * 2);
  }

  return {
    creaseOrigin: { x: px, y: py },
    creaseDir: { x: dx, y: dy },
    wrapNormal: { x: normal.x, y: normal.y },
    radius,
    taper,
    flatten,
    progress: action === 'forward' ? p : 1 - p,
    // 掀起材料全长（卷曲压缩段 + 背面平铺段）——背面三角宽度与投影范围依据
    strength: dist,
  };
}
