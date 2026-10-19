/**
 * 浮动菜单定位（纯函数）
 *
 * 与书写方向无关：只消费视口坐标，横排 / 直排共用。策略与 demo 的
 * `ToolbarUsageTip.place()` 一致：默认显示在锚点上方，上方空间不足翻到下方；
 * 水平居中并夹紧到视口内。
 */

/** 视口矩形（DOMRect 的最小子集） */
export interface FloatingRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 尺寸 */
export interface FloatingSize {
  width: number;
  height: number;
}

/** 定位结果 */
export interface FloatingPlacement {
  top: number;
  left: number;
  placement: 'top' | 'bottom';
}

/**
 * 计算浮动菜单位置
 *
 * @param anchor 选区矩形（视口坐标）
 * @param menu 菜单实测尺寸
 * @param viewport 视口尺寸
 * @param gap 锚点与菜单的间距（默认 8）
 * @param edge 视口安全边距（默认 8）
 */
export function placeFloating(
  anchor: FloatingRect,
  menu: FloatingSize,
  viewport: FloatingSize,
  gap = 8,
  edge = 8,
): FloatingPlacement {
  const above = anchor.top - gap - menu.height;
  const below = anchor.top + anchor.height + gap;
  const fitsAbove = above >= edge;
  const fitsBelow = below + menu.height <= viewport.height - edge;

  let placement: 'top' | 'bottom';
  if (fitsAbove) {
    placement = 'top';
  } else if (fitsBelow) {
    placement = 'bottom';
  } else {
    // 两侧都放不下：取剩余空间更大的一侧
    const spaceAbove = anchor.top - gap - edge;
    const spaceBelow = viewport.height - edge - below;
    placement = spaceAbove >= spaceBelow ? 'top' : 'bottom';
  }

  const maxLeft = Math.max(edge, viewport.width - menu.width - edge);
  const centered = anchor.left + anchor.width / 2 - menu.width / 2;
  const left = Math.min(Math.max(centered, edge), maxLeft);

  const rawTop = placement === 'top' ? above : below;
  const maxTop = Math.max(edge, viewport.height - menu.height - edge);
  const top = Math.min(Math.max(rawTop, edge), maxTop);

  return { top, left, placement };
}
