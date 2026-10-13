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
import type { LayoutOptions } from './layout-options.js';
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
  const numbers = (tokens[LAYOUT_TOKENS.PAGE_MARGIN]?.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const marginY = numbers[0] ?? 0;
  const marginX = numbers[1] ?? marginY;
  const box = resolveContentBox(options.pageSize, marginY, marginX);
  return isVerticalMode(options.writingMode) ? box.width : box.height;
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
