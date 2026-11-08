import { describe, expect, it } from 'vitest';
import { deformPoint } from '../engine/deform';
import type { FoldPose, PageSize } from '../engine/types';

const SIZE: PageSize = { width: 400, height: 600 };

/** 固定姿态：折痕 x=100 竖直，n̂=+x，半径 30，无锥化，strength=150。 */
function flatPose(radius = 30, taper = 0, strength = 150): FoldPose {
  return {
    creaseOrigin: { x: 100, y: 300 },
    creaseDir: { x: 0, y: 1 },
    wrapNormal: { x: 1, y: 0 },
    radius,
    taper,
    flatten: 0,
    progress: 0.5,
    strength,
  };
}

describe('deformPoint · 3D 三段式映射', () => {
  it('桌面料（s≤0）原位不动', () => {
    const d = deformPoint({ x: 40, y: 120 }, flatPose(), SIZE);
    expect(d).toMatchObject({ x: 40, y: 120, z: 0, face: 'flat', theta: 0 });
  });

  it('卷曲段金值：s=60, r=30 → θ=2rad，pos = P + n̂·r·sinθ，z = r(1−cosθ)', () => {
    const d = deformPoint({ x: 160, y: 300 }, flatPose(), SIZE);
    expect(d.face).toBe('curl');
    expect(d.x).toBeCloseTo(100 + 30 * Math.sin(2), 6);
    expect(d.z).toBeCloseTo(30 * (1 - Math.cos(2)), 6);
    expect(d.theta).toBeCloseTo(2, 6);
  });

  it('卷曲段最远鼓出 = r（θ=π/2，高度亦为 r）', () => {
    const d = deformPoint({ x: 100 + 30 * (Math.PI / 2), y: 300 }, flatPose(), SIZE);
    expect(d.x).toBeCloseTo(100 + 30, 6);
    expect(d.z).toBeCloseTo(30, 6);
  });

  it('背面斜披段金值：s > rπ，镜像展开且自卷顶 2r 斜披到桌面', () => {
    const r = 30;
    const pose = flatPose(r, 0, r * Math.PI + 100); // strength = rπ + 100
    const d = deformPoint({ x: 100 + r * Math.PI + 40, y: 300 }, pose, SIZE);
    expect(d.face).toBe('back');
    expect(d.x).toBeCloseTo(100 - 40, 6);
    expect(d.z).toBeCloseTo(2 * r * (1 - 40 / 100), 6);
  });

  it('自由边触桌：s = strength 时 z = 0', () => {
    const r = 30;
    const pose = flatPose(r, 0, r * Math.PI + 100);
    const d = deformPoint({ x: 100 + r * Math.PI + 100, y: 300 }, pose, SIZE);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('切向坐标保留：离轴点的 ξ 分量不丢失（否则曲面塌缩成线）', () => {
    const r = 30;
    const pose = flatPose(r, 0, r * Math.PI + 100);
    const d = deformPoint({ x: 100 + r * Math.PI + 40, y: 480 }, pose, SIZE);
    // 折痕竖直（creaseDir=(0,1)）：y 分量必须原样保留（相对折痕点 +180）
    expect(d.y).toBeCloseTo(300 + 180, 6);
    // x 分量只受法向映射影响
    expect(d.x).toBeCloseTo(100 - 40, 6);
  });

  it('θ=π 处 C0 连续（卷曲段折回点 = 背面段起点 = 折痕正上方 2r）', () => {
    const r = 30;
    const arcEnd = deformPoint({ x: 100 + r * Math.PI - 0.01, y: 300 }, flatPose(), SIZE);
    const backStart = deformPoint({ x: 100 + r * Math.PI + 0.01, y: 300 }, flatPose(), SIZE);
    expect(Math.abs(arcEnd.x - backStart.x)).toBeLessThan(0.02);
    expect(Math.abs(arcEnd.z - backStart.z)).toBeLessThan(0.02);
    expect(arcEnd.face).toBe('curl');
    expect(backStart.face).toBe('back');
  });

  it('背面斜披段自由甩出：越过页缘不钳制（单页版式，落定淡出承接）', () => {
    const r = 30;
    const pose = flatPose(r, 0, r * Math.PI + 520);
    const d = deformPoint({ x: 100 + r * Math.PI + 520, y: 300 }, pose, SIZE);
    expect(d.face).toBe('back');
    // 材料越过书脊甩到 x = 100 − 520 = −420，无书体缘钳制
    expect(d.x).toBeCloseTo(-420, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });
});

describe('deformPoint · 锥化', () => {
  it('taper>0 时 ξ>0 端半径更小（更早折回）', () => {
    const pose = flatPose(30, 0.4);
    const mid = 100 + Math.PI * 30;
    const tight = deformPoint({ x: mid, y: 600 }, pose, SIZE); // ξ=+0.5 → r=24
    const loose = deformPoint({ x: mid, y: 0 }, pose, SIZE);   // ξ=−0.5 → r=36
    expect(tight.x).toBeLessThan(100); // 紧端已折回折痕另一侧
    expect(loose.x).toBeGreaterThan(100); // 松端仍在卷出侧
  });

  it('锥化使卷顶高度随 ξ 变化（圆锥扭转）', () => {
    const pose = flatPose(30, 0.4);
    const mid = 100 + Math.PI * 30;
    const tightTop = deformPoint({ x: mid, y: 600 }, pose, SIZE);
    const looseTop = deformPoint({ x: mid, y: 0 }, pose, SIZE);
    expect(tightTop.z).toBeLessThan(looseTop.z);
  });
});
