import { describe, expect, it } from 'vitest';
import { deformPoint } from '../deform';
import type { FoldPose, PageSize } from '../types';

const SIZE: PageSize = { width: 400, height: 600 };

/** 固定姿态：折痕 x=100 竖直，n̂=+x，半径 30，无锥化，strength=150（fold 模型）。 */
function flatPose(radius = 30, taper = 0, strength = 150, drapeBulge = 0): FoldPose {
  return {
    creaseOrigin: { x: 100, y: 300 },
    creaseDir: { x: 0, y: 1 },
    wrapNormal: { x: 1, y: 0 },
    model: 'fold',
    radius,
    taper,
    flatten: 0,
    progress: 0.5,
    strength,
    drapeBulge,
    flipAngle: 0,
    curlAngle: 0,
    bow: 0,
  };
}

/** 旋转模型姿态：φ 翻页角、χ 卷筒包角、r 卷筒半径、bow 拱高（W=400）。 */
function rotPose(phi: number, chi = 0, radius = 18, bow = 0): FoldPose {
  return {
    creaseOrigin: { x: 0, y: 300 },
    creaseDir: { x: 0, y: 1 },
    wrapNormal: { x: 1, y: 0 },
    model: 'rotation',
    radius,
    taper: 0,
    flatten: 0,
    progress: phi / Math.PI,
    strength: 400 * (phi / Math.PI),
    drapeBulge: 0,
    flipAngle: phi,
    curlAngle: chi,
    bow,
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

  it('背面斜披段金值：s > rπ，镜像展开且自卷顶 smoothstep 下落到桌面', () => {
    const r = 30;
    const pose = flatPose(r, 0, r * Math.PI + 100); // strength = rπ + 100
    const d = deformPoint({ x: 100 + r * Math.PI + 40, y: 300 }, pose, SIZE);
    expect(d.face).toBe('back');
    expect(d.x).toBeCloseTo(100 - 40, 6);
    // smoothstep 下落：t=0.4 → ease = 0.352 → z = 2r·(1−0.352)
    const ease = 0.4 * 0.4 * (3 - 2 * 0.4);
    expect(d.z).toBeCloseTo(2 * r * (1 - ease), 6);
  });

  it('背面弧拱：drapeBulge > 0 时下落段中段上拱、两端仍贴公式', () => {
    const r = 30;
    const pose = flatPose(r, 0, r * Math.PI + 100, 25);
    const d = deformPoint({ x: 100 + r * Math.PI + 40, y: 300 }, pose, SIZE);
    // z = 2r·(1−smoothstep(t)) + bulge·sin²(πt)
    const ease = 0.4 * 0.4 * (3 - 2 * 0.4);
    const arc = Math.sin(Math.PI * 0.4) ** 2;
    expect(d.z).toBeCloseTo(2 * r * (1 - ease) + 25 * arc, 6);
    // 触桌端不受弧拱影响
    const end = deformPoint({ x: 100 + r * Math.PI + 100, y: 300 }, pose, SIZE);
    expect(end.z).toBeCloseTo(0, 6);
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

describe('deformPoint · rotation（刚体旋转模型）', () => {
  it('φ=0 全页平贴（书脊锚定，y 不变）', () => {
    const pose = rotPose(0);
    for (const x of [0, 120, 260, 399]) {
      const d = deformPoint({ x, y: 210 }, pose, SIZE);
      expect(d.x).toBeCloseTo(x, 6);
      expect(d.z).toBeCloseTo(0, 6);
      expect(d.y).toBe(210);
    }
  });

  it('刚体段金值：φ=60°，x=120 → x′=d·cosφ、z=d·sinφ', () => {
    const pose = rotPose(Math.PI / 3);
    const d = deformPoint({ x: 120, y: 300 }, pose, SIZE);
    expect(d.x).toBeCloseTo(120 * Math.cos(Math.PI / 3), 6);
    expect(d.z).toBeCloseTo(120 * Math.sin(Math.PI / 3), 6);
    expect(d.theta).toBeCloseTo(Math.PI / 3, 6);
  });

  it('φ=90° 页面立起：自由缘在书脊正上方高度 W', () => {
    const pose = rotPose(Math.PI / 2);
    const d = deformPoint({ x: 400, y: 300 }, pose, SIZE);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(400, 6);
  });

  it('φ=π 整页镜像翻落对侧（x′=−x，z=0）', () => {
    const pose = rotPose(Math.PI);
    const d = deformPoint({ x: 120, y: 300 }, pose, SIZE);
    expect(d.x).toBeCloseTo(-120, 6);
    expect(d.z).toBeCloseTo(0, 6);
    expect(d.face).toBe('flat');
  });

  it('卷筒段：θ=(d−d_c)/r，切向角增至 φ+χ，C1 衔接刚体段', () => {
    const phi = Math.PI / 3;
    const chi = 0.8;
    const r = 18;
    const pose = rotPose(phi, chi, r);
    const hinge = 400 - r * chi;
    // 铰链两侧连续（位置与高度同时衔接）
    const body = deformPoint({ x: hinge - 0.01, y: 300 }, pose, SIZE);
    const roll = deformPoint({ x: hinge + 0.01, y: 300 }, pose, SIZE);
    expect(Math.abs(body.x - roll.x)).toBeLessThan(0.02);
    expect(Math.abs(body.z - roll.z)).toBeLessThan(0.02);
    // 卷筒中点金值：位置 = 铰链 + r·sinθ·T + r(1−cosθ)·N
    const theta = 0.35;
    const mid = deformPoint({ x: hinge + r * theta, y: 300 }, pose, SIZE);
    const along = hinge + r * Math.sin(theta);
    const nOff = r * (1 - Math.cos(theta));
    expect(mid.x).toBeCloseTo(along * Math.cos(phi) - nOff * Math.sin(phi), 6);
    expect(mid.z).toBeCloseTo(along * Math.sin(phi) + nOff * Math.cos(phi), 6);
    expect(mid.theta).toBeCloseTo(phi + theta, 6);
    // 卷筒顶（θ=χ）：切向角 = φ+χ
    const tip = deformPoint({ x: 400, y: 300 }, pose, SIZE);
    expect(tip.theta).toBeCloseTo(phi + chi, 6);
  });

  it('飞行拱：沿页法向弓出，刚体段中点抬升、书脊与自由缘按 sin 包络', () => {
    const phi = Math.PI / 2;
    const bow = 30;
    const pose = rotPose(phi, 0, 18, bow);
    const plain = rotPose(phi);
    const mid = deformPoint({ x: 200, y: 300 }, pose, SIZE);
    const midPlain = deformPoint({ x: 200, y: 300 }, plain, SIZE);
    // φ=90°：N=(−1,0)——拱沿 −x 方向（翻越方向）偏移，z 不变
    expect(mid.z).toBeCloseTo(midPlain.z, 6);
    expect(mid.x).toBeCloseTo(midPlain.x - 30, 6);
    // 书脊（d=0）与自由缘（d=W）处 sin 包络为零，不受拱影响
    const spine = deformPoint({ x: 0, y: 300 }, pose, SIZE);
    expect(spine.z).toBeCloseTo(0, 6);
  });
});
