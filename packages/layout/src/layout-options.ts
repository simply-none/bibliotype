/**
 * 布局配置
 *
 * 汇总排版引擎的全部可调项，是 reader / editor 与 layout 之间的契约。
 */
import { WRITING_MODES, type WritingMode } from './writing-mode.js';
import { PAGE_SIZES, type PageSize } from './page-size.js';
import { PAGE_SIZE_MODES, type PageSizeMode } from './page-size-mode.js';
import {
  DEFAULT_COMBINE_OPTIONS,
  type CombineUprightOptions,
} from './combine-upright.js';
import type { FacsimileOptions } from './facsimile.js';

/** 页码样式 */
export const PAGE_NUMBER_STYLES = {
  /** 阿拉伯数字 */
  DECIMAL: 'decimal',
  /** 中文数字（一二三……） */
  CHINESE: 'chinese',
  /** 罗马数字 */
  ROMAN: 'roman',
  /** 叶次 a/b（一叶两半叶：第 X 叶·上 / 下，筒子叶页码体系） */
  LEAF_AB: 'leaf-ab',
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
  /** 当前卷名（版心卷次；页眉页脚同样可用） */
  VOLUME_TITLE: 'volumeTitle',
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

/**
 * 页底溢出（末行允许伸入下边距的量）
 *
 * 传统装箱把版心底当硬墙：剩余空间不足一整行就换页，页底恒留 0~1 行空白；
 * 若再叠加孤寡行约束，可留到 1~2 行。本选项把「换页线」从版心底下移一段，
 * 让末行适度侵入下边距（现实排版中页底留白本就小于天头）。
 *
 * 两个字段同时给出时 `px` 优先；解析与上限截断见 `resolveBottomSlack`
 * （绝不越过页码带顶缘）。
 */
export interface BottomSlackOptions {
  /** 固定像素（形如 page-margin 令牌，仅支持 px） */
  px?: number;
  /** 行高倍数（0.5 → 半行；与 `px` 二选一） */
  lines?: number;
}

/** 默认页底溢出：半行（`{ px: 0 }` 表示关闭，行为与引入本选项前一致） */
export const DEFAULT_BOTTOM_SLACK: BottomSlackOptions = { lines: 0.5 };

/** 布局配置 */
export interface LayoutOptions {
  /** 书写方向 */
  writingMode: WritingMode;
  /** 页面尺寸 */
  pageSize: PageSize;
  /** 分栏数（1~3） */
  columns: number;
  /**
   * 开本适配（缺省 `PAGE_SIZE_MODES.FIXED` = 严格按 pageSize 取几何）
   *
   * 可选而非必填：旧快照与已持久化补丁无该键，缺省语义即「固定」，
   * 读取一律经 `resolvePageSizeMode`，不要直接判等。生效靠宿主把声明布局与
   * 舞台尺寸交给 `applyPageSizeMode` 折算出真实 `pageSize` / `columns`（进而
   * 改变度量签名与分页归属），样式构建本身不读本字段。
   */
  pageSizeMode?: PageSizeMode;
  /** 页码样式 */
  pageNumberStyle: PageNumberStyle;
  /** 数字/英文直排合并策略（D3 补充） */
  combineUpright: CombineUprightOptions;
  /** 页眉 / 页脚（可选；缺省不启用） */
  pageChrome?: PageChromeOptions;
  /**
   * 页底溢出（缺省 `DEFAULT_BOTTOM_SLACK` 半行）
   *
   * 分页可用容量 = 版心高 + 本值（截断到不压页码带）。传 `{ px: 0 }` 关闭。
   */
  bottomSlack?: BottomSlackOptions;
  /**
   * 古籍仿真版式（版框 / 界行 / 版心）
   *
   * 缺省 `undefined` = 未启用：现代横排与「古籍直排」走改造前的原路径，
   * CSS、版心尺寸与度量签名逐字符/逐数值不变。启用后仅版心带宽参与分页，
   * 版框与界行属于绘制层、不侵占版心（见 facsimile-geometry）。
   */
  facsimile?: FacsimileOptions;
}

/** 默认布局（现代书籍：横排、A5、单栏、阿拉伯页码） */
export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  writingMode: WRITING_MODES.HORIZONTAL_TB,
  pageSize: PAGE_SIZES.A5,
  columns: 1,
  pageSizeMode: PAGE_SIZE_MODES.FIXED,
  pageNumberStyle: PAGE_NUMBER_STYLES.DECIMAL,
  combineUpright: DEFAULT_COMBINE_OPTIONS,
  bottomSlack: DEFAULT_BOTTOM_SLACK,
};

/** 古籍默认布局（直排右起、16 开、单栏、中文页码） */
export const CLASSICAL_LAYOUT_OPTIONS: LayoutOptions = {
  writingMode: WRITING_MODES.VERTICAL_RL,
  pageSize: PAGE_SIZES.FOLIO_16,
  columns: 1,
  pageSizeMode: PAGE_SIZE_MODES.FIXED,
  pageNumberStyle: PAGE_NUMBER_STYLES.CHINESE,
  combineUpright: DEFAULT_COMBINE_OPTIONS,
  bottomSlack: DEFAULT_BOTTOM_SLACK,
};

/**
 * 古籍仿真直排的基础布局（版式模板的公共基线）
 *
 * 与 `CLASSICAL_LAYOUT_OPTIONS` 的差异仅在 `columns: 1` 的显式约束与「仿真
 * 版式另由模板填充 `facsimile` 字段」——本常量**不写** `facsimile`，避免
 * 任何默认值意外把古典路径拖进仿真分支。
 */
export const FACSIMILE_BASE_LAYOUT: LayoutOptions = {
  writingMode: WRITING_MODES.VERTICAL_RL,
  pageSize: PAGE_SIZES.FOLIO_16,
  columns: 1,
  pageSizeMode: PAGE_SIZE_MODES.FIXED,
  pageNumberStyle: PAGE_NUMBER_STYLES.CHINESE,
  combineUpright: DEFAULT_COMBINE_OPTIONS,
  bottomSlack: DEFAULT_BOTTOM_SLACK,
};

/** 合并布局配置（浅合并，便于调用方覆盖局部） */
export function mergeLayoutOptions(
  base: LayoutOptions,
  patch: Partial<LayoutOptions>,
): LayoutOptions {
  return { ...base, ...patch };
}
