import { describe, expect, it } from 'vitest';
import { decideRelease, resolveGrabZone, snapDurationFor } from '../engine/flip-decisions';
import { DEFAULT_FLIP_CONFIG, type PageSize } from '../engine/types';

const SIZE: PageSize = { width: 400, height: 600 };
const ZONE_OPTS = {
  cornerRadius: Math.min(SIZE.width, SIZE.height) * 0.3,
  edgeRatio: 0.25,
};

describe('resolveGrabZone', () => {
  it('右下角附近 → 角部 forward（捏角斜翻）', () => {
    const zone = resolveGrabZone({ x: 380, y: 580 }, SIZE, ZONE_OPTS);
    expect(zone?.mode).toBe('corner');
    expect(zone?.action).toBe('forward');
    expect(zone?.grab).toEqual({ x: 400, y: 600 });
  });

  it('左上角附近 → 角部 backward', () => {
    const zone = resolveGrabZone({ x: 30, y: 20 }, SIZE, ZONE_OPTS);
    expect(zone?.mode).toBe('corner');
    expect(zone?.action).toBe('backward');
    expect(zone?.grab).toEqual({ x: 0, y: 0 });
  });

  it('右侧边缘带 → 边缘 forward，抓取点 y 钳制在 15%~85%', () => {
    // 小角半径（72px）以隔离角部判定，专测边缘带与 y 钳制
    const opts = { ...ZONE_OPTS, cornerRadius: 72 };
    const zone = resolveGrabZone({ x: 370, y: 80 }, SIZE, opts);
    expect(zone?.mode).toBe('edge');
    expect(zone?.action).toBe('forward');
    expect(zone?.grab.y).toBeCloseTo(600 * 0.15, 5); // 80 → 钳到 90
  });

  it('左侧边缘带 → 边缘 backward', () => {
    const zone = resolveGrabZone({ x: 40, y: 300 }, SIZE, ZONE_OPTS);
    expect(zone?.mode).toBe('edge');
    expect(zone?.action).toBe('backward');
  });

  it('页面中部 → null', () => {
    expect(resolveGrabZone({ x: 200, y: 300 }, SIZE, ZONE_OPTS)).toBeNull();
  });

  it('无上一页时左侧区域仍可抓取（边界由控制器做橡皮筋）', () => {
    // 纯几何判定：边界方向的可用性由 FlipController 的 progressCap 承接
    const zone = resolveGrabZone({ x: 40, y: 300 }, SIZE, ZONE_OPTS);
    expect(zone?.mode).toBe('edge');
    expect(zone?.action).toBe('backward');
  });
});

describe('decideRelease', () => {
  const config = Pick_CONFIG();
  function Pick_CONFIG() {
    return { completeProgress: DEFAULT_FLIP_CONFIG.completeProgress, flickVelocity: DEFAULT_FLIP_CONFIG.flickVelocity };
  }

  it('进度过阈值 → complete', () => {
    expect(decideRelease(0.5, 0, config)).toBe('complete');
  });

  it('进度不足但快甩 → complete', () => {
    expect(decideRelease(0.2, 0.8, config)).toBe('complete');
  });

  it('进度不足且慢放 → cancel（回弹）', () => {
    expect(decideRelease(0.2, 0.1, config)).toBe('cancel');
    expect(decideRelease(0, 0, config)).toBe('cancel');
  });

  it('进度满格恒 complete', () => {
    expect(decideRelease(1, -2, config)).toBe('complete');
  });
});

describe('snapDurationFor', () => {
  it('随剩余距离缩放且有上下限', () => {
    expect(snapDurationFor(0)).toBe(240);
    expect(snapDurationFor(1)).toBe(540);
    expect(snapDurationFor(-5)).toBe(220); // 下限
    expect(snapDurationFor(9)).toBe(540); // 上限
  });
});
