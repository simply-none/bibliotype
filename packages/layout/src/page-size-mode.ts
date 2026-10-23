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
 * 「自适应」拆成显式绑轴两档（`width` / `height`），它们是**视图缩放**而非几何折算：
 * 页框与分栏保持开本不动，`resolvePageFitScale` 按「舞台 / 开本」算出整页倍率
 * （PDF「适合宽度 / 高度」语义），文字、版心、页脚全部跟着等比缩放——此前把
 * 档位折成页框重排的做法只会改变行宽 / 行数，字号仍按令牌落地，观感上“字体
 * 没跟着缩放”。`h5` 则仍是真实重排（窄页单栏、方便阅读），两种机制分路。
 */
import { createPageSize, H5_PAGE_SIZE, type PageSize } from './page-size.js';
import { isFacsimileEnabled } from './facsimile.js';
import type { LayoutOptions } from './layout-options.js';

/** 开本适配取值 */
export const PAGE_SIZE_MODES = {
  /** 自适应宽度：视图按「舞台宽 / 页宽」整体缩放（页框与分页不动，PDF 适宽） */
  WIDTH: 'width',
  /** 自适应高度：视图按「舞台高 / 页高」整体缩放（页框与分页不动，PDF 适高） */
  HEIGHT: 'height',
  /** 网页式布局：页框取舞台可视宽高（回退 340×560）+ 强制单栏，文字按令牌原尺寸 */
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
 * 舞台轴值直接取用（网页式布局：页框跟随容器可视宽高，不设可读限幅；
 * 舞台未实测 / 非法时回退 `H5_PAGE_SIZE` 出参轴；取整防小数页型）
 */
function axisOr(size: number | undefined, fallback: number): number {
  return usableAxis(size) ? Math.round(size) : fallback;
}

/** 轴尺寸是否可用于折算（非 SSR / 非零宽） */
function usableAxis(size: number | undefined): size is number {
  return typeof size === 'number' && Number.isFinite(size) && size > 0;
}

/** 页型是否已是目标宽高（按值比，不按引用：折算每次都会新建页型对象） */
function sameBox(page: PageSize, width: number, height: number): boolean {
  return page.width === width && page.height === height;
}

/** 视图缩放限幅（倍率，PDF 缩放惯例区间） */
const FIT_SCALE_MIN = 0.2;
const FIT_SCALE_MAX = 4;

/**
 * 按开本适配算「整页视图缩放倍率」（`width` / `height` / `h5` 档）
 *
 * 页框与分页几何**不动**，宿主把返回值作为整体缩放系数（transform scale）用在
 * 预览 / 编辑画布上——文字、版心、页脚全部跟着等比缩放，即 PDF「适合宽度 /
 * 适合高度」的效果。`fixed` 返回 `undefined` = 不覆盖，视图按自身适配策略
 * （contain 且 ≤1）缩放；量不到同名轴同样 `undefined`。
 *
 * `h5` 档恒返回 `1`：页框已由 `applyPageSizeMode` 按舞台可视宽高落地，视图不缩放，
 * 文字保持预设字号（不交给 contain——测量摩擦会让它轻微缩字）；舞台未量到时
 * 返回 `undefined`（未挂载阶段几何与缩放都未就绪）。
 *
 * 仿真版式不禁用本倍率：width / height 档页框恒为开本、整页 transform 等比缩放，
 * 版框 / 界行 / 文字一起缩，不会错位（仿真只锁 `h5` 的几何折算，见下）。
 *
 * 倍率保留三位小数：防浮点尾差让宿主每帧都收到“新值”而白重渲染。
 *
 * @param options 生效布局（`width` / `height` 档下页型就是声明的开本）
 * @param stage 舞台可用尺寸（`width` 取宽轴、`height` 取高轴）
 */
export function resolvePageFitScale(
  options: LayoutOptions,
  stage?: StageBoxSize,
): number | undefined {
  const mode = resolvePageSizeMode(options);
  if (mode === PAGE_SIZE_MODES.H5) {
    return usableAxis(stage?.width) && usableAxis(stage?.height) ? 1 : undefined;
  }
  if (mode !== PAGE_SIZE_MODES.WIDTH && mode !== PAGE_SIZE_MODES.HEIGHT) return undefined;
  const bindHeight = mode === PAGE_SIZE_MODES.HEIGHT;
  const avail = bindHeight ? stage?.height : stage?.width;
  const pageAxis = bindHeight ? options.pageSize.height : options.pageSize.width;
  if (!usableAxis(avail) || !usableAxis(pageAxis)) return undefined;
  const raw = Math.min(FIT_SCALE_MAX, Math.max(FIT_SCALE_MIN, avail / pageAxis));
  return Math.round(raw * 1000) / 1000;
}

/**
 * 按开本适配折算生效布局（返回新对象，不就地改）
 *
 * 只有 `h5` 会动几何；`width` / `height` 是视图缩放档，页框与分栏**原样返回**
 * （倍率走 `resolvePageFitScale`，不进度量签名、不触发重排）。
 *
 * - `fixed`（缺省）/ `width` / `height`：原样返回——旧快照与未挂载前与改造前逐字节一致；
 * - `h5`：网页式布局——页框直接取舞台可视宽高（宽高都跟随，不设可读限幅）+
 *   强制单栏，文字按令牌原尺寸落地（视图缩放恒 1，见 `resolvePageFitScale`）；
 * - `stage` 缺省（SSR / 未挂载）时：`h5` 回退出参轴 `H5_PAGE_SIZE`（340×560，
 *   是确定值，不依赖容器实测）。
 *
 * 古籍仿真版式只锁几何折算（`h5` 档不覆盖）：版框 / 界行 / 版心的几何按固定开本
 * 算，改任一轴都会让界行与文字列错位；`width` / `height` 档不改几何、整页
 * transform 等比缩放（版框随缩放保真），与仿真兼容，不做拦截。
 *
 * @param options 声明布局（主题基准 + 用户补丁）
 * @param stage 舞台可用尺寸（仅 `h5` 页高取用；缺省按回退处理）
 */
export function applyPageSizeMode(
  options: LayoutOptions,
  stage?: StageBoxSize,
): LayoutOptions {
  const mode = resolvePageSizeMode(options);
  /* fixed 原样；width / height 只驱动视图缩放（resolvePageFitScale），不改几何 */
  if (mode !== PAGE_SIZE_MODES.H5) return options;
  if (isFacsimileEnabled(options)) return options;

  const page = options.pageSize;
  /* 网页式布局：页框 = 舞台可视宽高（宽高都跟随），文字按令牌原尺寸落地 */
  const width = axisOr(stage?.width, H5_PAGE_SIZE.width);
  const height = axisOr(stage?.height, H5_PAGE_SIZE.height);
  if (sameBox(page, width, height) && options.columns === 1) return options;
  const pageSize =
    width === H5_PAGE_SIZE.width && height === H5_PAGE_SIZE.height
      ? H5_PAGE_SIZE
      : createPageSize(`H5　${width}×${height}`, width, height);
  return { ...options, pageSize, columns: 1 };
}
