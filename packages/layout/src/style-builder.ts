/**
 * 样式构建器
 *
 * 将「主题令牌值 + 布局选项」编译为 CSS 声明对象（kebab-case 属性名），
 * 由渲染层（vue/react 封装、服务端 HTML 输出）直接套用。
 *
 * 纯函数、无 DOM 依赖，便于测试与 SSR。
 */
import {
  COLOR_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
} from '@bibliotype/core';
import type { BottomSlackOptions, LayoutOptions } from './layout-options.js';
import { resolveContentBox, type PageSize } from './page-size.js';
import { TEXT_ORIENTATIONS, isVerticalMode } from './writing-mode.js';
import { combineUprightCss } from './combine-upright.js';

/** CSS 声明对象（属性名 → 值） */
export type StyleDeclaration = Record<string, string>;

/** 根样式构建输入 */
export interface BuildRootStyleInput {
  /** 主题令牌值表（来自 ThemeAccessor.all()，允许扩展键） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 布局选项 */
  options: LayoutOptions;
  /** 正文字体族令牌键（默认 FONT_TOKENS.BODY，古籍可传 CLASSICAL_BODY） */
  fontToken?: string;
}

/** 仅在值存在时写入声明 */
function setIfPresent(
  style: StyleDeclaration,
  property: string,
  value: string | undefined,
): void {
  if (value !== undefined && value !== '') {
    style[property] = value;
  }
}

/**
 * 构建书页根容器的样式声明
 *
 * 覆盖：字体、字号、行高、字距、缩进、颜色、
 * 书写方向、字符方向、数字合并（D3）、分栏。
 */
export function buildRootStyle(input: BuildRootStyleInput): StyleDeclaration {
  const { tokens, options } = input;
  const fontToken = input.fontToken ?? FONT_TOKENS.BODY;
  const vertical = isVerticalMode(options.writingMode);

  const style: StyleDeclaration = {};

  /* 字体与颜色 */
  setIfPresent(style, 'font-family', tokens[fontToken]);
  setIfPresent(style, 'font-size', tokens[FONT_SIZE_TOKENS.BODY]);
  setIfPresent(style, 'line-height', tokens[LAYOUT_TOKENS.LINE_HEIGHT]);
  setIfPresent(style, 'letter-spacing', tokens[LAYOUT_TOKENS.LETTER_SPACING]);
  setIfPresent(style, 'text-indent', tokens[LAYOUT_TOKENS.TEXT_INDENT]);
  setIfPresent(style, 'color', tokens[COLOR_TOKENS.TEXT]);
  setIfPresent(style, 'background-color', tokens[COLOR_TOKENS.BACKGROUND]);

  /* 版框（扩展令牌 page-border，如 '1px solid #8c5a2b'；古籍主题可选） */
  setIfPresent(style, 'border', tokens['page-border']);

  /* 书写方向与直排策略 */
  style['writing-mode'] = options.writingMode;
  if (vertical) {
    style['text-orientation'] =
      tokens['text-orientation'] ?? TEXT_ORIENTATIONS.MIXED;
    const combine = combineUprightCss(options.combineUpright);
    if (combine !== undefined) {
      style['text-combine-upright'] = combine;
    }
  }

  /* 分栏 */
  if (options.columns > 1) {
    style['column-count'] = String(options.columns);
    setIfPresent(style, 'column-gap', tokens[LAYOUT_TOKENS.COLUMN_GAP]);
  }

  /*
   * 页眉 / 页脚占位高度（CSS 变量，供 book-css 的 .bt-page-header / -footer
   * 取用）。渲染层据此把页眉页脚压到页面上下沿并垂直居中；分页侧则由
   * resolvePageMainSize 从版心扣掉同样的尺寸——两处必须同源，否则文本会
   * 压在页眉上或被裁切。
   */
  const chrome = options.pageChrome;
  if (chrome !== undefined) {
    if (chrome.header !== 'none') {
      style['--bt-page-header-size'] = `${Math.max(0, chrome.headerSize)}px`;
    }
    if (chrome.footer !== 'none') {
      style['--bt-page-footer-size'] = `${Math.max(0, chrome.footerSize)}px`;
    }
  }

  return style;
}

