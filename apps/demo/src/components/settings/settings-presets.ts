/**
 * 设置面板预设表与命中判定
 *
 * 只承接纯数据与「输入 → 输出」的命中计算（版式套餐、单项档位、字体栈、
 * 页眉页脚组合），供各分区组件复用并可脱组件单测；写入草稿 / 落盘仍由
 * 各组件经 `api` 调用，本文件不持有状态、不产生副作用。
 */
import { FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  DEFAULT_PAGE_CHROME,
  PAGE_CHROME_FIELDS,
  type PageChromeField,
} from '@bibliotype/layout';

/** 数值型单项档位（令牌值 + 面板文案） */
export interface NumericPreset {
  /** 命中键（面板高亮比对用） */
  key: string;
  /** 写入的完整令牌值（如 `1.9` / `16px`） */
  value: string;
  /** 面板文案（数值 + 语义，如「1.5 适中」） */
  label: string;
}

/** 正文字体栈预设 */
export interface FontStackPreset {
  /** 命中键 */
  key: string;
  /** 面板文案 */
  label: string;
  /** 字体栈字面量（沿用 demo / classical 既有栈，多级回退） */
  stack: string;
}

/** 版式套餐（一次写入五组令牌） */
export interface LayoutPackagePreset {
  /** 命中键（套餐本身不回显，仅作列表键） */
  key: string;
  /** 面板文案 */
  label: string;
  /** 写入的令牌（字号 / 行距 / 字距 / 首行缩进 / 页边距） */
  tokens: Readonly<Record<string, string>>;
  /** 适用场景提示 */
  hint: string;
}

/** 页眉页脚组合预设 */
export interface PageChromePreset {
  /** 命中键 */
  key: string;
  /** 面板文案 */
  label: string;
  /** 页眉内容 */
  header: PageChromeField;
  /** 页眉占位 */
  headerSize: number;
  /** 页脚内容 */
  footer: PageChromeField;
  /** 页脚占位 */
  footerSize: number;
}

/** 版式套餐：覆盖屏读 / 现代 / 精装 / 古籍 / 大字五类场景 */
export const LAYOUT_PACKAGE_PRESETS: readonly LayoutPackagePreset[] = [
  {
    key: 'modern',
    label: '现代标准',
    hint: '现代书籍缺省组合（即库默认版式）',
    tokens: {
      [FONT_SIZE_TOKENS.BODY]: '16px',
      [LAYOUT_TOKENS.LINE_HEIGHT]: '1.9',
      [LAYOUT_TOKENS.LETTER_SPACING]: '0.02em',
      [LAYOUT_TOKENS.TEXT_INDENT]: '2em',
      [LAYOUT_TOKENS.PAGE_MARGIN]: '48px 56px 48px 56px',
    },
  },
  {
    key: 'compact',
    label: '紧凑电子',
    hint: '屏读 / 内容密集',
    tokens: {
      [FONT_SIZE_TOKENS.BODY]: '15px',
      [LAYOUT_TOKENS.LINE_HEIGHT]: '1.5',
      [LAYOUT_TOKENS.LETTER_SPACING]: '0',
      [LAYOUT_TOKENS.TEXT_INDENT]: '2em',
      [LAYOUT_TOKENS.PAGE_MARGIN]: '32px 40px 32px 40px',
    },
  },
  {
    key: 'airy',
    label: '疏朗典藏',
    hint: '精装 / 礼品书留白',
    tokens: {
      [FONT_SIZE_TOKENS.BODY]: '18px',
      [LAYOUT_TOKENS.LINE_HEIGHT]: '2.2',
      [LAYOUT_TOKENS.LETTER_SPACING]: '0.04em',
      [LAYOUT_TOKENS.TEXT_INDENT]: '2em',
      [LAYOUT_TOKENS.PAGE_MARGIN]: '64px 72px 64px 72px',
    },
  },
  {
    key: 'classical',
    label: '古籍刻本',
    hint: '现代排印古籍（缩进 0 随古籍惯例，页边距汲古阁口径）',
    tokens: {
      [FONT_SIZE_TOKENS.BODY]: '20px',
      [LAYOUT_TOKENS.LINE_HEIGHT]: '1.7',
      [LAYOUT_TOKENS.LETTER_SPACING]: '0.02em',
      [LAYOUT_TOKENS.TEXT_INDENT]: '0',
      [LAYOUT_TOKENS.PAGE_MARGIN]: '172px 100px 150px 72px',
    },
  },
  {
    key: 'large',
    label: '大字阅读',
    hint: '适老 / 大字本',
    tokens: {
      [FONT_SIZE_TOKENS.BODY]: '22px',
      [LAYOUT_TOKENS.LINE_HEIGHT]: '2',
      [LAYOUT_TOKENS.LETTER_SPACING]: '0.03em',
      [LAYOUT_TOKENS.TEXT_INDENT]: '2em',
      [LAYOUT_TOKENS.PAGE_MARGIN]: '48px 56px 48px 56px',
    },
  },
];

/** 正文字号档位（覆盖屏读到大字；古籍大字号由模板与套餐携带） */
export const FONT_SIZE_PRESETS: readonly NumericPreset[] = [
  { key: '14', value: '14px', label: '14' },
  { key: '16', value: '16px', label: '16' },
  { key: '18', value: '18px', label: '18' },
  { key: '20', value: '20px', label: '20' },
  { key: '22', value: '22px', label: '22' },
];

