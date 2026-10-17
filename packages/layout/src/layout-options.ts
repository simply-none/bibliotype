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

/** 页眉 / 页脚内容字段 */
export const PAGE_CHROME_FIELDS = {
  /** 不显示 */
  NONE: 'none',
  /** 书名 */
  BOOK_TITLE: 'bookTitle',
  /** 当前章名 */
  CHAPTER_TITLE: 'chapterTitle',
  /** 页码 */
  PAGE_NUMBER: 'pageNumber',
} as const;

/** 页眉 / 页脚字段 */
export type PageChromeField = (typeof PAGE_CHROME_FIELDS)[keyof typeof PAGE_CHROME_FIELDS];

/**
 * 页眉 / 页脚配置
 *
 * 关键点：页眉页脚**占用版心**。开启后 `resolvePageMainSize` 会从主轴尺寸里
 * 扣掉 `headerSize + footerSize`，否则页眉会压在正文第一行上（分页按整页高排，
 * 渲染时才发现被遮住）。缺省（`undefined`）表示不启用，行为与改造前完全一致。
 */
export interface PageChromeOptions {
  /** 页眉内容 */
  header: PageChromeField;
  /** 页脚内容 */
  footer: PageChromeField;
  /** 页眉占用高度（px，0 表示不占位） */
  headerSize: number;
  /** 页脚占用高度（px，0 表示不占位） */
  footerSize: number;
  /** 奇偶页不同（偶数页使用 headerEven / footerEven；未给则复用奇数页内容） */
  mirror?: boolean;
  /** 偶数页页眉 */
  headerEven?: PageChromeField;
  /** 偶数页页脚 */
  footerEven?: PageChromeField;
}

/** 默认页眉页脚（不启用，与改造前行为一致） */
export const DEFAULT_PAGE_CHROME: PageChromeOptions = {
  header: PAGE_CHROME_FIELDS.NONE,
  footer: PAGE_CHROME_FIELDS.NONE,
  headerSize: 0,
  footerSize: 0,
};

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
  /** 页眉 / 页脚（可选；缺省不启用） */
  pageChrome?: PageChromeOptions;
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