/**
 * 构建单个页面容器的样式声明（尺寸与页边距）
 *
 * page-margin 令牌形如 "48px 56px"（上下 左右），透传为 padding。
 */
export function buildPageStyle(
  page: PageSize,
  tokens: Readonly<Record<string, string | undefined>>,
): StyleDeclaration {
  const style: StyleDeclaration = {
    width: `${page.width}px`,
    height: `${page.height}px`,
    'box-sizing': 'border-box',
    overflow: 'hidden',
  };
  setIfPresent(style, 'padding', tokens[LAYOUT_TOKENS.PAGE_MARGIN]);
  return style;
}

/**
 * 解析版框令牌（page-border，如 '3px double #b09a76'）的边框宽度（px）
 *
 * 书页盒为 box-sizing: border-box，边框会侵占内容区；量尺 / 分页主轴
 * 尺寸需同步扣除，否则量尺比实际版心宽、行高行数系统性偏小。
 * 非 px 单位（em 等）或缺省 → 0（不扣）。
 */
export function resolvePageBorderWidth(
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const match = /^\s*(\d+(?:\.\d+)?)px/.exec(tokens['page-border'] ?? '');
  return match === null ? 0 : Number(match[1]);
}

/**
 * 解析页边距令牌（"48px 56px" → [上下 marginY, 左右 marginX]，单位 px）
 *
 * 仅支持 px：非 px 单位（em / % 等）会使「分页主轴 = 页高 − 边距」与 CSS
 * 实际版心错位（buildPageStyle 原样透传，浏览器按 em 计算 padding），导致
 * 系统性溢出裁切，故显式拒绝而非静默按数字截取。令牌缺省时返回 [0, 0]
 * （与 buildPageStyle 缺省不内缩的渲染语义一致）。
 *
 * @throws RangeError 当令牌含非 px 单位值。
 */
export function resolvePageMargins(
  tokens: Readonly<Record<string, string | undefined>>,
): [number, number] {
  const raw = tokens[LAYOUT_TOKENS.PAGE_MARGIN];
  if (raw === undefined || raw.trim() === '') return [0, 0];
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
  const marginY = values[0] ?? 0;
  const marginX = values[1] ?? marginY;
  return [marginY, marginX];
}

/**
 * 解析每页可用主轴尺寸（px）
 *
 * 横排取内容区高、直排取内容区宽；页边距按 page-margin 令牌
 * （形如 "48px 56px"：上下 / 左右）解析。reader / 编辑画布 / PDF 共用
 * 本函数，保证三处分页主轴口径一致。
 */
export function resolvePageMainSize(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const [marginY, marginX] = resolvePageMargins(tokens);
  const box = resolveContentBox(options.pageSize, marginY, marginX);
  // 版框边框侵占 border-box 内容区（两侧各一份）
  const border = resolvePageBorderWidth(tokens) * 2;
  const vertical = isVerticalMode(options.writingMode);
  const main = vertical ? box.width : box.height;
  /*
   * 页眉 / 页脚占位：横排下页眉页脚位于页面上下沿，直接侵占主轴（页高）；
   * 直排下主轴是页宽（列数），页眉页脚侵占的是**交叉轴**（每列字数），
   * 由量尺上下文（charsPerLine）负责，这里不能扣，否则会算错列数。
   */
  const chrome = options.pageChrome;
  const chromeMain =
    chrome === undefined || vertical
      ? 0
      : (chrome.header === 'none' ? 0 : Math.max(0, chrome.headerSize)) +
        (chrome.footer === 'none' ? 0 : Math.max(0, chrome.footerSize));
  return Math.max(1, main - border - chromeMain);
}

