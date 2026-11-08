/**
 * 顶点形变映射：规范平面坐标 → 3D 形变（纯函数，与 shader 同式）。
 *
 * 两种模型（FoldModel）：
 *
 * **rotation（刚体旋转，edge 抓取 / 滑动 / 自动翻页）**——页面绕书脊
 * （规范 x=0）刚体旋转 φ，自由边带卷筒 χ（半径 r），中段叠加飞行拱；
 * 真实书本硬页翻转：页面立起、透视缩短、自由边为最高点、最后落桌。
 * 截面（材料距书脊 d = p.x）：
 * 1. d ≤ d_c（刚体段）：沿页向 T=(cosφ,sinφ) 伸出 d，法向偏移 0——
 *    x' = d·cosφ，z = d·sinφ；
 * 2. d > d_c（卷筒段）：绕铰链 d_c 处半径 r 的圆筒卷包角 θ=(d−d_c)/r ≤ χ
 *    ——位置 = 铰链 + r·sinθ·T + r·(1−cosθ)·N（N=(−sinφ,cosφ)），
 *    切向角连续增至 φ+χ（C1 衔接）；
 * 3. 飞行拱：全程沿 N 叠加 bow·sin(π·d/W)。
 *
 * **fold（折痕卷折，corner 捏角折角模型）**——与云展网 / StPageFlip
 * 同源的 page-curl 数学——页面绕折痕卷成圆柱并真实抬离桌面（z 抬升
 * + 透视相机产生近大远小），立体感由几何与分段着色共同表达。形变以
 * 折痕为轴做圆柱 warp：
 *
 *   pos = creaseOrigin + creaseDir·ξ + n̂·f(s)，ξ = (p−creaseOrigin)·creaseDir
 *
 * **切向分量 ξ 必须保留**——只映射法向距离 s 会把整个翻动页塌缩成
 * 一条一维曲线（曲面消失，只剩阴影）。
 *
 * 1. s ≤ 0（折痕桌面料）：原位不动，z = 0；
 * 2. 0 < θ = s/r ≤ π（卷曲压缩段）：f = n̂·r·sinθ，z = r·(1−cosθ)——
 *    沿圆柱面爬升，θ=π/2 达最远 r、最高 r，θ=π 折回折痕正上方（高度 2r）；
 * 3. s > r·π（背面斜披段）：f = −n̂·(s − r·π)，z = 2r·(1 − (s−rπ)/(strength−rπ))
 *    ——自卷顶沿 −n̂ 直线展开并斜披到桌面，内容呈镜像（背面）。
 *
 * 卷曲段与背面段在 θ=π 处 C0 连续（位置与高度同时衔接）。
 * 卷曲半径沿折痕轴向锥化（角部抓取的圆锥感，卷筒随之扭转）。
 */

import type { FoldPose, PageSize, Point } from './types';

/** 材料面标识：flat = 桌面料；curl = 卷曲压缩段；back = 背面斜披段。 */
export type CurlFace = 'flat' | 'curl' | 'back';

export interface DeformedPoint {
  x: number;
  y: number;
  /** 抬升高度（世界单位 = CSS px，朝观察者为正）。 */
  z: number;
  /** 材料面标识（着色分段依据）。 */
  face: CurlFace;
  /** 卷曲相位 θ = s/r；rotation 模型携带局部表面角（φ+卷角）。 */
  theta: number;
}

/** 锥化半径下限（像素），仅防退化除零。 */
const R_FLOOR = 0.25;

/** 形变单点：p 为页面平面坐标（规范空间）。 */
export function deformPoint(p: Point, pose: FoldPose, size: PageSize): DeformedPoint {
  if (pose.model === 'rotation') {
    return deformRotationPoint(p, pose, size);
  }
  return deformFoldPoint(p, pose, size);
}

/**
 * rotation 模型单点：绕书脊刚体旋转 + 自由边卷筒 + 飞行拱（与顶点
 * 着色器同式）。y（书脊轴向）不变；face：刚体段 flat / 卷筒段 curl。
 */
function deformRotationPoint(p: Point, pose: FoldPose, size: PageSize): DeformedPoint {
  const d = p.x;
  const phi = pose.flipAngle;
  const chi = pose.curlAngle;
  const r = Math.max(pose.radius, R_FLOOR);
  const rollMaterial = r * chi;
  const hinge = Math.max(size.width - rollMaterial, 0);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  let along: number; // 沿页向 T=(cosφ,sinφ) 的距离（自书脊）
  let nOff: number; // 沿页法向 N=(−sinφ,cosφ) 的偏移
  let localAngle: number;
  if (d <= hinge) {
    along = d;
    nOff = 0;
    localAngle = phi;
  } else {
    const theta = Math.min((d - hinge) / r, chi);
    along = hinge + r * Math.sin(theta);
    nOff = r * (1 - Math.cos(theta));
    localAngle = phi + theta;
  }
  // 飞行拱：沿页法向弓出（中段最大，两端归零）
  nOff += pose.bow * Math.sin(Math.PI * Math.min(Math.max(d / size.width, 0), 1));
  const x = along * cosPhi - nOff * sinPhi;
  const z = along * sinPhi + nOff * cosPhi;
  return { x, y: p.y, z, face: d <= hinge ? 'flat' : 'curl', theta: localAngle };
}

/** fold 模型单点：折痕圆柱 warp（三段式）。 */
function deformFoldPoint(p: Point, pose: FoldPose, size: PageSize): DeformedPoint {
  const relX = p.x - pose.creaseOrigin.x;
  const relY = p.y - pose.creaseOrigin.y;
  const s = relX * pose.wrapNormal.x + relY * pose.wrapNormal.y;

  // 桌面料：原位
  if (s <= 0) {
    return { x: p.x, y: p.y, z: 0, face: 'flat', theta: 0 };
  }

  // 切向（折痕平行）坐标：px
  const xiPx = relX * pose.creaseDir.x + relY * pose.creaseDir.y;
  const xi = xiPx / size.height;
  const tangentialX = pose.creaseDir.x * xiPx;
  const tangentialY = pose.creaseDir.y * xiPx;

  // 锥化半径：沿折痕轴 ξ 线性变化
  const r = Math.max(pose.radius * (1 - pose.taper * xi), R_FLOOR);

  const theta = s / r;
  let along: number;
  let z: number;
  let face: CurlFace;
  if (theta <= Math.PI) {
    // 卷曲压缩段：绕贴桌圆柱爬升（θ=π 折回折痕正上方，高度 2r）
    along = r * Math.sin(theta);
    z = r * (1 - Math.cos(theta));
    face = 'curl';
  } else {
    // 背面斜披段：镜像展开到折痕另一侧，自卷顶 2r 斜披到自由边触桌——
    // 下落用 smoothstep（弧顶/触桌两端零斜率：与卷曲段 C1 衔接、近桌减速），
    // 叠加 sin² 弧拱（真实纸张前冲弧线，两端亦零斜率）
    const over = s - r * Math.PI;
    const backSpan = Math.max(pose.strength - r * Math.PI, 1);
    const backFrac = Math.min(Math.max(over / backSpan, 0), 1);
    along = -over;
    const ease = backFrac * backFrac * (3 - 2 * backFrac);
    const arc = Math.sin(Math.PI * backFrac) ** 2;
    z = 2 * r * (1 - ease) + pose.drapeBulge * arc;
    face = 'back';
  }
  let x = pose.creaseOrigin.x + tangentialX + pose.wrapNormal.x * along;
  const y = pose.creaseOrigin.y + tangentialY + pose.wrapNormal.y * along;
  return { x, y, z, face, theta };
}
