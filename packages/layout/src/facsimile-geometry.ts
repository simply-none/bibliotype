/**
 * 古籍仿真版式的几何计算
 *
 * 职责：把「版式语义 + 令牌」换算成可测的像素几何——版框线宽与内缩、
 * 界行节距与区域、版心带宽、每半页行款，以及供渲染层消费的 `--bt-fs-*`
 * CSS 变量。
 *
 * 全部为纯函数、无 DOM 依赖，便于单测与 SSR；分页侧与渲染侧共用同一份结果，
 * 保证「分页算出来的版心 = 浏览器真正画出来的版心」。
 */
import { FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  FACSIMILE_FRAMES,
  isFacsimileEnabled,
  type FacsimileFrame,
} from './facsimile.js';
import type { LayoutOptions } from './layout-options.js';
import { resolveContentBox, resolvePageMarginBox, type PageMarginBox } from './page-size.js';
import type { StyleDeclaration } from './style-builder.js';

/** 版框线宽默认值（px，令牌缺省时使用） */
const DEFAULT_FRAME_WIDTH = 2;
/** 双边间距默认值（px） */
const DEFAULT_FRAME_GAP = 3;
/** 内框线宽默认值（px） */
const DEFAULT_FRAME_INNER_WIDTH = 1;
/** 正文字号缺省值（px，令牌缺失时的兜底，与 DEFAULT_THEME 对齐） */
const DEFAULT_FONT_SIZE = 16;
/** 行高缺省值（倍数） */
const DEFAULT_LINE_HEIGHT = 1.9;

/** 版框各方向总线宽（px，含外框 / 间距 / 内框） */
export interface FacsimileFrameThickness {
  /** 左右方向总线宽（`left-right` 双边的单侧厚度） */
  x: number;
  /** 上下方向总线宽 */
  y: number;
}

/** 行款与版心几何 */
export interface FacsimileGrid {
  /** 直排列距（px）：字号 × 行距，界行节距与「每半页行数」共用 */
  linePitch: number;
  /** 版心宽（px，未扣版心带） */
  contentWidth: number;
  /** 版心高（px，直排的交叉轴 / 每行字数依据） */
  contentHeight: number;
  /** 主轴文本区宽（px）：版心宽 − 版心带宽 */
  textWidth: number;
  /** 版心带宽（px） */
  gutterSize: number;
  /** 每半页行数（直排列数） */
  linesPerHalfLeaf: number;
  /** 每行字数 */
  charsPerColumn: number;
  /** 版框各方向总线宽（px） */
  frameThickness: FacsimileFrameThickness;
}

/** 解析形如 `12px` 的令牌值（非法 / 缺省 → undefined） */
function parsePx(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(value);
  return match === null ? undefined : Number(match[1]);
}

/** 保留两位小数（避免浮点尾差进入 CSS 与断言） */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 解析版框各方向总线宽
 *
 * 版框线完全画在页边距内（不侵占版心），因此这里的数值只影响绘制与图层
 * 内缩，**不进入** `resolvePageMainSize` 的扣减。
 */
export function resolveFacsimileFrameThickness(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): FacsimileFrameThickness {
  const frame: FacsimileFrame = options.facsimile?.frame ?? FACSIMILE_FRAMES.NONE;
  if (frame === FACSIMILE_FRAMES.NONE) return { x: 0, y: 0 };

  const outer = Math.max(1, parsePx(tokens['page-frame-width']) ?? DEFAULT_FRAME_WIDTH);
  if (frame === FACSIMILE_FRAMES.SINGLE) return { x: outer, y: outer };

  const gap = Math.max(0, parsePx(tokens['page-frame-inner-gap']) ?? DEFAULT_FRAME_GAP);
  const inner = Math.max(
    1,
    parsePx(tokens['page-frame-inner-width']) ?? DEFAULT_FRAME_INNER_WIDTH,
  );
  /* CSS `double` 需 ≥3px 才画得出两条线，故下限取 3 */
  const total = Math.max(3, outer + gap + inner);
  if (frame === FACSIMILE_FRAMES.DOUBLE) return { x: total, y: total };
  /* left-right：上下单边、左右双边 */
  return { x: total, y: outer };
}

/**
 * 版心带宽（px）
 *
 * 唯一参与分页的装饰项：直排下从版心主轴（页宽）扣除。未启用仿真版式或
 * 未配置版心时返回 0（调用方据此走原路径）。
 */
export function resolveFacsimileGutterSize(options: LayoutOptions): number {
  if (!isFacsimileEnabled(options)) return 0;
  const gutter = options.facsimile?.gutter;
  if (gutter === undefined || !Number.isFinite(gutter.size) || gutter.size <= 0) return 0;
  return Math.round(gutter.size);
}

/**
 * 直排列距（px）= 字号 × 行距
 *
 * 直排下 `line-height` 决定行盒沿 block 轴（横向）的厚度，也就是相邻两列
 * 之间的距离；界行节距必须与它严格相等，否则线条与文字列错位。
 * 与 `exporter-pdf` 的 `defaultLineSize` 口径一致（同源换算）。
 */
export function resolveLinePitch(
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const size = parsePx(tokens[FONT_SIZE_TOKENS.BODY]) ?? DEFAULT_FONT_SIZE;
  const raw = Number.parseFloat(tokens[LAYOUT_TOKENS.LINE_HEIGHT] ?? '');
  const ratio = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LINE_HEIGHT;
  return round2(size * ratio);
}

