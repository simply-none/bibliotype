/**
 * DOM 实测分页尺寸（P3：所见即所得分页）
 *
 * 分页归属若仅靠「按字符数估算」，会与真实渲染产生偏差，导致预览页裁切 / 空白、
 * 编辑分页参考线与实际断页错位。本模块在离屏渲染一份与真实书页「同宽、同样式」
 * 的量尺工作表，把每个块（extractBlocks 的块 id）实测其沿主轴的真实推进尺寸，
 * 产出「块 id → 尺寸」映射，交给 reader.extractBlocks / Reader / BtEditor 采用，
 * 使预览分页与编辑分页线都基于同一份真实尺寸。
 *
 * 适用范围：单栏横排。直排（vertical-rl）下单块会跨栏回流、多栏（columns>1）下
 * 分栏宽度与回流难以逐块隔离度量，故这些场景返回空映射，回退到字符数估算
 * （保证不劣化、不崩渲染）。
 */
import { DEFAULT_THEME, LAYOUT_TOKENS, type BookDocument } from '@bibliotype/core';
import {
  buildRootStyle,
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  mergeLayoutOptions,
  resolveContentBox,
  type LayoutOptions,
  type StyleDeclaration,
} from '@bibliotype/layout';
import { buildBookCss, serializeNode } from '@bibliotype/layout/html';
import { extractBlocks, findNodeById, type BlockMeasureContext } from '@bibliotype/reader';

/** 量尺输入 */
export interface MeasureBlockSizesInput {
  /** 待分页文档 */
  doc: BookDocument;
  /** 布局选项（与预览 / 编辑一致） */
  options?: LayoutOptions;
  /** 主题令牌值表（缺省 DEFAULT_THEME） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 正文字体族令牌键 */
  fontToken?: string;
  /** 估算上下文（仅用于 extractBlocks 结构与回退，不影响实测值） */
  measure?: Partial<BlockMeasureContext>;
}

const SHEET_ID = 'bt-measure-sheet';
const CSS_ID = 'bt-measure-css';
const CONTAINER_SELECTOR = '.bt-measure-sheet';
const BLOCK_CLASS = 'bt-measure-block';

/** 解析页边距令牌（"48px 56px" → [Y, X]；缺省 [48, 56]） */
function resolveMargins(tokens: Readonly<Record<string, string | undefined>>): [number, number] {
  const numbers = (tokens[LAYOUT_TOKENS.PAGE_MARGIN]?.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const marginY = numbers[0] ?? 48;
  const marginX = numbers[1] ?? marginY;
  return [marginY, marginX];
}

/** 属性值转义（id 落入 data-measure-id 属性） */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** 注入 / 更新量尺工作表的书册样式（块级样式与真实页一致） */
function syncMeasureCss(
  tokens: Readonly<Record<string, string | undefined>>,
  options: LayoutOptions,
  fontToken?: string,
): void {
  let element = document.getElementById(CSS_ID) as HTMLStyleElement | null;
  if (element === null) {
    element = document.createElement('style');
    element.id = CSS_ID;
    document.head.appendChild(element);
  }
  const css = buildBookCss({ tokens, options, fontToken, containerSelector: CONTAINER_SELECTOR });
  if (element.textContent !== css) element.textContent = css;
}

/** 取工作表容器（复用，离屏但参与布局） */
function ensureSheet(): HTMLElement {
  let sheet = document.getElementById(SHEET_ID);
  if (sheet === null) {
    sheet = document.createElement('div');
    sheet.id = SHEET_ID;
    sheet.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sheet);
  }
  return sheet as HTMLElement;
}

