/**
 * 排版度量签名（Metrics Signature）
 *
 * 用途：把「会影响分页结果的配置」压缩成一个字符串。调用方（编辑画布 / 阅读预览）
 * 只需比较签名是否变化来决定**要不要重新量尺与分页**：
 *
 * - 改颜色、线型、底色、圆角等纯绘制参数 → 签名不变 → 只换样式表，**禁止重排**；
 * - 改字号、行距、字距、缩进、页边距、分栏、版框、标题字号等 → 签名变化 → 重排一次。
 *
 * 这条约束是硬性的：78 万字文档一次全量重排是秒级成本，若用户拖动颜色选择器
 * 也触发重排，面板会直接卡死。
 *
 * 只纳入「度量类」键，且全部排序后拼接，保证同配置得到同签名（可跨轮比较）。
 */
import {
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
  computeFeatureMetricsSignature,
  type FeatureStyleSheet,
} from '@bibliotype/core';
import type { LayoutOptions } from './layout-options.js';

/**
 * 影响度量的令牌键
 *
 * - 字号 / 行高 / 字距 / 缩进 → 每行字数与行高；
 * - 页边距 / 版框宽度 → 版心尺寸（`resolvePageMainSize` 直接扣减）；
 * - 栏间距 → 多栏时的每栏宽度；
 * - 字体族 → 同字号下字宽不同，行内可容纳字数不同；
 * - `text-orientation` → 直排下字形朝向改变字宽。
 *
 * 颜色类令牌（`color-*`）明确不在其中。
 */
const METRIC_TOKEN_KEYS: readonly string[] = [
  FONT_SIZE_TOKENS.BODY,
  FONT_SIZE_TOKENS.NOTE,
  FONT_SIZE_TOKENS.HEADING,
  FONT_TOKENS.BODY,
  FONT_TOKENS.HEADING,
  FONT_TOKENS.CLASSICAL_BODY,
  FONT_TOKENS.MONO,
  LAYOUT_TOKENS.LINE_HEIGHT,
  LAYOUT_TOKENS.LETTER_SPACING,
  LAYOUT_TOKENS.TEXT_INDENT,
  LAYOUT_TOKENS.PAGE_MARGIN,
  LAYOUT_TOKENS.COLUMN_GAP,
  'page-border',
  'text-orientation',
];

/** 签名输入 */
export interface MetricsSignatureInput {
  /** 主题令牌值表 */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 布局选项 */
  options: LayoutOptions;
  /** 功能样式表（按功能粒度的覆盖） */
  features?: FeatureStyleSheet;
}

/**
 * 拼接布局选项中影响度量的字段
 *
 * 页眉 / 页脚必须纳入：它由 `resolvePageMainSize` 从版心扣减，
 * 改内容或改占位高度都会改变每页行数 → 不重排就会错页。
 * 页底溢出（bottomSlack）同样直接放宽装箱容量，必须随配置变化失效。
 */
function optionsPart(options: LayoutOptions): string {
  const chrome = options.pageChrome;
  const chromePart =
    chrome === undefined
      ? 'nochrome'
      : [chrome.header, chrome.headerSize, chrome.footer, chrome.footerSize].join('/');
  const slack = options.bottomSlack;
  const slackPart =
    slack === undefined
      ? 'noslack'
      : `s${slack.px ?? ''}/${slack.lines ?? ''}`;
  return [
    options.writingMode,
    `${options.pageSize.width}x${options.pageSize.height}`,
    `c${options.columns}`,
    `d${options.combineUpright.maxDigits}`,
    options.combineUpright.latinStrategy,
    chromePart,
    slackPart,
  ].join(',');
}

/**
 * 计算度量签名
 *
 * 签名相同 → 分页结果可复用；不同 → 必须失效尺寸表并重新分页。
 */
export function computeMetricsSignature(input: MetricsSignatureInput): string {
  const tokenPart = METRIC_TOKEN_KEYS.map(
    (key) => `${key}=${input.tokens[key] ?? ''}`,
  ).join(';');
  const featurePart = computeFeatureMetricsSignature(input.features);
  const base = `${optionsPart(input.options)}|${tokenPart}|${featurePart}`;
  /*
   * 古籍仿真版式：只在启用时**追加**到签名尾部，原键集与顺序一字不动——
   * 未启用时签名与改造前逐字符相同（「现代横排 / 古籍直排」的分页缓存
   * 行为零变化）。参与项只有真正影响度量的：版心带宽（扣主轴）与两个
   * 仿真字体族（同字号字宽不同）；版框线宽 / 颜色 / 纸纹属纯绘制，不进签名。
   */
  if (input.options.facsimile === undefined) return base;
  const facsimile = input.options.facsimile;
  return `${base}|fs:${facsimile.frame}/${facsimile.rule}/g${
    facsimile.gutter?.size ?? 0
  }/ft${input.tokens['font-family-classical-song'] ?? ''},${
    input.tokens['font-family-classical-fangsong'] ?? ''
  }`;
}
