import { describe, expect, it } from 'vitest';
import {
  clampCornerTouch,
  clampTouch,
  createFoldSession,
  solveFoldPose,
  solveFoldPoseAtProgress,
} from '../curl-model';
import { deformPoint } from '../deform';
import { DEFAULT_FLIP_CONFIG, type PageSize, type Point } from '../types';

const SIZE: PageSize = { width: 400, height: 600 };
const CFG = DEFAULT_FLIP_CONFIG;
/** 折痕锚定上限（页高 30%）。 */
const ANCHOR = 0.3 * 600;

describe('solveFoldPose · forward 边缘拖拽', () => {
  const grab: Point = { x: 400, y: 300 };

  it('p=0（触点未拉动）时全页平贴', () => {
    const pose = solveFoldPose({ grab, touch: { x: 400, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(0);
    // 折痕在自由边，任何页内点 s ≤ 0 → z = 0
    for (const x of [0, 100, 200, 399]) {
      expect(deformPoint({ x, y: 300 }, pose, SIZE).z).toBe(0);
    }
  });

  it('手指拖 1/4 页宽（progress=0.25）时折痕在中垂线上', () => {
    const pose = solveFoldPose({ grab, touch: { x: 200, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.progress).toBeCloseTo(0.25, 5);
    // 中垂线：折痕 = 抓取点与触点的中点
    expect(pose.creaseOrigin.x).toBeCloseTo(300, 5);
    // r = max(radiusBaseRatio·W + 0.05·dist, flight)——飞行抬升按 sin²(π·0.25)=0.5 起拱
    const natural = CFG.geometry.radiusBaseRatio * 400 + 0.05 * 100;
    const flight = 400 * CFG.geometry.flightRadiusRatio * Math.sin(Math.PI * 0.25) ** 2;
    expect(pose.radius).toBeCloseTo(Math.max(natural, flight), 3);
    expect(pose.flatten).toBe(0);
    // θ_end = dist / r ≈ 6.7 > π → 掀起材料已出现背面斜披段（镜像内容可见）
    expect(100 / pose.radius).toBeGreaterThan(Math.PI);
  });

  it('折痕恒竖直（平行装订边）：触点 y 变化不改变折痕方向', () => {
    const pose = solveFoldPose({ grab, touch: { x: 200, y: 80 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.creaseDir).toEqual({ x: 0, y: 1 });
    // 折痕 y 随触点轻微跟随（1/4 行程）
    expect(pose.creaseOrigin.y).toBeCloseTo(300 + (80 - 300) * 0.25, 5);
  });

  it('progress=1（手指拖满 2×页宽）时折痕达书脊、压平为纸厚，整页镜像翻过', () => {
    // 手指拖到抓取点的镜像位（−W），中垂线折痕恰好推进到书脊
    const pose = solveFoldPose({ grab, touch: { x: -400, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(1);
    expect(pose.creaseOrigin.x).toBeCloseTo(0, 5);
    expect(pose.radius).toBeCloseTo(CFG.geometry.landRadius, 5);
    // 背面平铺段：材料翻到折痕另一侧（镜像）
    const d = deformPoint({ x: 120, y: 300 }, pose, SIZE);
    expect(d.x).toBeLessThan(0);
    expect(d.face).toBe('back'); // 背面朝上
  });
});

describe('solveFoldPose · backward 掀回（与 forward 镜像对称）', () => {
  const grab: Point = { x: 0, y: 300 };

  it('p=0（触点未拉动）时全页平贴', () => {
    const pose = solveFoldPose({ grab, touch: { x: 0, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(0);
    for (const x of [0, 100, 200, 399]) {
      expect(deformPoint({ x, y: 300 }, pose, SIZE).z).toBe(0);
    }
  });

  it('折痕自书脊扫向自由边：触点右移 → 折痕右移、进度增长', () => {
    const pose = solveFoldPose({ grab, touch: { x: 100, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBeCloseTo(0.125, 5); // 100 / (2×400)
    expect(pose.creaseOrigin.x).toBeCloseTo(50, 5); // 中垂线：推进 = 行程/2
    const natural = CFG.geometry.radiusBaseRatio * 400 + 0.05 * 50;
    const flight = 400 * CFG.geometry.flightRadiusRatio * Math.sin(Math.PI * 0.125) ** 2;
    expect(pose.radius).toBeCloseTo(Math.max(natural, flight), 3);
  });

  it('掀起材料翻折叠到折痕另一侧（镜像 forward 越中线）', () => {
    // 深拉：折痕接近自由边，掀起材料（书脊侧）翻过折痕落到另一侧
    const pose = solveFoldPose({ grab, touch: { x: 400, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.creaseOrigin.x).toBeCloseTo(200, 5);
    expect(pose.progress).toBeCloseTo(0.5, 5);
    // 书脊侧材料（x < 200）已掀起：其背面斜披段落到折痕右侧（页内/页外）
    const d = deformPoint({ x: 0, y: 300 }, pose, SIZE);
    expect(d.face).not.toBe('flat');
    expect(d.x).toBeGreaterThan(200); // 翻到折痕另一侧
  });

  it('快甩语义与 forward 一致：进度阈值 / 甩速判定可完成翻页', () => {
    // 手指拖到 clampTouch 上限（1.3W）时进度 ≈ 0.65 > completeProgress
    const pose = solveFoldPose({ grab, touch: { x: 520, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBeGreaterThan(0.25);
  });
});

describe('solveFoldPose · 角部捏角斜翻', () => {
  it('折痕方向垂直于拉扯方向（斜折痕）', () => {
    const pose = solveFoldPose({
      grab: { x: 400, y: 0 },
      touch: { x: 120, y: 300 },
      mode: 'corner',
      action: 'forward',
      size: SIZE,
      config: CFG,
    });
    const dot = pose.creaseDir.x * pose.wrapNormal.x + pose.creaseDir.y * pose.wrapNormal.y;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    expect(pose.creaseDir.y).toBeGreaterThanOrEqual(0);
  });

  it('推进终点：手指拖到抓取角镜像位（2×页宽）时整页翻过', () => {
    // 抓右上角、水平左拉到镜像位（−400）：行程 = 2×页宽 → progress = 1
    const pose = solveFoldPose({
      grab: { x: 400, y: 0 },
      touch: { x: -400, y: 0 },
      mode: 'corner',
      action: 'forward',
      size: SIZE,
      config: CFG,
    });
    expect(pose.progress).toBe(1);
  });

  it('角部模式产生锥化（taper 非零，抓取角一侧更紧）', () => {
    const pose = solveFoldPose({
      grab: { x: 400, y: 600 },
      touch: { x: 100, y: 150 },
      mode: 'corner',
      action: 'forward',
      size: SIZE,
      config: CFG,
    });
    expect(pose.taper).toBeGreaterThan(0);
  });
});

describe('会话补间一致性', () => {
  it('按进度求解与轴上触点实时求解结果一致', () => {
    const grab: Point = { x: 400, y: 90 };
    const touch: Point = { x: 160, y: 240 };
    const session = createFoldSession(grab, touch, 'corner', 'forward', SIZE, CFG);
    // 轴上虚拟触点：抓取点沿 −axisNormal 推进 2·distEnd·p（中垂线行程）
    const p = 0.42;
    const virtualTouch: Point = {
      x: grab.x - session.axisNormal.x * session.distEnd * 2 * p,
      y: grab.y - session.axisNormal.y * session.distEnd * 2 * p,
    };
    // 拖拽中折痕 y 跟随实时触点（控制器每帧同步会话偏移）
    session.touchYOffset = virtualTouch.y - grab.y;
    const live = solveFoldPose({ grab, touch: virtualTouch, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    const byProgress = solveFoldPoseAtProgress(session, p);
    expect(byProgress.creaseOrigin.x).toBeCloseTo(live.creaseOrigin.x, 6);
    expect(byProgress.creaseOrigin.y).toBeCloseTo(live.creaseOrigin.y, 6);
    expect(byProgress.radius).toBeCloseTo(live.radius, 6);
  });
});

describe('clampCornerTouch · 角部折痕书脊锚定', () => {
  /** 折痕与书脊（x=0）交点的 y（由姿态反推）。 */
  function spineCrossY(grab: Point, touch: Point): number {
    const pose = solveFoldPose({ grab, touch, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    // 折痕：过 creaseOrigin、方向 creaseDir；与 x=0 交点
    const k = -pose.creaseOrigin.x / (pose.creaseDir.x || 1e-9);
    return pose.creaseOrigin.y + pose.creaseDir.y * k;
  }

  it('捏角小折（触点在枢轴圆内）：不约束，保持自然起翻态', () => {
    const grab: Point = { x: 400, y: 0 };
    const touch: Point = { x: 200, y: 100 };
    expect(clampCornerTouch(touch, grab, 'forward', SIZE, 0.3)).toEqual(touch);
  });

  it('折痕锚定在书脊上角附近（crossY ≤ 30%H）：不约束', () => {
    const grab: Point = { x: 400, y: 0 };
    const touch: Point = { x: 120, y: 480 }; // crossY ≈ 88 < 180
    expect(clampCornerTouch(touch, grab, 'forward', SIZE, 0.3)).toEqual(touch);
  });

  it('深拉导致折痕锚点滑到页中（crossY > 30%H）：钳回锚定圆', () => {
    const grab: Point = { x: 400, y: 0 };
    const touch: Point = { x: 130, y: 700 }; // crossY ≈ 248 > 180
    const clamped = clampCornerTouch(touch, grab, 'forward', SIZE, 0.3);
    expect(clamped).not.toEqual(touch);
    // 锚定圆：圆心 (0, 180)，半径 √(W²+anchor²)
    const dx = clamped.x;
    const u = clamped.y - 180;
    expect(Math.hypot(dx, u)).toBeCloseTo(Math.hypot(400, ANCHOR), 1);
  });

  it('整页翻起的完成态（crossY ≥ H）与掀角上扬态（u ≤ 0）不约束', () => {
    const grab: Point = { x: 400, y: 0 };
    expect(clampCornerTouch({ x: -600, y: 200 }, grab, 'forward', SIZE, 0.3)).toEqual({ x: -600, y: 200 });
    expect(clampCornerTouch({ x: 300, y: -50 }, grab, 'forward', SIZE, 0.3)).toEqual({ x: 300, y: -50 });
  });

  it('backward 镜像对称：枢轴 = 同端自由边角', () => {
    const grab: Point = { x: 0, y: 0 };
    const touch: Point = { x: 250, y: 700 };
    const clamped = clampCornerTouch(touch, grab, 'backward', SIZE, 0.3);
    const dx = clamped.x - 400;
    const u = clamped.y - 180;
    expect(Math.hypot(dx, u)).toBeCloseTo(Math.hypot(400, ANCHOR), 1);
  });

  it('约束后折痕与书脊交点不超过锚定上限（撕纸观感消除）', () => {
    const grab: Point = { x: 400, y: 0 };
    expect(spineCrossY(grab, { x: 130, y: 700 })).toBeLessThanOrEqual(ANCHOR + 1);
    expect(spineCrossY(grab, { x: 60, y: 640 })).toBeLessThanOrEqual(ANCHOR + 1);
    // 底角抓取镜像同样成立
    const grabBottom: Point = { x: 400, y: 600 };
    const pose = solveFoldPose({ grab: grabBottom, touch: { x: 130, y: -100 }, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    const k = -pose.creaseOrigin.x / (pose.creaseDir.x || 1e-9);
    const crossFromBottom = 600 - (pose.creaseOrigin.y + pose.creaseDir.y * k);
    expect(crossFromBottom).toBeLessThanOrEqual(ANCHOR + 1);
  });
});

describe('clampTouch', () => {
  it('限制触点在页面外扩 margin 范围内', () => {
    const t = clampTouch({ x: -50, y: 999 }, SIZE, 40);
    expect(t.x).toBe(-40);
    expect(t.y).toBe(640);
  });
});

describe('solveFoldPose · 页缘外抓取（beyondAxis 余量）', () => {
  const SIZE = { width: 400, height: 600 };
  const grab = { x: 400, y: 300 };

  it('触点越出自由边时轴向不反转：法向恒 (+1,0)、行程不取反', () => {
    // 页外按下（x = 460 > w）：旧实现 grab−touch 反向 → 轴 (−1,0)，
    // 行程取反、初始姿态反向卷曲
    const outside = solveFoldPose({ grab, touch: { x: 460, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(outside.wrapNormal).toEqual({ x: 1, y: 0 });
    expect(outside.progress).toBe(0); // 页外无行程，页面保持平贴
    // 随后移入页内：行程按自由边起算，方向为正
    const inward = solveFoldPose({ grab, touch: { x: 200, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(inward.wrapNormal).toEqual({ x: 1, y: 0 });
    expect(inward.progress).toBeCloseTo(0.25, 5); // 200 / (2×400)
    expect(inward.creaseOrigin.x).toBeCloseTo(300, 5);
  });

  it('backward 书脊侧页外抓取同理不反转', () => {
    const spineGrab = { x: 0, y: 300 };
    const outside = solveFoldPose({ grab: spineGrab, touch: { x: -60, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(outside.wrapNormal).toEqual({ x: -1, y: 0 });
    expect(outside.progress).toBe(0);
    const inward = solveFoldPose({ grab: spineGrab, touch: { x: 200, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(inward.wrapNormal).toEqual({ x: -1, y: 0 });
    expect(inward.progress).toBeCloseTo(0.25, 5);
  });
});
