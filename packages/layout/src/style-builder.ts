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
import {
  resolveContentBox,
  resolvePageMarginBox,
  type PageMarginBox,
  type PageSize,
} from './page-size.js';
import { TEXT_ORIENTATIONS, isVerticalMode } from './writing-mode.js';
import { combineUprightCss } from './combine-upright.js';
import { isFacsimileEnabled } from './facsimile.js';
import {
  resolveFacsimileFrameThickness,
  resolveFacsimileGutterSize,
  resolveBodyFontSize,
  resolveLetterSpacingEm,
  resolveLinePitch,
} from './facsimile-geometry.js';

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

  /*
   * 行款网格（古籍仿真直排）：根行高绝对化为列距 px。倍数行高以数字继承，
   * 各后代按**自身字号**重算行盒厚度——注文小字、注码等行随之偏离界行
   * 节距；px 值原样继承，未显式设行高的后代行盒恒等于列距。与界行图层、
   * book-css 根规则同源（resolveLinePitch），量尺工作表 / 预览页框 /
   * 编辑画布三处同值。显式行高的类由 book-css 的网格对齐层另行归格。
   */
  if (vertical && isFacsimileEnabled(options)) {
    style['line-height'] = `${resolveLinePitch(tokens)}px`;
  }

  /*
   * 版框（扩展令牌 page-border，如 '1px solid #8c5a2b'；古籍主题可选）。
   * 古籍仿真版式自带版框图层（画在页边距内、不侵占版心），此时 page-border
   * 与它的版心扣减**成对失效**，避免双框叠加与口径不一致。
   */
  if (!isFacsimileEnabled(options)) {
    setIfPresent(style, 'border', tokens['page-border']);
  }

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
   * 版心（书口）占位：直排下版心带宽从版心主轴（页宽）扣除，渲染侧必须同步
   * 内缩同样的量，否则正文会压进版心带。与 resolvePageMainSize 的扣减同源——
   * 两处口径必须一致，改一处必须改另一处。
   */
  if (isFacsimileEnabled(options) && vertical) {
    const gutter = options.facsimile?.gutter;
    if (gutter !== undefined && gutter.size > 0) {
      const margins = resolvePageMarginBox(tokens);
      if (gutter.side === 'left') {
        style['padding-left'] = `${margins.left + gutter.size}px`;
      } else {
        style['padding-right'] = `${margins.right + gutter.size}px`;
      }
    }
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

/*
 * 页边距四边盒的解析已下移到 `page-size.ts`（纯页面几何，供分页度量与
 * 仿真几何共用，避免样式构建器与仿真几何互相依赖成环）；此处保持同名
 * 再导出，公开 API 与调用方不受影响。
 */
export { resolvePageMarginBox };

/**
 * 解析页边距令牌（旧口径：`[上下, 左右]` 两值）
 *
 * @deprecated 仅保留向后兼容；丢失左右 / 上下不对称信息，分页请用
 *   {@link resolvePageMarginBox} 取逐边值。本函数返回 `[top, right]`（对称令牌
 *   下等价于旧 `[marginY, marginX]`）。
 */
export function resolvePageMargins(
  tokens: Readonly<Record<string, string | undefined>>,
): [number, number] {
  const box = resolvePageMarginBox(tokens);
  return [box.top, box.right];
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
  const box = resolveContentBox(options.pageSize, resolvePageMarginBox(tokens));
  const facsimile = isFacsimileEnabled(options);
  /*
   * 版框边框侵占 border-box 内容区（两侧各一份）。古籍仿真版的版框画在
   * 页边距内、不侵占版心，且与 page-border 成对失效（见 buildRootStyle），
   * 故此处同步不计扣减，保持两端口径一致。
   */
  const border = facsimile ? 0 : resolvePageBorderWidth(tokens) * 2;
  const vertical = isVerticalMode(options.writingMode);
  const main = vertical ? box.width : box.height;
  /* 版心带宽只从直排主轴（页宽）扣除；横排不渲染版心，不扣 */
  const gutter = vertical ? resolveFacsimileGutterSize(options) : 0;
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
  return Math.max(1, main - border - chromeMain - gutter);
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
 * 页码（页脚）字形与正文末行的最小间隙（px）
 *
 * 书排惯例：末行距页码留一线空隙（印刷标准页码在版心下方 5~10mm，Web 预览
 * 尺度取 3px）——页底溢出预算按此收口，正文最深只到「页码字形顶 − 3px」。
 */
const FOLIO_GAP_MIN = 3;

/**
 * 解析页底溢出量（px，分页可用容量的放宽量）
 *
 * 几何：换页线由「版心底（H − mB − C）」下移到「页码字形顶 − 3px」，故溢出
 * 上限受三者约束：① 下边距 `mB`（侵入深度不能超过边距本身，否则正文贴到
 * 页面物理底缘并被 `overflow: hidden` 裁切）；② 页码带（未启用 pageChrome 时
 * 页码以绝对定位浮在页面下沿，版心与页码顶之间只剩
 * `mB − PAGE_NUMBER_BAND − 3px`）；③ 已启用页脚时其占位已从版心扣掉，
 * 溢出可吃满下边距、只留 3px 与页脚字形隔开。
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
  // 溢出吃的是下边距（地脚），取四边盒的 bottom 而非 top（上下不对称时才正确）
  const marginY = resolvePageMarginBox(tokens).bottom;
  const chrome = options.pageChrome;
  const footerReserved =
    chrome !== undefined && chrome.footer !== 'none' && chrome.footerSize > 0;
  const room = footerReserved
    ? Math.max(0, marginY - FOLIO_GAP_MIN)
    : Math.max(0, marginY - PAGE_NUMBER_BAND - FOLIO_GAP_MIN);
  return Math.max(0, Math.min(want, room));
}

/** 分页几何（主轴行网格量化结果） */export interface PaginationGeometry {
  /**
   * 页主轴容量（px，行网格量化后）
   *
   * = floor((版心主轴 + 页底溢出) ÷ 行步进) × 行步进——容量恒为整行数，
   * 均匀行高的页面排满时内容底缘恒落在同一高度（行网格），页底不再出现
   * 「差半行」的随机空白；量化差值与页码间隙一起构成恒定的页脚留白。
   * 横排行步进 = 行高；直排列步进 = 列距（同一换算，见 `resolveLinePitch`）。
   */
  pageMainSize: number;
  /**
   * 页底溢出（px）= 原始容量 − 行网格容量
   *
   * 吸收注音（ruby）等行盒高于行步进的页面：逐行实测尺寸累加超出网格时，
   * 由本余量承接，不额外换页。
   */
  bottomSlack: number;
  /** 量化前的版心主轴（px，`resolvePageMainSize` 原值，供页框绘制参照） */
  rawMainSize: number;
}

/**
 * 解析分页几何：版心主轴按行网格取整 + 页底溢出预算
 *
 * 三端（阅读预览 / 编辑画布 / 打印）共用本函数，保证分页容量的行网格口径
 * 一致。页底空白由两部分构成、全书恒定：行网格余量（容量取整差值）与
 * 「版心底 → 页码字形顶」的固有间隙（页码带 / 页脚占位），二者都不随内容
 * 逐页波动——这是书本「页脚留白是设计出来的」观感的来源。
 */
export function resolvePaginationGeometry(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): PaginationGeometry {
  const rawMainSize = resolvePageMainSize(options, tokens);
  const step = resolveLinePitch(tokens);
  const slack = resolveBottomSlack(options, tokens, step);
  const capacity = rawMainSize + slack;
  /* epsilon 护栏：capacity 恰为步进整数倍时（30.4×23 之类）浮点除法可能
   * 落在 22.999999999999996，floor 会丢掉最后一整行 */
  const grid = step > 0 ? Math.floor(capacity / step + 1e-6) * step : capacity;
  const pageMainSize = Math.max(step > 0 ? step : 1, grid);
  return {
    pageMainSize,
    bottomSlack: Math.max(0, capacity - pageMainSize),
    rawMainSize,
  };
}

/**
 * 直排每列字数（交叉轴容量 ÷ 字位步进，向下取整）
 *
 * 字位步进 = 字号 × (1 + 字距 em)——浏览器 letter-spacing 逐字追加，列内
 * 文字按此步进推进；容量必须用同一公式向下取整，末字才能落在网格内。
 * 曾用 round(交叉轴 ÷ 字号)（不含字距、四舍五入）：与仿真几何层
 * （`resolveFacsimileGrid` 的 floor ÷ 字距步进）相差 1~2 字，列底出现
 * 空白字位——界行网格之下格外刺眼（仿真直排「不能空一行」的成因）。
 * 仿真与非仿真直排统一走本口径。
 */
export function resolveCharsPerColumn(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const cross = resolvePageCrossSize(options, tokens);
  const charStep = Math.max(1, resolveBodyFontSize(tokens) * (1 + resolveLetterSpacingEm(tokens)));
  return Math.max(1, Math.floor(cross / charStep));
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
  const box = resolveContentBox(options.pageSize, resolvePageMarginBox(tokens));
  /* 同 resolvePageMainSize：仿真版框画在页边距内，与 page-border 成对不扣 */
  const border = isFacsimileEnabled(options) ? 0 : resolvePageBorderWidth(tokens) * 2;
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
