/**
 * 开本适配模式
 *
 * 描述「开本尺寸（`pageSize`）怎么被用」：严格按给定 px 落地，还是跟着容器 /
 * 窄屏视口取值。与 `page-size.ts`（页面尺寸本身）分文件：本模块只管「取法」这
 * 一层意图。
 *
 * 折算入口 `applyPageSizeMode` 产出的是**真实几何**（新 `pageSize` / `columns`），
 * 因而 `computeMetricsSignature` 里已有的 `宽x高` 项会自然变化 → 预览、编辑画布
 * 与导出都会重新量尺重排，无需把本字段另行纳入签名。宿主仅在「舞台可用尺寸」
 * 变化（窗口 / 侧栏拖动、旋转）时重调本函数即可。
 *
 * `auto` 两轴一起铺（而非只铺交叉轴）：分页视图按整页等比缩放（contain），只
 * 拉长页宽时页高仍顶着开本值，缩放系数会被页高压回小于 1 → 宽度看着还是没铺满。
 * 页框 = 舞台盒才能让缩放系数恰为 1，真正做到铺满且不裁切。
 */
import { createPageSize, H5_PAGE_SIZE, type PageSize } from './page-size.js';
import { isFacsimileEnabled } from './facsimile.js';
import type { LayoutOptions } from './layout-options.js';

/** 开本适配取值 */
export const PAGE_SIZE_MODES = {
  /** 版面自适应：页框铺满舞台盒（横排看宽、直排看高，面板文案按方向取词） */
  AUTO: 'auto',
  /** 按 H5 窄屏视口取页宽（340px）并强制单栏，页高铺舞台，正文回落到令牌字号 */
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

/** 舞台可用尺寸（px；宿主已扣掉容器内边距，未缩放） */
export interface StageBoxSize {
  /** 可用宽（px） */
  width: number;
  /** 可用高（px） */
  height: number;
}

/**
 * 自适应限幅（px，两轴同区间）
 *
 * 下限防「侧栏拖到底 / 量尺未就绪」排出几乎零尺寸的页（每行一个字、每页两行，
 * 页数爆炸）；上限防超宽屏（带鱼屏 / 4K）排出单行几百字、单页几十行的不可读版面。
 */
const AUTO_AXIS_MIN = 240;
const AUTO_AXIS_MAX = 1600;

/** 轴尺寸是否可用于折算（非 SSR / 非零宽） */
function usableAxis(size: number | undefined): size is number {
  return typeof size === 'number' && Number.isFinite(size) && size > 0;
}

/** 限幅到可读区间 */
function clampAxis(size: number): number {
  return Math.round(Math.min(AUTO_AXIS_MAX, Math.max(AUTO_AXIS_MIN, size)));
}

/** 取已限幅的轴值（舞台未实测时回退出参轴） */
function axisOr(size: number | undefined, fallback: number): number {
  return usableAxis(size) ? clampAxis(size) : fallback;
}

/** 剥掉上一次折算留下的后缀，避免反复自适应把页名越拖越长 */
function baseName(name: string): string {
  return name.replace(/·适应版面$/, '');
}

/** 页型是否已是目标宽高（按值比，不按引用：折算每次都会新建页型对象） */
function sameBox(page: PageSize, width: number, height: number): boolean {
  return page.width === width && page.height === height;
}

/**
 * 按开本适配折算生效布局（返回新对象，不就地改）
 *
 * - `fixed`（缺省）：原样返回——旧快照与未挂载前与改造前逐字节一致；
 * - `auto`：页框铺到舞台盒（两轴都跟，见头部说明），按 `AUTO_AXIS_MIN` /
 *   `AUTO_AXIS_MAX` 限幅；分栏不动（想吃掉过长行宽可自行加栏）；
 * - `h5`：页宽落 `H5_PAGE_SIZE`（340）+ 单栏，页高仍铺舞台 → 宽屏下像一根
 *   通高的手机页柱，等比缩放系数趋近 1，正文按令牌原尺寸落地；
 * - `stage` 缺省（SSR / 未挂载）时该轴回退原开本取值：`auto` 于是整体不动，
 *   `h5` 仍能落 340×560（它是确定值，不依赖容器实测）。
 *
 * 古籍仿真版式（`facsimile` 已启用）任何模式都不覆盖：版框 / 界行 / 版心的几何
 * 按固定开本算，改任一轴都会让界行与文字列错位。
 *
 * @param options 声明布局（主题基准 + 用户补丁）
 * @param stage 舞台可用尺寸（`auto` 两轴与 `h5` 页高取用它；缺省按回退处理）
 */
export function applyPageSizeMode(
  options: LayoutOptions,
  stage?: StageBoxSize,
): LayoutOptions {
  const mode = resolvePageSizeMode(options);
  if (mode === PAGE_SIZE_MODES.FIXED) return options;
  if (isFacsimileEnabled(options)) return options;

  const page = options.pageSize;

  if (mode === PAGE_SIZE_MODES.H5) {
    const height = axisOr(stage?.height, H5_PAGE_SIZE.height);
    if (sameBox(page, H5_PAGE_SIZE.width, height) && options.columns === 1) return options;
    const pageSize =
      height === H5_PAGE_SIZE.height
        ? H5_PAGE_SIZE
        : createPageSize(`H5　${H5_PAGE_SIZE.width}×${height}`, H5_PAGE_SIZE.width, height);
    return { ...options, pageSize, columns: 1 };
  }

  const width = axisOr(stage?.width, page.width);
  const height = axisOr(stage?.height, page.height);
  if (sameBox(page, width, height)) return options;
  return { ...options, pageSize: createPageSize(`${baseName(page.name)}·适应版面`, width, height) };
}
