/**
 * 布局配置
 *
 * 汇总排版引擎的全部可调项，是 reader / editor 与 layout 之间的契约。
 */
import { WRITING_MODES, type WritingMode } from './writing-mode.js';
import { PAGE_SIZES, type PageSize } from './page-size.js';
import {
  DEFAULT_COMBINE_OPTIONS,
  type CombineUprightOptions,
} from './combine-upright.js';

/** 页码样式 */
export const PAGE_NUMBER_STYLES = {
  /** 阿拉伯数字 */
  DECIMAL: 'decimal',
  /** 中文数字（一二三……） */
  CHINESE: 'chinese',
  /** 罗马数字 */
  ROMAN: 'roman',
} as const;

/** 页码样式联合类型 */
export type PageNumberStyle =
  (typeof PAGE_NUMBER_STYLES)[keyof typeof PAGE_NUMBER_STYLES];

/** 布局配置 */
export interface LayoutOptions {
  /** 书写方向 */
  writingMode: WritingMode;
  /** 页面尺寸 */
  pageSize: PageSize;
  /** 分栏数（1~3） */
  columns: number;
  /** 页码样式 */
  pageNumberStyle: PageNumberStyle;
  /** 数字/英文直排合并策略（D3 补充） */
  combineUpright: CombineUprightOptions;
}

/** 默认布局（现代书籍：横排、A5、单栏、阿拉伯页码） */
export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  writingMode: WRITING_MODES.HORIZONTAL_TB,
  pageSize: PAGE_SIZES.A5,
  columns: 1,
  pageNumberStyle: PAGE_NUMBER_STYLES.DECIMAL,
  combineUpright: DEFAULT_COMBINE_OPTIONS,
};

/** 古籍默认布局（直排右起、16 开、单栏、中文页码） */
export const CLASSICAL_LAYOUT_OPTIONS: LayoutOptions = {
  writingMode: WRITING_MODES.VERTICAL_RL,
  pageSize: PAGE_SIZES.FOLIO_16,
  columns: 1,
  pageNumberStyle: PAGE_NUMBER_STYLES.CHINESE,
  combineUpright: DEFAULT_COMBINE_OPTIONS,
};

/** 合并布局配置（浅合并，便于调用方覆盖局部） */
export function mergeLayoutOptions(
  base: LayoutOptions,
  patch: Partial<LayoutOptions>,
): LayoutOptions {
  return { ...base, ...patch };
}
