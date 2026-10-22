/**
 * 断点与触控常量（H5 UI 改造 D1 / D2）
 *
 * 单一事实源：JS 侧断点判定（`useBreakpoint`）与 CSS 侧增量样式
 * （`--bt-bp-sm` / `--bt-bp-md` / `--bt-bp-lg`，见 demo `styles.css`）取同一组数值，
 * 避免两边漂移。触控目标下限同样集中在此，组件与宿主共用。
 */

/** 断点阈值（px）：sm = 窄屏、md = 移动 / 桌面分界、lg = 宽屏桌面 */
export const BT_BREAKPOINTS = {
  /** 小屏阈值：≥ 此值才认为不是「窄屏」 */
  sm: 640,
  /** 移动断点上限：< md 视作 H5（单列 + 抽屉骨架） */
  md: 768,
  /** 桌面阈值：≥ lg 才启用完整三栏 chrome */
  lg: 1024,
} as const;

/** 断点档位名 */
export type BreakpointName = 'mobile' | 'tablet' | 'desktop';

/** 触控目标最小尺寸（px，D2）：粗指针环境下的点击区下限（视觉尺寸可更小，靠 padding 补足） */
export const BT_TOUCH_TARGET_MIN = 44;

/**
 * 由视口宽度推导断点档位（纯函数）
 *
 * @param width 视口宽度（px）
 */
export function resolveBreakpointName(width: number): BreakpointName {
  if (width < BT_BREAKPOINTS.md) return 'mobile';
  if (width < BT_BREAKPOINTS.lg) return 'tablet';
  return 'desktop';
}
