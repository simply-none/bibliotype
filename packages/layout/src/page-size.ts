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

/** 预设页面尺寸 */
export const PAGE_SIZES = {
  /** 国际 A4（96dpi） */
  A4: { name: 'A4', width: 794, height: 1123 },
  /** 国际 A5（96dpi） */
  A5: { name: 'A5', width: 559, height: 794 },
  /** 国际 B5（96dpi） */
  B5: { name: 'B5', width: 665, height: 945 },
  /** 16 开（传统图书常用，近似 185×260mm） */
  FOLIO_16: { name: '16开', width: 699, height: 983 },
  /** 32 开（传统图书常用，近似 130×184mm） */
  FOLIO_32: { name: '32开', width: 491, height: 695 },
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
 * 计算内容区尺寸
 *
 * @param page 页面尺寸
 * @param marginY 上下页边距（px）
 * @param marginX 左右页边距（px）
 */
export function resolveContentBox(
  page: PageSize,
  marginY: number,
  marginX: number,
): ContentBoxSize {
  const width = page.width - marginX * 2;
  const height = page.height - marginY * 2;
  if (width <= 0 || height <= 0) {
    throw new RangeError(`页边距超出页面尺寸：${page.name}`);
  }
  return { width, height };
}
