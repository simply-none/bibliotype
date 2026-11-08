/**
 * 顶点形变映射：规范平面坐标 → 3D 卷曲形变（纯函数，与 shader 同式）。
 *
 * 与云展网 / StPageFlip 同源的 page-curl 数学——页面绕折痕卷成圆柱并
 * 真实抬离桌面（z 抬升 + 透视相机产生近大远小），立体感由几何与
 * 分段着色共同表达。形变以折痕为轴做圆柱 warp：
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
  /** 卷曲相位 θ = s/r（flat 为 0）。 */
  theta: number;
}

/** 锥化半径下限（像素），仅防退化除零。 */
const R_FLOOR = 0.25;

/** 形变单点：p 为页面平面坐标（规范空间）。 */
export function deformPoint(p: Point, pose: FoldPose, size: PageSize): DeformedPoint {
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