/** 套用与书页一致的排版（去掉栏 / 背景 / 边框，按单栏无框量尺） */
function applySheetStyle(sheet: HTMLElement, rootStyle: StyleDeclaration, contentWidth: number): void {
  const skip = new Set(['column-count', 'column-gap', 'background-color', 'background', 'border']);
  sheet.style.cssText = '';
  for (const [prop, value] of Object.entries(rootStyle)) {
    if (skip.has(prop)) continue;
    sheet.style.setProperty(prop, value);
  }
  // 定宽（内容宽）、高度随内容、离屏不可见但保留布局盒（visibility:hidden 仍产生度量）
  sheet.style.position = 'absolute';
  sheet.style.left = '-100000px';
  sheet.style.top = '0';
  sheet.style.width = `${contentWidth}px`;
  sheet.style.height = 'auto';
  sheet.style.minHeight = '0';
  sheet.style.maxHeight = 'none';
  sheet.style.overflow = 'visible';
  sheet.style.padding = '0';
  sheet.style.margin = '0';
  sheet.style.boxSizing = 'content-box';
  sheet.style.visibility = 'hidden';
  sheet.style.pointerEvents = 'none';
  sheet.style.zIndex = '-1';
}

/** 末块主轴推进量（自身尺寸 + 沿主轴的两端外边距） */
function lastBlockSize(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const marginTop = Number.parseFloat(cs.marginTop) || 0;
  const marginBottom = Number.parseFloat(cs.marginBottom) || 0;
  return el.offsetHeight + marginTop + marginBottom;
}

/**
 * 实测各块沿主轴（横排为高）的真实推进尺寸。
 *
 * @returns 「块 id → 尺寸(px)」映射；非单栏横排或无 DOM 时为空映射（回退估算）。
 */
export function measureBlockSizes(input: MeasureBlockSizesInput): ReadonlyMap<string, number> {
  if (typeof document === 'undefined') return new Map();

  const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, input.options ?? {});
  // 仅单栏横排做 DOM 实测；其余回退估算（空映射 → extractBlocks 采用 estimator）
  if (isVerticalMode(options.writingMode) || (options.columns ?? 1) > 1) return new Map();

  const tokens = input.tokens ?? DEFAULT_THEME;
  const [marginY, marginX] = resolveMargins(tokens);
  const box = resolveContentBox(options.pageSize, marginY, marginX);

  syncMeasureCss(tokens, options, input.fontToken);
  const sheet = ensureSheet();
  applySheetStyle(
    sheet,
    buildRootStyle({ tokens, options, fontToken: input.fontToken }),
    box.width,
  );

  const blocks = extractBlocks(input.doc, { context: input.measure });
  // 仅保留能还原为节点且 serializeNode 有产出的块，顺序与 blocks 一致
  sheet.innerHTML = blocks
    .map((block) => {
      const node = findNodeById(input.doc.root, block.id);
      if (node === undefined) return '';
      const html = serializeNode(node);
      if (html.trim() === '') return '';
      return `<div class="${BLOCK_CLASS}" data-measure-id="${escapeAttr(block.id)}">${html}</div>`;
    })
    .join('');

  const rendered = Array.from(sheet.children) as HTMLElement[];
  const sizes = new Map<string, number>();
  for (let i = 0; i < rendered.length; i += 1) {
    const el = rendered[i] as HTMLElement;
    const id = el.getAttribute('data-measure-id');
    if (id === null) continue;
    // 逐块推进量 = 到下一渲染块上缘的距离（含块间折叠外边距）；末块取自身尺寸 + 两端外边距
    const next = rendered[i + 1] as HTMLElement | undefined;
    const advance = next === undefined ? lastBlockSize(el) : next.offsetTop - el.offsetTop;
    if (Number.isFinite(advance) && advance > 0) sizes.set(id, advance);
  }

  // 空块（无产出）不进入映射 → 对应块回退估算，不影响其余实测
  return sizes;
}

/** 移除量尺工作表与注入样式（使用方卸载时调用，避免节点残留） */
export function disposeMeasureSheet(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(SHEET_ID)?.remove();
  document.getElementById(CSS_ID)?.remove();
}
