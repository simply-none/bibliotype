/**
 * 页面帧映射：屏幕空间 ↔ 规范空间（纯函数）。
 *
 * 规范空间约定书脊恒在 x=0、自由边恒在 x=W；实际装订侧由 BindEdge 声明，
 * 四种映射把屏幕页面矩形变换到规范空间（几何求解全部在规范空间进行）：
 *
 * - left：恒等（屏幕即规范）；
 * - right：X 镜像（sx = Sw − cx）；
 * - top：转置（sx = cy, sy = cx）——规范竖直书脊映射为屏幕水平书脊（上缘）；
 * - bottom：转置 + X 镜像（sx = cy, sy = W_c − cx）——书脊落在屏幕下缘。
 *
 * 所有映射均为等距反射（|det| = 1），页面面积与抓取距离在两空间一致。
 */

import type { BindEdge, PageSize, Point } from './types.js';

/** 由 provider 解析装订侧：显式 bindEdge 优先，否则按 orientation 映射。 */
export function resolveBindEdge(provider?: {
  bindEdge?: BindEdge;
  orientation?: 'ltr' | 'rtl';
}): BindEdge {
  if (provider?.bindEdge) {
    return provider.bindEdge;
  }
  return provider?.orientation === 'rtl' ? 'right' : 'left';
}

/** 规范空间页面尺寸：左右装订与屏幕同形，上下装订为屏幕的转置。 */
export function canonicalSize(screen: PageSize, edge: BindEdge): PageSize {
  return edge === 'top' || edge === 'bottom'
    ? { width: screen.height, height: screen.width }
    : { width: screen.width, height: screen.height };
}

/** 屏幕页面内坐标（相对页面矩形左上角）→ 规范空间坐标。 */
export function screenToCanonical(local: Point, screen: PageSize, edge: BindEdge): Point {
  switch (edge) {
    case 'right':
      return { x: screen.width - local.x, y: local.y };
    case 'top':
      return { x: local.y, y: local.x };
    case 'bottom':
      // screen = (cy, W_c − cx)，W_c = 屏幕高 → 逆映射 cx = Sh − sy
      return { x: screen.height - local.y, y: local.x };
    default:
      return { x: local.x, y: local.y };
  }
}

/** 规范空间坐标 → 屏幕页面内坐标（相对页面矩形左上角）。 */
export function canonicalToScreen(canonical: Point, screen: PageSize, edge: BindEdge): Point {
  switch (edge) {
    case 'right':
      return { x: screen.width - canonical.x, y: canonical.y };
    case 'top':
      return { x: canonical.y, y: canonical.x };
    case 'bottom':
      return { x: canonical.y, y: screen.height - canonical.x };
    default:
      return { x: canonical.x, y: canonical.y };
  }
}

/**
 * 顶点着色器的帧分支编号（0..3 = left/right/top/bottom）：
 * world.xy = frameWorld(pos2)，z 抬升不受帧影响。
 * uSize 传规范尺寸 (W_c, H_c)：
 * - left：   world = ( cx − W_c/2, H_c/2 − cy )
 * - right：  world = ( W_c/2 − cx, H_c/2 − cy )
 * - top：    world = ( cy − H_c/2, W_c/2 − cx )
 * - bottom： world = ( cy − H_c/2, cx − W_c/2 )
 */
export function frameIndex(edge: BindEdge): number {
  switch (edge) {
    case 'right':
      return 1;
    case 'top':
      return 2;
    case 'bottom':
      return 3;
    default:
      return 0;
  }
}
