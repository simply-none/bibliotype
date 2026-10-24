/**
 * 古籍仿真直排版式定义
 *
 * 「古籍仿真直排」与既有「古籍直排」**并列**：后者是现代书籍的竖排方式，
 * 本模块承载木刻古籍的真实版式语义（版框 / 界行 / 版心书口）。
 *
 * 隔离约定（架构红线）：
 * - `LayoutOptions.facsimile` 缺省为 `undefined`，`isFacsimileEnabled` 是唯一判定入口；
 * - 未启用时样式构建、分页主轴、度量签名全部走改造前的原路径，产出逐字符不变。
 */
import type { PageChromeField } from './layout-options.js';

/** 版框形态 */
export const FACSIMILE_FRAMES = {
  /** 无版框 */
  NONE: 'none',
  /** 四周单边 */
  SINGLE: 'single',
  /** 四周双边 */
  DOUBLE: 'double',
  /** 左右双边（上下单边） */
  LEFT_RIGHT: 'left-right',
} as const;

/** 版框形态联合类型 */
export type FacsimileFrame = (typeof FACSIMILE_FRAMES)[keyof typeof FACSIMILE_FRAMES];

/** 界行形态（乌丝栏 / 朱丝栏） */
export const FACSIMILE_RULES = {
  /** 无界行 */
  NONE: 'none',
  /** 乌丝栏（墨线） */
  INK: 'ink',
  /** 朱丝栏（朱线） */
  VERMILION: 'vermilion',
} as const;

/** 界行形态联合类型 */
export type FacsimileRule = (typeof FACSIMILE_RULES)[keyof typeof FACSIMILE_RULES];

/** 版心位置（版框内侧的左缘 / 右缘） */
export const GUTTER_SIDES = {
  LEFT: 'left',
  RIGHT: 'right',
} as const;

/** 版心位置联合类型 */
export type GutterSide = (typeof GUTTER_SIDES)[keyof typeof GUTTER_SIDES];

/** 版心口子形态 */
export const GUTTER_MOUTHS = {
  /** 白口（上下端留白） */
  WHITE: 'white',
  /** 细黑口（上下端细墨条，象鼻为细黑线） */
  BLACK: 'black',
  /** 大黑口（上下端宽墨条，象鼻为粗黑线；元刻本标志性版式） */
  BLACK_WIDE: 'black-wide',
} as const;

/** 版心口子联合类型 */
export type GutterMouth = (typeof GUTTER_MOUTHS)[keyof typeof GUTTER_MOUTHS];

/** 鱼尾形态 */
export const GUTTER_FISH_TAILS = {
  /** 无鱼尾 */
  NONE: 'none',
  /** 单鱼尾 */
  SINGLE: 'single',
  /** 双鱼尾 */
  DOUBLE: 'double',
} as const;

/** 鱼尾形态联合类型 */
export type GutterFishTail =
  (typeof GUTTER_FISH_TAILS)[keyof typeof GUTTER_FISH_TAILS];

/**
 * 版心（书口）配置
 *
 * 版心带宽会从分页主轴（直排为页宽）中扣除——这是仿真版式唯一参与排版的
 * 装饰项，因此必须进入度量签名。
 */
export interface FacsimileGutterOptions {
  /** 位于版框内侧哪一边 */
  side: GutterSide;
  /** 带宽（px，主轴扣减量） */
  size: number;
  /** 口子：白口 / 黑口 */
  mouth: GutterMouth;
  /** 鱼尾：无 / 单 / 双 */
  fishTail: GutterFishTail;
  /** 竖写字段（自上而下）；复用页眉页脚字段枚举 */
  fields: readonly PageChromeField[];
}

/** 古籍仿真版式（`undefined` = 未启用，走改造前原路径） */
export interface FacsimileOptions {
  /** 模板 id（`song-zhe` …；手工改动后置为 `custom`） */
  preset: string;
  /** 版框形态 */
  frame: FacsimileFrame;
  /** 界行形态 */
  rule: FacsimileRule;
  /** 版心（可选；缺省不渲染书口） */
  gutter?: FacsimileGutterOptions;
}

/** 仿真专有字体族令牌键（core `ThemeToken` 之外的扩展键，按扩展令牌透传） */
export const FACSIMILE_FONT_TOKENS = {
  /** 宋体族（浙本 / 汲古阁 / 巾箱本） */
  SONG: 'font-family-classical-song',
  /** 仿宋族（嘉靖本） */
  FANGSONG: 'font-family-classical-fangsong',
} as const;

/** 仿真专有字体族令牌键联合类型 */
export type FacsimileFontToken =
  (typeof FACSIMILE_FONT_TOKENS)[keyof typeof FACSIMILE_FONT_TOKENS];

/** 版心默认字段顺序（上书名、中篇卷、下叶次） */
export const DEFAULT_GUTTER_FIELDS: readonly PageChromeField[] = [
  'bookTitle',
  'chapterTitle',
  'pageNumber',
];

/**
 * 版心竖写文本
 *
 * 由 reader 侧解析、由 layout/html 序列化为 `.bt-page-gutter`；
 * 两侧共用同一类型，避免字段名漂移。
 */
export interface PageGutterTexts {
  /** 书名 */
  bookTitle: string;
  /** 卷次（所在 `volume` 的标题；无卷为空串；旧调用方可省略） */
  volumeTitle?: string;
  /** 篇卷 / 章名 */
  chapterTitle: string;
  /** 叶次（已格式化页码） */
  pageNumber: string;
}

/** 仿真版式默认值（形态全关，等价于不启用装饰） */
export const DEFAULT_FACSIMILE_OPTIONS: FacsimileOptions = {
  preset: 'custom',
  frame: FACSIMILE_FRAMES.NONE,
  rule: FACSIMILE_RULES.NONE,
};

/**
 * 是否启用古籍仿真版式（唯一判定入口）
 *
 * 所有仿真分支（样式构建、分页扣减、度量签名、装饰 CSS）都必须先过本函数，
 * 以保证「古籍直排」与「现代横排」路径零改动。
 */
export function isFacsimileEnabled(options: {
  facsimile?: FacsimileOptions | undefined;
}): boolean {
  return options.facsimile !== undefined;
}