/** 行距档位（数值输入 step 0.05 仍保留） */
export const LINE_HEIGHT_PRESETS: readonly NumericPreset[] = [
  { key: 'tight', value: '1.2', label: '1.2 紧凑' },
  { key: 'moderate', value: '1.5', label: '1.5 适中' },
  { key: 'standard', value: '1.9', label: '1.9 标准' },
  { key: 'loose', value: '2.2', label: '2.2 宽松' },
  { key: 'airy', value: '2.5', label: '2.5 疏朗' },
];

/** 字距档位 */
export const LETTER_SPACING_PRESETS: readonly NumericPreset[] = [
  { key: 'none', value: '0', label: '0 紧凑' },
  { key: 'standard', value: '0.02em', label: '0.02em 标准' },
  { key: 'loose', value: '0.05em', label: '0.05em 宽松' },
  { key: 'scattered', value: '0.1em', label: '0.1em 散点' },
];

/** 首行缩进档位（古籍直排选 0，现代正文 2em） */
export const TEXT_INDENT_PRESETS: readonly NumericPreset[] = [
  { key: 'none', value: '0', label: '0' },
  { key: 'one', value: '1em', label: '1em' },
  { key: 'two', value: '2em', label: '2em' },
  { key: 'four', value: '4em', label: '4em' },
];

/** 正文 / 古籍正文字体栈预设（字面量与 demo / classical 既有栈对齐） */
export const FONT_STACK_PRESETS: readonly FontStackPreset[] = [
  {
    key: 'songti',
    label: '宋体',
    stack: "'Songti SC', 'STSong', 'SimSun', 'Noto Serif CJK SC', serif",
  },
  {
    key: 'heiti',
    label: '黑体',
    stack: "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  {
    key: 'kaiti',
    label: '楷体',
    stack: "'Kaiti SC', 'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif",
  },
  {
    key: 'fangsong',
    label: '仿宋',
    stack: "'FangSong', 'STFangsong', 'FangSong_GB2312', 'Noto Serif CJK SC', serif",
  },
];

/** 版心带宽档位（数值输入仍保留） */
export const GUTTER_WIDTH_PRESETS: readonly NumericPreset[] = [
  { key: 'narrow', value: '24', label: '24 窄' },
  { key: 'standard', value: '30', label: '30 标准' },
  { key: 'wide', value: '36', label: '36 宽' },
  { key: 'xwide', value: '48', label: '48 特宽' },
];

/** 页眉页脚组合预设（关闭 / 经典 / 学术 / 宽裕） */
export const PAGE_CHROME_PRESETS: readonly PageChromePreset[] = [
  {
    key: 'off',
    label: '关闭',
    header: PAGE_CHROME_FIELDS.NONE,
    headerSize: 0,
    footer: PAGE_CHROME_FIELDS.NONE,
    footerSize: 0,
  },
  {
    key: 'classic',
    label: '经典',
    header: PAGE_CHROME_FIELDS.BOOK_TITLE,
    headerSize: 26,
    footer: PAGE_CHROME_FIELDS.PAGE_NUMBER,
    footerSize: 26,
  },
  {
    key: 'academic',
    label: '学术',
    header: PAGE_CHROME_FIELDS.CHAPTER_TITLE,
    headerSize: 26,
    footer: PAGE_CHROME_FIELDS.PAGE_NUMBER,
    footerSize: 26,
  },
  {
    key: 'wide',
    label: '宽裕',
    header: PAGE_CHROME_FIELDS.BOOK_TITLE,
    headerSize: 36,
    footer: PAGE_CHROME_FIELDS.PAGE_NUMBER,
    footerSize: 36,
  },
];

/**
 * 数值型档位命中判定
 *
 * 取输入值的数值部分与档位数值全等比对（`16px` / `1.90` 都能落到 16 / 1.9），
 * 未命中返回空串（面板据此熄灭全部档位高亮）。
 */
export function resolveNumericPreset(
  raw: string | number | undefined,
  presets: readonly NumericPreset[],
): string {
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw ?? '');
  if (!Number.isFinite(value)) return '';
  return presets.find((preset) => Number.parseFloat(preset.value) === value)?.key ?? '';
}

/** 字体栈命中判定（字体令牌值与某栈全等才算命中） */
export function resolveFontStackPreset(raw: string | undefined): string {
  return FONT_STACK_PRESETS.find((preset) => preset.stack === raw)?.key ?? '';
}

/** 页眉页脚组合命中判定（四字段全等；未配置按关闭态比对） */
export function resolvePageChromePreset(
  chrome: {
    header: string;
    footer: string;
    headerSize: number;
    footerSize: number;
  } | undefined,
): string {
  const value = chrome ?? DEFAULT_PAGE_CHROME;
  return (
    PAGE_CHROME_PRESETS.find(
      (preset) =>
        preset.header === value.header &&
        preset.footer === value.footer &&
        preset.headerSize === value.headerSize &&
        preset.footerSize === value.footerSize,
    )?.key ?? ''
  );
}
