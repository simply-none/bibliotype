/**
 * 侧栏宽度（纯函数）
 *
 * 拖拽 / 方向键 / 复位的算术集中在此，组件只负责事件与渲染：
 * - 宽度恒被夹在 [min, max]，避免拖出屏幕或压没正文；
 * - 键盘步进按 `step` 累加后再夹取，长按方向键不会累积越界误差。
 */

/** 默认最小宽度（px） */
export const SIDEBAR_MIN_WIDTH = 180;
/** 默认最大宽度（px） */
export const SIDEBAR_MAX_WIDTH = 520;
/** 键盘单次步进（px） */
export const SIDEBAR_STEP = 16;
/** 默认宽度（双击复位目标，px） */
export const SIDEBAR_DEFAULT_WIDTH = 280;

/** 侧栏宽度范围 */
export interface SidebarWidthRange {
  /** 最小宽度（缺省 {@link SIDEBAR_MIN_WIDTH}） */
  min?: number;
  /** 最大宽度（缺省 {@link SIDEBAR_MAX_WIDTH}） */
  max?: number;
}

/** 夹取宽度到合法范围；非法输入（NaN / 非数值）回退最小值 */
export function clampSidebarWidth(width: number, range: SidebarWidthRange = {}): number {
  const min = range.min ?? SIDEBAR_MIN_WIDTH;
  const max = Math.max(min, range.max ?? SIDEBAR_MAX_WIDTH);
  const value = Number.isFinite(width) ? width : min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 按步数调整宽度
 *
 * @param width 当前宽度
 * @param steps 步数（正数变宽，负数变窄；小数按四舍五入取整步）
 * @param range 宽度范围
 * @param step 单步像素（缺省 {@link SIDEBAR_STEP}）
 */
export function stepSidebarWidth(
  width: number,
  steps: number,
  range: SidebarWidthRange = {},
  step: number = SIDEBAR_STEP,
): number {
  const delta = Math.round(steps) * step;
  return clampSidebarWidth(width + delta, range);
}