/** 字距（em）：支持 `0.02em` / `0.02` / `0.5px` 三种写法 */
function resolveLetterSpacingEm(
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const raw = (tokens[LAYOUT_TOKENS.LETTER_SPACING] ?? '').trim();
  if (raw === '') return 0;
  const em = /^(-?\d+(?:\.\d+)?)em$/.exec(raw);
  if (em !== null) return Number(em[1]);
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(raw);
  if (px !== null) {
    const size = parsePx(tokens[FONT_SIZE_TOKENS.BODY]) ?? DEFAULT_FONT_SIZE;
    return size > 0 ? Number(px[1]) / size : 0;
  }
  const plain = Number.parseFloat(raw);
  return Number.isFinite(plain) ? plain : 0;
}

/**
 * 解析行款与版心几何
 *
 * 口径（与设置面板只读回显、测试断言三方一致）：
 * - 文本区宽 = 页宽 − 左右页边距 − 版心带宽；
 * - 每半页行数 = floor(文本区宽 ÷ 列距)，列距 = 字号 × 行距；
 * - 每行字数 = floor(版心高 ÷ 字距步进)，步进 = 字号 × (1 + 字距em)。
 */
export function resolveFacsimileGrid(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): FacsimileGrid {
  const margins = resolvePageMarginBox(tokens);
  const box = resolveContentBox(options.pageSize, margins);
  const gutterSize = resolveFacsimileGutterSize(options);
  const textWidth = Math.max(1, box.width - gutterSize);
  const linePitch = resolveLinePitch(tokens);
  const charPitch =
    (parsePx(tokens[FONT_SIZE_TOKENS.BODY]) ?? DEFAULT_FONT_SIZE) *
    (1 + resolveLetterSpacingEm(tokens));
  return {
    linePitch,
    contentWidth: box.width,
    contentHeight: box.height,
    textWidth,
    gutterSize,
    linesPerHalfLeaf: Math.max(1, Math.floor(textWidth / linePitch)),
    charsPerColumn: Math.max(1, Math.floor(box.height / Math.max(1, charPitch))),
    frameThickness: resolveFacsimileFrameThickness(options, tokens),
  };
}

/**
 * 版框图层四边内缩（px，相对页面 padding box）
 *
 * 绝对定位伪元素的 `inset` 相对页面元素 padding box，而页面 padding 恰为
 * `page-margin`，故「内缩 = 页边距 − 线宽」正好让版框外缘落在页边距内、
 * 内缘贴住版心边界。
 */
export function resolveFrameInsets(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): PageMarginBox {
  const margins = resolvePageMarginBox(tokens);
  const thickness = resolveFacsimileFrameThickness(options, tokens);
  return {
    top: Math.max(0, round2(margins.top - thickness.y)),
    right: Math.max(0, round2(margins.right - thickness.x)),
    bottom: Math.max(0, round2(margins.bottom - thickness.y)),
    left: Math.max(0, round2(margins.left - thickness.x)),
  };
}

/**
 * 界行图层四边内缩（px）
 *
 * 与版心文本区严格重合：三边取页边距，版心所在侧再加带宽，保证线条只画在
 * 正文列之间、不压入版心带。
 */
export function resolveRuleInsets(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): PageMarginBox {
  const margins = resolvePageMarginBox(tokens);
  const gutterSize = resolveFacsimileGutterSize(options);
  const side = options.facsimile?.gutter?.side;
  return {
    top: margins.top,
    right: side === 'right' ? margins.right + gutterSize : margins.right,
    bottom: margins.bottom,
    left: side === 'left' ? margins.left + gutterSize : margins.left,
  };
}

/**
 * 仿真版式的 `--bt-fs-*` CSS 变量表
 *
 * 输出到 `:root`（书册样式表变量层），阅读 / 编辑分页 / 打印三端共用；
 * 仅在仿真版式启用时调用，未启用时变量层与改造前完全一致。
 */
export function resolveFacsimileCssVariables(
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): StyleDeclaration {
  const margins = resolvePageMarginBox(tokens);
  const frame = resolveFrameInsets(options, tokens);
  const rule = resolveRuleInsets(options, tokens);
  const gutterSize = resolveFacsimileGutterSize(options);
  const thickness = resolveFacsimileFrameThickness(options, tokens);
  return {
    '--bt-fs-line-pitch': `${resolveLinePitch(tokens)}px`,
    '--bt-fs-frame-inset': `${frame.top}px ${frame.right}px ${frame.bottom}px ${frame.left}px`,
    '--bt-fs-rule-inset': `${rule.top}px ${rule.right}px ${rule.bottom}px ${rule.left}px`,
    '--bt-fs-gutter-size': `${gutterSize}px`,
    '--bt-fs-frame-width-x': `${thickness.x}px`,
    '--bt-fs-frame-width-y': `${thickness.y}px`,
    '--bt-fs-inset-top': `${margins.top}px`,
    '--bt-fs-inset-right': `${margins.right}px`,
    '--bt-fs-inset-bottom': `${margins.bottom}px`,
    '--bt-fs-inset-left': `${margins.left}px`,
  };
}
