import { describe, expect, it } from 'vitest';
import {
  clampTouch,
  createFoldSession,
  flipAngleFraction,
  solveFoldPose,
  solveFoldPoseAtProgress,
} from '../curl-model';
import { deformPoint } from '../deform';
import { DEFAULT_FLIP_CONFIG, type PageSize, type Point } from '../types';

const SIZE: PageSize = { width: 400, height: 600 };
const CFG = DEFAULT_FLIP_CONFIG;

describe('flipAngleFraction · 翻页角迟滞', () => {
  it('端点归一：R(0)=0、R(1)=1', () => {
    expect(flipAngleFraction(0, 0.32)).toBe(0);
    expect(flipAngleFraction(1, 0.32)).toBeCloseTo(1, 12);
  });

  it('两端角速度 ×(1−k)、中段 ×(1+k)（起翻/落定从容、中段干脆）', () => {
    const k = 0.32;
    const h = 1e-5;
    const dR = (p: number) => (flipAngleFraction(p + h, k) - flipAngleFraction(p - h, k)) / (2 * h);
    // 解析导数 R'(p) = 1 − k·cos(2πp)；端点值在定义域内邻近点取样
    expect(dR(0.02)).toBeCloseTo(1 - k * Math.cos(2 * Math.PI * 0.02), 3);
    expect(dR(0.5)).toBeCloseTo(1 + k, 3);
    expect(dR(0.98)).toBeCloseTo(1 - k * Math.cos(2 * Math.PI * 0.98), 3);
  });

  it('单调递增', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = flipAngleFraction(i / 20, 0.32);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('solveFoldPose · forward 边缘拖拽（刚体旋转模型）', () => {
  const grab: Point = { x: 400, y: 300 };

  it('p=0（触点未拉动）时全页平贴', () => {
    const pose = solveFoldPose({ grab, touch: { x: 400, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(0);
    expect(pose.model).toBe('rotation');
    // φ=0、χ=0：任何页内点原位平贴
    for (const x of [0, 100, 200, 399]) {
      expect(deformPoint({ x, y: 300 }, pose, SIZE).z).toBe(0);
    }
  });

  it('手指拖 1/4 页宽（progress=0.25）→ φ = π·R(0.25)，页面整体掀起', () => {
    const pose = solveFoldPose({ grab, touch: { x: 200, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.progress).toBeCloseTo(0.25, 5);
    const phi = Math.PI * flipAngleFraction(0.25, CFG.geometry.flipAngleLag);
    expect(pose.flipAngle).toBeCloseTo(phi, 6);
    // 卷筒半径 = W·lerp(lift, flight, smoothstep(0, 0.45, 0.25))
    const t = 0.25 / 0.45;
    const sMix = t * t * (3 - 2 * t);
    expect(pose.radius).toBeCloseTo(400 * (CFG.geometry.curlRadiusLift + (CFG.geometry.curlRadiusFlight - CFG.geometry.curlRadiusLift) * sMix), 3);
    // 起翻掀角：自由边卷筒包角显著（掀页感）
    expect(pose.curlAngle).toBeGreaterThan(1);
    // 书脊侧仍贴桌、自由缘已抬离
    expect(deformPoint({ x: 0, y: 300 }, pose, SIZE).z).toBe(0);
    expect(deformPoint({ x: 399, y: 300 }, pose, SIZE).z).toBeGreaterThan(0);
  });

  it('旋转轴恒为书脊（creaseDir 平行装订边），折痕锚点 y 随触点轻微跟随', () => {
    const pose = solveFoldPose({ grab, touch: { x: 200, y: 80 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.creaseDir).toEqual({ x: 0, y: 1 });
    expect(pose.creaseOrigin.y).toBeCloseTo(300 + (80 - 300) * 0.25, 5);
    expect(pose.creaseOrigin.x).toBe(0);
  });

  it('progress=1（触点达镜像位）时 φ=π，整页镜像翻落对侧', () => {
    const pose = solveFoldPose({ grab, touch: { x: -400, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(1);
    expect(pose.flipAngle).toBeCloseTo(Math.PI, 6);
    expect(pose.curlAngle).toBeCloseTo(0, 9);
    // 材料翻到书脊对侧（镜像），平贴桌面
    const d = deformPoint({ x: 120, y: 300 }, pose, SIZE);
    expect(d.x).toBeCloseTo(-120, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('会话补间一致性：按进度求解 = 线性映射触点的实时求解', () => {
    const touch: Point = { x: 320, y: 300 };
    const session = createFoldSession(grab, touch, 'edge', 'forward', SIZE, CFG);
    const p = 0.42;
    const byProgress = solveFoldPoseAtProgress(session, p);
    const live = solveFoldPose({ grab, touch: { x: 400 - 800 * p, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(byProgress.flipAngle).toBeCloseTo(live.flipAngle, 9);
    expect(byProgress.curlAngle).toBeCloseTo(live.curlAngle, 9);
    expect(byProgress.radius).toBeCloseTo(live.radius, 9);
    expect(byProgress.progress).toBeCloseTo(p, 5);
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

  it('触点左移 → 进度线性增长、φ 增大', () => {
    const pose = solveFoldPose({ grab, touch: { x: 300, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBeCloseTo(0.125, 5); // 100 / (2×400)
    expect(pose.flipAngle).toBeCloseTo(Math.PI * flipAngleFraction(0.125, CFG.geometry.flipAngleLag), 6);
  });

  it('触点到书脊（x=0）时进度 0.5，页面掀起立起中——其余由完成补间越过书脊', () => {
    const pose = solveFoldPose({ grab, touch: { x: 0, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBeCloseTo(0.5, 5);
    // 自由侧材料已掀起（离桌）
    const d = deformPoint({ x: 399, y: 300 }, pose, SIZE);
    expect(d.z).toBeGreaterThan(0);
  });

  it('完成补间：触点越到书脊对侧（x=−400）时 φ=π，整页翻落对侧', () => {
    const pose = solveFoldPose({ grab, touch: { x: -400, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.flipAngle).toBeCloseTo(Math.PI, 6);
    // 自由侧材料翻过书脊落到对侧（x < 0）
    const d = deformPoint({ x: 399, y: 300 }, pose, SIZE);
    expect(d.x).toBeLessThan(0); // 越过书脊
    expect(d.z).toBeCloseTo(0, 6);
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

  it('折叠封顶：触点越到枢轴圆对侧时折痕转角封顶（不撕裂装订）', () => {
    // 抓右上角、触点到枢轴圆对侧（−400, 0）：折角封顶于 φ_max
    const pose = solveFoldPose({
      grab: { x: 400, y: 0 },
      touch: { x: -400, y: 0 },
      mode: 'corner',
      action: 'forward',
      size: SIZE,
      config: CFG,
    });
    const phiMax = Math.atan(600 / 400);
    expect(pose.progress).toBeCloseTo(Math.sin(phiMax), 3); // sin(φ_max) ≈ 0.83
    expect(pose.creaseDir.x).toBeCloseTo(Math.cos(phiMax), 3); // 折痕 = 封顶方向
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
    expect(pMax.progress).toBeCloseTo(Math.sin(Math.atan(600 / 400)), 3);
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
    const live = solveFoldPose({ grab, touch: touchP, mode: 'corner', action: 'forward', size: SIZE, config: CFG, capPhi: false });
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
    expect(inward.flipAngle).toBeGreaterThan(0); // 页面已掀起
  });

  it('backward 自由边页外触点同理不反转', () => {
    // 抓取点恒在自由边（x=400）：触点越出自由边（页缘余量内）时轴向回退 +x
    const outside = solveFoldPose({ grab, touch: { x: 460, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(outside.wrapNormal).toEqual({ x: 1, y: 0 });
    expect(outside.progress).toBe(0);
    const inward = solveFoldPose({ grab, touch: { x: 200, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(inward.wrapNormal).toEqual({ x: 1, y: 0 });
    expect(inward.progress).toBeCloseTo(0.25, 5);
    expect(inward.flipAngle).toBeGreaterThan(0);
  });
});