/**
 * 页码带高度（px）：从渲染侧 `.bt-page-number` 推导
 *
 * 页码以 `bottom: 16px` 绝对定位在页面下沿、行高继承根（正文行高倍数），
 * 字号取 `font-size-note`（默认 12px → 带高 ≈ 16 + 12 × 1.9 ≈ 38.8）。取保守
 * 上界 40：宁可少溢出一两个像素，也不让正文压到页码。与 book-css 的声明
 * 同源，改那里必须同步这里。
 */
const PAGE_NUMBER_BAND = 40;

/**
 * 解析页底溢出量（px，分页可用容量的放宽量）
 *
 * 几何：换页线由「版心底（H − mB − C）」下移到「页码带顶缘」，故溢出上限受
 * 三者约束：① 下边距 `mB`（侵入深度不能超过边距本身，否则正文贴到页面物理
 * 底缘并被 `overflow: hidden` 裁切）；② 页码带（未启用 pageChrome 时页码以
 * 绝对定位浮在页面下沿，版心与页码顶之间只剩 `mB − PAGE_NUMBER_BAND`）；
 * ③ 已启用页脚时其占位已从版心扣掉，溢出可吃满整个下边距。
 *
 * 直排返回 0：主轴是页宽，溢出吃的是外边距（古籍版框 / 书口侧），风险与横排
 * 不同源，不默认开放。
 */
export function resolveBottomSlack(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
  lineSize: number,
): number {
  if (isVerticalMode(options.writingMode)) return 0;
  const slack: BottomSlackOptions | undefined = options.bottomSlack;
  if (slack === undefined) return 0;
  const want =
    typeof slack.px === 'number' && Number.isFinite(slack.px)
      ? slack.px
      : typeof slack.lines === 'number' && Number.isFinite(slack.lines)
        ? slack.lines * lineSize
        : 0;
  if (want <= 0) return 0;
  const [marginY] = resolvePageMargins(tokens);
  const chrome = options.pageChrome;
  const footerReserved =
    chrome !== undefined && chrome.footer !== 'none' && chrome.footerSize > 0;
  const room = footerReserved ? marginY : Math.max(0, marginY - PAGE_NUMBER_BAND);
  return Math.max(0, Math.min(want, room));
}

/**
 * 解析每页可用交叉轴尺寸（px）
 *
 * 横排取内容区宽（每行可容纳的字数由它决定）、直排取内容区高（每列的
 * 行长）。页眉 / 页脚在**直排**下侵占的是交叉轴（页面上下沿的横条吃掉了
 * 列的行长），故此处扣减；横排下它们侵占主轴，由 `resolvePageMainSize`
 * 扣减，这里不能重复扣。
 *
 * 调用方据此折算 `charsPerLine`（`交叉轴 / 字号 × 字宽系数`），保证
 * 「页眉开着但正文按满版行长排」的重叠裁切不会发生。
 */
export function resolvePageCrossSize(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const [marginY, marginX] = resolvePageMargins(tokens);
  const box = resolveContentBox(options.pageSize, marginY, marginX);
  const border = resolvePageBorderWidth(tokens) * 2;
  const vertical = isVerticalMode(options.writingMode);
  const cross = vertical ? box.height : box.width;
  const chrome = options.pageChrome;
  const chromeCross =
    chrome === undefined || !vertical
      ? 0
      : (chrome.header === 'none' ? 0 : Math.max(0, chrome.headerSize)) +
        (chrome.footer === 'none' ? 0 : Math.max(0, chrome.footerSize));
  return Math.max(1, cross - border - chromeCross);
}

/**
 * 构建 CSS 自定义属性表（--bt-* 变量，主题令牌的 CSS Variables 层）
 *
 * 渲染层将其挂到根容器 style 上，即可让子元素通过 var(--bt-*) 消费。
 */
export function buildCssVariables(
  tokens: Readonly<Record<string, string | undefined>>,
): StyleDeclaration {
  const variables: StyleDeclaration = {};
  for (const [token, value] of Object.entries(tokens)) {
    if (value !== undefined && value !== '') {
      variables[`--bt-${token}`] = value;
    }
  }
  return variables;
}
