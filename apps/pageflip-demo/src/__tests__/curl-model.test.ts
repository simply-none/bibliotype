import { describe, expect, it } from 'vitest';
import {
  clampTouch,
  createFoldSession,
  solveFoldPose,
  solveFoldPoseAtProgress,
} from '../engine/curl-model';
import { deformPoint } from '../engine/deform';
import { DEFAULT_FLIP_CONFIG, type PageSize, type Point } from '../engine/types';

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
    // r = 0.03W + 0.05·dist（dist = 手指行程/2 = 100）——紧卷筒
    expect(pose.radius).toBeCloseTo(0.03 * 400 + 0.05 * 100, 3);
    expect(pose.flatten).toBe(0);
    // θ_end = dist / r ≈ 6.7 > π → 掀起材料已出现背面斜披段（镜像内容可见）
    expect(100 / pose.radius).toBeGreaterThan(Math.PI);
  });

  it('progress=1（手指拖满 2×页宽）时折痕达书脊、压平为纸厚，整页镜像翻过', () => {
    // 手指拖到抓取点的镜像位（−W），中垂线折痕恰好推进到书脊
    const pose = solveFoldPose({ grab, touch: { x: -400, y: 300 }, mode: 'edge', action: 'forward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(1);
    expect(pose.creaseOrigin.x).toBeCloseTo(0, 5);
    expect(pose.radius).toBeCloseTo(CFG.landRadius, 5);
    // 背面平铺段：材料翻到折痕另一侧（镜像）
    const d = deformPoint({ x: 120, y: 300 }, pose, SIZE);
    expect(d.x).toBeLessThan(0);
    expect(d.face).toBe('back'); // 背面朝上
  });
});

describe('solveFoldPose · backward 掀回', () => {
  const grab: Point = { x: 0, y: 300 };

  it('触点在书脊（p_back=0）时为折平隐藏态（镜像到页外）', () => {
    const pose = solveFoldPose({ grab, touch: { x: 0, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(0);
    expect(pose.radius).toBeCloseTo(CFG.landRadius, 5);
    const d = deformPoint({ x: 300, y: 300 }, pose, SIZE);
    expect(d.x).toBeLessThan(0); // 材料翻到页外
    expect(d.z).toBeLessThanOrEqual(2 * CFG.landRadius + 1e-6);
  });

  it('触点推进时折痕跟随触点 x，progress = touch.x / w', () => {
    const pose = solveFoldPose({ grab, touch: { x: 100, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBeCloseTo(0.25, 5);
    expect(pose.creaseOrigin.x).toBeCloseTo(100, 5);
  });

  it('p_back=1（触点达自由边）时完全铺开', () => {
    const pose = solveFoldPose({ grab, touch: { x: 400, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    expect(pose.progress).toBe(1);
    for (const x of [0, 100, 300, 399]) {
      const d = deformPoint({ x, y: 300 }, pose, SIZE);
      expect(d.z).toBe(0);
      expect(d.x).toBeCloseTo(x, 5);
    }
  });

  it('掀回中态：书脊侧材料已铺平（逐渐盖住下层页），自由边侧仍卷入', () => {
    const pose = solveFoldPose({ grab, touch: { x: 200, y: 300 }, mode: 'edge', action: 'backward', size: SIZE, config: CFG });
    const deposited = deformPoint({ x: 100, y: 300 }, pose, SIZE);
    expect(deposited.face).toBe('flat');
    expect(deposited.x).toBeCloseTo(100, 5);
    const curling = deformPoint({ x: 300, y: 300 }, pose, SIZE);
    expect(curling.face).not.toBe('flat'); // 卷曲压缩段（材料被卷入）
    expect(curling.x).toBeLessThan(300); // 向折痕方向压缩
  });
});

describe('solveFoldPose · 角部拖拽', () => {
  it('折痕方向垂直于拉扯方向', () => {
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
    const grab: Point = { x: 400, y: 0 };
    const touch: Point = { x: 160, y: 240 };
    const session = createFoldSession(grab, touch, 'corner', 'forward', SIZE, CFG);
    // 轴上虚拟触点：抓取点沿 −axisNormal 推进 2·distEnd·p（中垂线行程）
    const p = 0.42;
    const virtualTouch: Point = {
      x: grab.x - session.axisNormal.x * session.distEnd * 2 * p,
      y: grab.y - session.axisNormal.y * session.distEnd * 2 * p,
    };
    const live = solveFoldPose({ grab, touch: virtualTouch, mode: 'corner', action: 'forward', size: SIZE, config: CFG });
    const byProgress = solveFoldPoseAtProgress(session, p);
    expect(byProgress.creaseOrigin.x).toBeCloseTo(live.creaseOrigin.x, 6);
    expect(byProgress.creaseOrigin.y).toBeCloseTo(live.creaseOrigin.y, 6);
    expect(byProgress.radius).toBeCloseTo(live.radius, 6);
  });
});

describe('clampTouch', () => {
  it('限制触点在页面外扩 margin 范围内', () => {
    const t = clampTouch({ x: -50, y: 999 }, SIZE, 40);
    expect(t.x).toBe(-40);
    expect(t.y).toBe(640);
  });
});
