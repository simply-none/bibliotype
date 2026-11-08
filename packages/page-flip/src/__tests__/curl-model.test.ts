import { describe, expect, it } from 'vitest';
import {
  clampTouch,
  cornerPivot,
  createFoldSession,
  solveFoldPose,
  solveFoldPoseAtProgress,
} from '../curl-model';
import { deformPoint } from '../deform';
import { DEFAULT_FLIP_CONFIG, type PageSize, type Point } from '../types';

const SIZE: PageSize = { width: 400, height: 600 };
const CFG = DEFAULT_FLIP_CONFIG;

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

describe('solveFoldPose · backward 掀回（与前翻同几何，抓取点=自由边）', () => {
  const grab: Point = { x: 400, y: 300 };

  it('p=0（触点未拉动）时全页平贴', () => {
    const pose = solveFoldPose({ grab, touch: { x: 400, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(0);
    for (const x of [0, 100, 200, 399]) {
      expect(deformPoint({ x, y: 300 }, pose, SIZE).z).toBe(0);
    }
  });

  it('折痕自自由边扫向书脊：触点左移 → 折痕左移、进度增长', () => {
    const pose = solveFoldPose({ grab, touch: { x: 300, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBeCloseTo(0.125, 5); // 100 / (2×400)
    expect(pose.creaseOrigin.x).toBeCloseTo(350, 5); // 中垂线：推进 = 行程/2
    const natural = CFG.geometry.radiusBaseRatio * 400 + 0.05 * 50;
    const flight = 400 * CFG.geometry.flightRadiusRatio * Math.sin(Math.PI * 0.125) ** 2;
    expect(pose.radius).toBeCloseTo(Math.max(natural, flight), 3);
  });

  it('触点到书脊（x=0）时折痕到页中——其余由完成补间越过书脊', () => {
    const pose = solveFoldPose({ grab, touch: { x: 0, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.creaseOrigin.x).toBeCloseTo(200, 5); // 中垂线：推进 = 行程/2
    expect(pose.progress).toBeCloseTo(0.5, 5);
    // 自由侧材料已掀起翻折（部分翻过折痕）
    const d = deformPoint({ x: 399, y: 300 }, pose, SIZE);
    expect(d.face).not.toBe('flat');
  });

  it('完成补间：触点越到书脊对侧（x=−400）时折痕达书脊，整页翻落对侧', () => {
    const pose = solveFoldPose({ grab, touch: { x: -400, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.creaseOrigin.x).toBeCloseTo(0, 5); // 折痕到达书脊
    // 自由侧材料翻过书脊落到对侧（x < 0）
    const d = deformPoint({ x: 399, y: 300 }, pose, SIZE);
    expect(d.face).not.toBe('flat');
    expect(d.x).toBeLessThan(0); // 越过书脊
  });

  it('快甩语义与 forward 一致：进度阈值 / 甩速判定可完成翻页', () => {
    // 触点越到书脊对侧（x = −120）时进度 ≈ 0.65 > completeProgress
    const pose = solveFoldPose({ grab, touch: { x: -120, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBeGreaterThan(0.25);
  });
});

describe('solveFoldPose · 角部捏角斜翻（折角模型：折痕锚定书脊枢轴）', () => {
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

  it('折痕锚定书脊枢轴：折痕原点恒为装订边同端角', () => {
    for (const touch of [{ x: 200, y: 100 }, { x: 120, y: 480 }, { x: 130, y: 700 }] as Point[]) {
      const pose = solveFoldPose({
        grab: { x: 400, y: 0 },
        touch,
        mode: 'corner',
        action: 'forward',
        size: SIZE,
        config: CFG,
      });
      expect(pose.creaseOrigin.x).toBe(0);
      expect(pose.creaseOrigin.y).toBe(0);
    }
    // 底角抓取：枢轴 = 装订边底角
    const poseBottom = solveFoldPose({
      grab: { x: 400, y: 600 },
      touch: { x: 130, y: -100 },
      mode: 'corner',
      action: 'forward',
      size: SIZE,
      config: CFG,
    });
    expect(poseBottom.creaseOrigin.x).toBe(0);
    expect(poseBottom.creaseOrigin.y).toBe(600);
  });

  it('推进终点：手指拖到抓取角镜像位（2×页宽）时整页翻过', () => {
    // 抓右上角、水平左拉到镜像位（−400）：触点落在枢轴圆对侧 = 全折态
    const pose = solveFoldPose({
      grab: { x: 400, y: 0 },
      touch: { x: -400, y: 0 },
      mode: 'corner',
      action: 'forward',
      size: SIZE,
      config: CFG,
    });
    expect(pose.progress).toBe(1);
    expect(pose.creaseDir.x).toBeCloseTo(0, 5); // 折痕落到书脊缘方向
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

  it('折叠深度随拖拽增长、封顶于全折（触点钳制在枢轴圆内）', () => {
    const grab: Point = { x: 400, y: 0 };
    const p1 = solveFoldPose({ grab, touch: { x: 200, y: 100 }, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    const p2 = solveFoldPose({ grab, touch: { x: 130, y: 700 }, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    expect(p2.progress).toBeGreaterThan(p1.progress);
    const pMax = solveFoldPose({ grab, touch: { x: -400, y: 0 }, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    expect(pMax.progress).toBe(1);
  });

  it('装订边不参与折叠：抓取边同侧的装订缘材料保持平贴', () => {
    const grab: Point = { x: 400, y: 0 }; // 右上角，pivot = (0,0)
    const pose = solveFoldPose({ grab, touch: { x: 130, y: 700 }, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    // 装订边（x=0）上的材料在折痕靠书脊一侧：平贴不动
    for (const y of [50, 200, 400]) {
      const d = deformPoint({ x: 0, y }, pose, SIZE);
      expect(d.z).toBe(0);
      expect(d.face).toBe('flat');
    }
  });
});

describe('会话补间一致性', () => {
  it('角部会话：按进度求解 = 触点绕枢轴转动的实时求解', () => {
    const grab: Point = { x: 400, y: 90 };
    const touch: Point = { x: 160, y: 240 };
    const session = createFoldSession(grab, touch, 'corner', 'forward', SIZE, CFG);
    const p = 0.42;
    // AtProgress 内部触点：绕枢轴转动 2×asin(p)（沿会话记录的转向）
    const pivot = session.pivot!;
    const v1 = { x: grab.x - pivot.x, y: grab.y - pivot.y };
    const v1Len = Math.hypot(v1.x, v1.y);
    const angle = 2 * Math.asin(p) * (session.cornerSpin ?? 1);
    const touchP: Point = {
      x: pivot.x + (v1.x * Math.cos(angle) - v1.y * Math.sin(angle)) * v1Len,
      y: pivot.y + (v1.x * Math.sin(angle) + v1.y * Math.cos(angle)) * v1Len,
    };
    const byProgress = solveFoldPoseAtProgress(session, p);
    const live = solveFoldPose({ grab, touch: touchP, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    expect(byProgress.creaseOrigin.x).toBeCloseTo(live.creaseOrigin.x, 6);
    expect(byProgress.creaseOrigin.y).toBeCloseTo(live.creaseOrigin.y, 6);
    expect(byProgress.radius).toBeCloseTo(live.radius, 6);
    expect(byProgress.progress).toBeCloseTo(p, 5);
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

  it('backward 自由边页外触点同理不反转', () => {
    // 抓取点恒在自由边（x=400）：触点越出自由边（页缘余量内）时轴向回退 +x
    const outside = solveFoldPose({ grab, touch: { x: 460, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(outside.wrapNormal).toEqual({ x: 1, y: 0 });
    expect(outside.progress).toBe(0);
    const inward = solveFoldPose({ grab, touch: { x: 200, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(inward.wrapNormal).toEqual({ x: 1, y: 0 });
    expect(inward.progress).toBeCloseTo(0.25, 5);
  });
});
