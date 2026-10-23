/**
 * 开本适配模式
 *
 * 描述「开本尺寸（`pageSize`）怎么被用」：严格按给定 px 落地，还是某一轴跟随
 * 容器 / 窄屏视口取值。与 `page-size.ts`（页面尺寸本身）分文件：本模块只管
 * 「取法」这一层意图。
 *
 * 边界（务必留意）：本字段当前是**契约与设置面板的意图记录**，尚未驱动几何
 * ——`resolvePageMainSize` / `resolvePageCrossSize` 与度量签名都不读它，切换
 * 取值不改变分页结果，也不触发重排。几何接线（`auto` 按容器交叉轴实测、
 * `h5` 按窄屏视口取页宽）另立批次，接入时须同步把该值纳入
 * `computeMetricsSignature` 的布局参与项，否则改了适配却不重排会直接错页。
 */
import type { LayoutOptions } from './layout-options.js';

/** 开本适配取值 */
export const PAGE_SIZE_MODES = {
  /** 交叉轴自适应：横排取容器页宽、直排取容器页高（另一轴仍按开本） */
  AUTO: 'auto',
  /** 按 H5 窄屏视口取页宽（375px 级），使缩放系数趋近 1、正文回落到令牌字号 */
  H5: 'h5',
  /** 固定：严格按 `pageSize` 的宽高落地（改造前的唯一行为） */
  FIXED: 'fixed',
} as const;

/** 开本适配联合类型 */
export type PageSizeMode = (typeof PAGE_SIZE_MODES)[keyof typeof PAGE_SIZE_MODES];

/** 默认开本适配：固定（缺省语义，与引入本选项前的行为一致） */
export const DEFAULT_PAGE_SIZE_MODE: PageSizeMode = PAGE_SIZE_MODES.FIXED;

/** 取值表（运行时校验用，含历史快照里的脏值过滤） */
const PAGE_SIZE_MODE_VALUES: readonly PageSizeMode[] = Object.values(PAGE_SIZE_MODES);

/** 是否合法取值（持久化主体是自由键值，脏值一律按默认处理） */
function isPageSizeMode(value: unknown): value is PageSizeMode {
  return PAGE_SIZE_MODE_VALUES.includes(value as PageSizeMode);
}

/**
 * 解析生效的开本适配
 *
 * 缺省与非法值都回退 `DEFAULT_PAGE_SIZE_MODE`：旧快照与既有主题字面量不含该键，
 * 「缺省 = 固定」才能保证视觉零变化。读取本字段一律经此函数，不要直接判等。
 *
 * @param options 布局选项（只需 `pageSizeMode` 一项，便于局部调用）
 */
export function resolvePageSizeMode(
  options: Pick<LayoutOptions, 'pageSizeMode'>,
): PageSizeMode {
  return isPageSizeMode(options.pageSizeMode) ? options.pageSizeMode : DEFAULT_PAGE_SIZE_MODE;
}
