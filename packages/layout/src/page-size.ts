/**
 * 页面尺寸定义
 *
 * 尺寸单位统一为 CSS px（96dpi 基准）。
 * 直排页面不交换宽高（古籍版式通常为竖长条页面）。
 */

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
