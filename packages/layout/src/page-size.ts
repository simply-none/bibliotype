/**
 * 页面尺寸定义
 *
 * 尺寸单位统一为 CSS px（96dpi 基准）。
 * 直排页面不交换宽高（古籍版式通常为竖长条页面）。
 */
import { LAYOUT_TOKENS } from '@bibliotype/core';

/** 页面尺寸 */
export interface PageSize {
  /** 尺寸名称（预设名或自定义名） */
  name: string;
  /** 宽度（px） */
  width: number;
  /** 高度（px） */
  height: number;
}

/** 预设页面尺寸（含国际 ISO 与中国出版常用开本；mm→px @96dpi，px ≈ mm × 3.7795） */
export const PAGE_SIZES = {
  /** 国际 A4（210×297mm） */
  A4: { name: 'A4　210×297', width: 794, height: 1123 },
  /** 国际 A5（148×210mm） */
  A5: { name: 'A5　148×210', width: 559, height: 794 },
  /** 国际 B5（176×250mm） */
  B5: { name: 'B5　176×250', width: 665, height: 945 },
  /** 大度 16 开（889×1194 纸，成品 210×285mm） */
  DACHU_16: { name: '大16开　210×285', width: 794, height: 1077 },
  /** 正度 16 开（787×1092 纸，成品 185×260mm；传统图书常用） */
  FOLIO_16: { name: '正16开　185×260', width: 699, height: 983 },
  /** 大度 32 开（成品 140×203mm） */
  DACHU_32: { name: '大32开　140×203', width: 529, height: 767 },
  /** 正度 32 开（成品 130×184mm；传统图书常用） */
  FOLIO_32: { name: '正32开　130×184', width: 491, height: 695 },
} as const satisfies Record<string, PageSize>;

/** 创建自定义页面尺寸 */
export function createPageSize(
  name: string,
  width: number,
  height: number,
): PageSize {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`页面尺寸必须为正数：${name} ${width}×${height}`);
  }
  return { name, width, height };
}

/**
 * H5 手机页（340×560）
 *
 * 供 `PAGE_SIZE_MODES.H5` 折算用：340 页宽在 375px 视口下等比缩放系数趋近 1，
 * 正文因此按令牌原尺寸落地（而不是被缩小到不可读）。不是印刷开本，故不进
 * `PAGE_SIZES` 预设表（避免出现在开本下拉里）。
 */
export const H5_PAGE_SIZE: PageSize = createPageSize('H5　340×560', 340, 560);

/** 页面内容区尺寸（扣除页边距后的可用区域） */
export interface ContentBoxSize {
  width: number;
  height: number;
}

/**
 * 页边距四边盒（px，物理边）
 *
 * 与 CSS `padding` / `@page margin` 简写同源：渲染侧按四边独立内缩，
 * 分页 / 量尺侧必须按同样的四边扣减，否则左右（直排主轴）或上下
 * （横排主轴）不对称时，分页版心与真实版心错位 → 正文溢出边距。
 */
export interface PageMarginBox {
  /** 上（px） */
  top: number;
  /** 右（px） */
  right: number;
  /** 下（px） */
  bottom: number;
  /** 左（px） */
  left: number;
}

/**
 * 计算内容区尺寸
 *
 * 按四边独立扣减（width = 页宽 − 左 − 右，height = 页高 − 上 − 下），
 * 与渲染侧 `padding` 简写逐边对齐；四边相等时与旧「marginX×2」口径等价。
 *
 * @param page 页面尺寸
 * @param margins 页边距四边盒（px）
 */
export function resolveContentBox(
  page: PageSize,
  margins: PageMarginBox,
): ContentBoxSize {
  const width = page.width - margins.left - margins.right;
  const height = page.height - margins.top - margins.bottom;
  if (width <= 0 || height <= 0) {
    throw new RangeError(`页边距超出页面尺寸：${page.name}`);
  }
  return { width, height };
}

/**
 * 解析页边距令牌为四边盒（px）
 *
 * 支持 CSS `padding` 简写的 1~4 值形态（与 `buildPageStyle` 透传给 CSS 的语义
 * 一致，均为物理边）：
 * - 1 值 `a`：四边均 `a`；
 * - 2 值 `a b`：上下 `a`、左右 `b`；
 * - 3 值 `a b c`：上 `a`、左右 `b`、下 `c`；
 * - 4 值 `a b c d`：上 `a`、右 `b`、下 `c`、左 `d`。
 *
 * 仅支持 px：非 px 单位（em / % 等）会使「分页主轴 = 页宽/高 − 边距」与 CSS
 * 实际版心错位（`buildPageStyle` 原样透传，浏览器按 em 计算 padding），导致
 * 系统性溢出裁切，故显式拒绝而非静默按数字截取。令牌缺省时四边均 0
 * （与 `buildPageStyle` 缺省不内缩的渲染语义一致）。
 *
 * 放在本模块（而非样式构建器）是因为它只解析「页面几何」，且供分页度量
 * 与仿真几何共用，避免样式构建器与仿真几何互相依赖成环。
 *
 * @param tokens 主题令牌值表
 * @throws RangeError 当令牌含非 px 单位值。
 */
export function resolvePageMarginBox(
  tokens: Readonly<Record<string, string | undefined>>,
): PageMarginBox {
  const raw = tokens[LAYOUT_TOKENS.PAGE_MARGIN];
  if (raw === undefined || raw.trim() === '') return { top: 0, right: 0, bottom: 0, left: 0 };
  const values = raw
    .trim()
    .split(/\s+/)
    .map((part) => {
      const match = /^(-?\d+(?:\.\d+)?)px$/.exec(part);
      if (match === null) {
        throw new RangeError(`page-margin 令牌仅支持 px 单位（如 "48px 56px"），收到："${raw}"`);
      }
      return Number(match[1]);
    });
  const [v0, v1, v2, v3] = values;
  // CSS 简写逐边展开（缺省回退到已给定的对边 / 同轴值）
  const top = v0 ?? 0;
  const right = v1 ?? top;
  const bottom = v2 ?? top;
  const left = v3 ?? right;
  return { top, right, bottom, left };
}
