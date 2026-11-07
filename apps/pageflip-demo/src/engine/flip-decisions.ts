/**
 * 翻页决策纯函数：抓取区判定与松手决策。
 * 从控制器中抽出，便于单元测试与后续调参。
 */
import type { FlipAction, FlipConfig, GrabMode, PageSize, Point } from './types';

/** 数值钳制。 */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 抓取区（规范空间）。 */
export interface GrabZone {
  mode: GrabMode;
  action: FlipAction;
  grab: Point;
}

export interface GrabZoneOptions {
  /** 角部抓取半径。 */
  cornerRadius: number;
  /** 边缘带宽度占比（相对页宽）。 */
  edgeRatio: number;
}

const EDGE_Y_CLAMP = 0.15;

/**
 * 判定触点所属抓取区：角部（近四角，捏角斜翻）优先，其次两侧边缘带
 * （捏边翻页，折痕平行书脊）；页面中部返回 null。
 * 纯几何判定，不考虑翻页可用性——边界方向由控制器以橡皮筋进度上限承接。
 */
export function resolveGrabZone(touch: Point, size: PageSize, options: GrabZoneOptions): GrabZone | null {
  const { width: w, height: h } = size;
  const corners: GrabZone[] = [
    { grab: { x: w, y: 0 }, mode: 'corner', action: 'forward' },
    { grab: { x: w, y: h }, mode: 'corner', action: 'forward' },
    { grab: { x: 0, y: 0 }, mode: 'corner', action: 'backward' },
    { grab: { x: 0, y: h }, mode: 'corner', action: 'backward' },
  ];
  let best: GrabZone | null = null;
  let bestDist = options.cornerRadius;
  for (const corner of corners) {
    const d = Math.hypot(touch.x - corner.grab.x, touch.y - corner.grab.y);
    if (d < bestDist) {
      bestDist = d;
      best = corner;
    }
  }
  if (best) {
    return best;
  }
  if (touch.x > w * (1 - options.edgeRatio)) {
    return { mode: 'edge', action: 'forward', grab: { x: w, y: clamp(touch.y, h * EDGE_Y_CLAMP, h * (1 - EDGE_Y_CLAMP)) } };
  }
  if (touch.x < w * options.edgeRatio) {
    return { mode: 'edge', action: 'backward', grab: { x: 0, y: clamp(touch.y, h * EDGE_Y_CLAMP, h * (1 - EDGE_Y_CLAMP)) } };
  }
  return null;
}

/** 松手决策：进度越过阈值或甩动速度达标 → 完成翻页；否则回弹。 */
export function decideRelease(
  progress: number,
  axisVelocity: number,
  config: Pick<FlipConfig, 'completeProgress' | 'flickVelocity'>
): 'complete' | 'cancel' {
  if (progress >= 1) {
    return 'complete';
  }
  if (progress > config.completeProgress || axisVelocity > config.flickVelocity) {
    return 'complete';
  }
  return 'cancel';
}

/** snap 补间时长：随剩余距离缩放。 */
export function snapDurationFor(remaining: number): number {
  return Math.min(Math.max(240 + 340 * remaining, 220), 540);
}
