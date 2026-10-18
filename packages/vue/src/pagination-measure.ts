/**
 * DOM 实测分页尺寸（P3：所见即所得分页）
 *
 * 分页归属若仅靠「按字符数估算」，会与真实渲染产生偏差，导致预览页裁切 / 空白、
 * 编辑分页参考线与实际断页错位。本模块在离屏渲染一份与真实书页「同宽、同样式」
 * 的量尺工作表，把每个块（extractBlocks 的块 id）实测其沿主轴的真实推进尺寸，
 * 产出「块 id → 尺寸」映射，交给 reader.extractBlocks / Reader / BtEditor 采用，
 * 使预览分页与编辑分页线都基于同一份真实尺寸。
 *
 * 适用范围：单栏（横排 / 直排）。横排量「块高与换行」，直排量「块宽（推进含
 * 行款方向）与换列」——主轴随书写方向物理转置（见 mainAxisOf），页边界来自真实
 * 布局盒。多栏（columns>1）下分栏宽度与回流难以逐块隔离度量，仍返回空映射，
 * 回退到字符数估算（保证不劣化、不崩渲染）。
 */
import { DEFAULT_THEME, type BookDocument } from '@bibliotype/core';
import {
  buildRootStyle,
  DEFAULT_LAYOUT_OPTIONS,
  WRITING_MODES,
  isVerticalMode,
  mergeLayoutOptions,
  resolveContentBox,
  resolvePageBorderWidth,
  resolvePageMargins,
  type LayoutOptions,
  type StyleDeclaration,
  type WritingMode,
} from '@bibliotype/layout';
import { buildBookCss, serializeNode } from '@bibliotype/layout/html';
import {
  extractBlocksIndexed,
  type BlockMeasureContext,
  type ExtractedBlocks,
} from '@bibliotype/reader';
import { isRubyAnnotationText } from './ruby-annotation.js';
import { PERF_MEASURE, perfNow, perfRecord } from './perf.js';

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
  /**
   * 增量实测起点块 id：仅渲染 / 实测该块及之后（之前的块本轮不产出，
   * 由调用方合并旧缓存）。未命中 / 首位 / 缺省则全量实测。
   */
  fromBlockId?: string;
  /**
   * 定点实测模式：仅实测该块。量尺仍渲染其后一块（保块间折叠外边距口径），
   * 但结果只产出该块的尺寸 / 行偏移 / 行高。单栏定宽流下块高彼此独立，
   * 纯文本编辑（无增删块）只需重测被编辑块；未命中则回退全量实测。
   * 优先级高于 fromBlockId。
   */
  targetBlockId?: string;
  /**
   * 预抽块结果（可选）：调用方已用同一 doc 与同源 context 抽过块时传入，
   * 量尺直接复用其块序列与节点索引，省掉一次全树遍历（大文档约 6 ms / 轮）。
   *
   * 块序列与块 id 只由 IR 结构决定（`blockSizes` 等尺寸映射仅影响尺寸字段），
   * 故同一 doc 的结构抽取结果可安全跨轮复用；**必须与 `doc` / `measure` 同源**，
   * 否则渲染块与分页块错位。
   */
  extracted?: ExtractedBlocks;
}

const SHEET_ID = 'bt-measure-sheet';
const CSS_ID = 'bt-measure-css';
const CONTAINER_SELECTOR = '.bt-measure-sheet';
const BLOCK_CLASS = 'bt-measure-block';

/** 主轴口径：横排沿垂直方向推进（top / height），直排沿水平方向推进（left / width） */
interface MeasureAxis {
  vertical: boolean;
  /** 直排自右向左（行款推进方向为「左移」，列边界取 rect.right） */
  rl: boolean;
  cross: 'height' | 'width';
}

/** 由书写方向解析量尺主轴口径 */
function mainAxisOf(mode: WritingMode): MeasureAxis {
  const vertical = isVerticalMode(mode);
  return {
    vertical,
    rl: mode === WRITING_MODES.VERTICAL_RL,
    cross: vertical ? 'width' : 'height',
  };
}

/** 主轴推进坐标（块首缘：横排取上缘 top，直排取行款起始缘——rl 取右缘、lr 取左缘） */
function mainStartOf(rect: DOMRect, axis: MeasureAxis): number {
  if (!axis.vertical) return rect.top;
  return axis.rl ? rect.right : rect.left;
}

/** 解析页边距令牌（"48px 56px" → [Y, X]；与 resolvePageMainSize 同源，仅支持 px） */
function resolveMargins(tokens: Readonly<Record<string, string | undefined>>): [number, number] {
  return resolvePageMargins(tokens);
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
    // 量尺注入样式以类选择器（.bt-measure-sheet）为容器前缀：必须同时挂类，
    // 否则 book-css（段落 margin:0 / 标题字号等）全部落空，UA 默认边距把
    // 每块推进量虚增 ~1em，分页行高与真实页心不一致 → 页底大片空白
    sheet.className = CONTAINER_SELECTOR.slice(1);
    sheet.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sheet);
  }
  return sheet as HTMLElement;
}

/**
 * 套用与书页一致的排版（去掉栏 / 背景 / 边框，按单栏无框量尺）
 *
 * 交叉轴恒定尺（横排定宽 = 版心宽、直排定高 = 版心高，页边距 / 版框已扣），
 * 主轴随内容增长（直排下工作表向左变宽，行款与真实页一致）。
 */
function applySheetStyle(
  sheet: HTMLElement,
  rootStyle: StyleDeclaration,
  axis: MeasureAxis,
  contentMain: number,
): void {
  const skip = new Set(['column-count', 'column-gap', 'background-color', 'background', 'border']);
  sheet.style.cssText = '';
  for (const [prop, value] of Object.entries(rootStyle)) {
    if (skip.has(prop)) continue;
    sheet.style.setProperty(prop, value);
  }
  // 定交叉轴尺、主轴随内容，离屏不可见但保留布局盒（visibility:hidden 仍产生度量）
  const auto = `${Math.max(1, Math.round(contentMain))}px`;
  sheet.style.position = 'absolute';
  sheet.style.left = '-100000px';
  sheet.style.top = '0';
  if (axis.vertical) {
    sheet.style.height = auto;
    sheet.style.width = 'auto';
    sheet.style.minWidth = '0';
    sheet.style.maxWidth = 'none';
  } else {
    sheet.style.width = auto;
    sheet.style.height = 'auto';
    sheet.style.minHeight = '0';
    sheet.style.maxHeight = 'none';
  }
  sheet.style.overflow = 'visible';
  sheet.style.padding = '0';
  sheet.style.margin = '0';
  sheet.style.boxSizing = 'content-box';
  sheet.style.visibility = 'hidden';
  sheet.style.pointerEvents = 'none';
  sheet.style.zIndex = '-1';
}

/** 取块间折叠的外边距：横排取上下（快排方向），直排取左右（行款方向） */
function mainMargins(cs: CSSStyleDeclaration, axis: MeasureAxis): [number, number] {
  if (axis.vertical) {
    return [Number.parseFloat(cs.marginLeft) || 0, Number.parseFloat(cs.marginRight) || 0];
  }
  return [Number.parseFloat(cs.marginTop) || 0, Number.parseFloat(cs.marginBottom) || 0];
}

/** 末块主轴推进量（自身尺寸 + 沿主轴的两端外边距） */
function lastBlockSize(el: HTMLElement, axis: MeasureAxis): number {
  const cs = getComputedStyle(el);
  const [m1, m2] = mainMargins(cs, axis);
  return (axis.vertical ? el.offsetWidth : el.offsetHeight) + m1 + m2;
}

/**
 * 收集元素内文本节点及其起始全局字符偏移（与 collectNodeText / 切片口径一致）。
 *
 * 跳过 ruby 注文（`<rt>` / `<rp>`，见 `ruby-annotation`）：注文是渲染期注释、
 * 不属模型文本；计入会使行首字符偏移比模型轴多出注文长度，而该偏移同时用于
 * 片段切片（`sliceNodeByCharRange`）与选区 / 光标换算，导致含注音段落的切片边界
 * 与选区落点整体错位。
 */
function collectTextOffsets(el: HTMLElement): { node: Text; start: number; len: number }[] {
  const list: { node: Text; start: number; len: number }[] = [];
  if (typeof document === 'undefined' || typeof document.createTreeWalker !== 'function') {
    return list;
  }
  let offset = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode() as Text | null;
  while (n !== null) {
    if (!isRubyAnnotationText(n, el)) {
      const len = n.data.length;
      if (len > 0) list.push({ node: n, start: offset, len });
      offset += len;
    }
    n = walker.nextNode() as Text | null;
  }
  return list;
}

/** 全局字符偏移定位到 (文本节点, 节点内序号) */
function locateChar(
  list: { node: Text; start: number; len: number }[],
  g: number,
): { node: Text; local: number } | null {
  for (const entry of list) {
    if (g >= entry.start && g < entry.start + entry.len) {
      return { node: entry.node, local: g - entry.start };
    }
  }
  const last = list[list.length - 1];
  if (last !== undefined) return { node: last.node, local: Math.max(0, last.len - 1) };
  return null;
}

/**
 * 实测单块每行起始字符偏移（横排=换行行首，直排=换列列首）。
 *
 * 用整块 Range.getClientRects 归并出各行（列）的推进边界，再对每个边界二分
 * 查找首个「字符矩形推进坐标落入该行」的全局偏移。happy-dom 无布局（rects
 * 为空）→ 仅返回 [0]（单行），由调用方回退估算。浏览器下产出的边界 = 真实
 * 换行 / 换列位置。直排 rl 下行序自右向左，边界取 rect.right 降序；lr 取
 * rect.left 升序。
 */
function measureLineOffsets(el: HTMLElement, axis: MeasureAxis): number[] {
  const list = collectTextOffsets(el);
  const total = list.reduce((sum, entry) => sum + entry.len, 0);
  if (total === 0) return [0];

  const full = document.createRange();
  full.selectNodeContents(el);
  const rects = Array.from(full.getClientRects()).filter((r) => r.height > 0 || r.width > 0);
  if (rects.length <= 1) return [0];

  // 推进坐标：横排取 top（升序），直排取行款起始缘（rl 降序 / lr 升序）
  const startAt = (rect: DOMRect): number => mainStartOf(rect, axis);
  const edgeOf = (g: number): number => {
    const loc = locateChar(list, Math.min(g, total - 1));
    if (loc === null) return Number.NaN;
    const r = document.createRange();
    const local = Math.min(loc.local, Math.max(0, loc.node.data.length - 1));
    r.setStart(loc.node, local);
    r.setEnd(loc.node, local + 1);
    return startAt(r.getBoundingClientRect());
  };

  // 归并各行（列）边界（容差 2px 合并同一行的多段矩形）
  const edges: number[] = [];
  for (const rect of rects) {
    const e = startAt(rect);
    if (!edges.some((v) => Math.abs(v - e) <= 2)) edges.push(e);
  }
  edges.sort((a, b) => (axis.vertical && axis.rl ? b - a : a - b));
  if (edges.length <= 1) return [0];

  const offsets = [0];
  for (let k = 1; k < edges.length; k += 1) {
    const target = edges[k] as number;
    let lo = offsets[offsets.length - 1] as number;
    let hi = total - 1;
    // 行首字符 = 首个推进坐标越过本行边界的字符（行序与边界序同源同向）
    const reaches = (g: number): boolean => {
      const e = edgeOf(g);
      if (Number.isNaN(e)) return false;
      return axis.vertical && axis.rl ? e <= target + 2 : e >= target - 2;
    };
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (reaches(mid)) hi = mid;
      else lo = mid + 1;
    }
    if (lo > (offsets[offsets.length - 1] as number)) offsets.push(lo);
  }
  return offsets;
}

/** 建表并渲染各块（复用），返回与 blocks 对齐的已渲染元素（含空位 null） */
function renderMeasureSheet(
  input: MeasureBlockSizesInput,
): { blocks: ReturnType<typeof extractBlocksIndexed>['blocks']; rendered: (HTMLElement | null)[]; targetedOnly: boolean; axis: MeasureAxis } | null {
  if (typeof document === 'undefined') return null;

  const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, input.options ?? {});
  // 仅单栏做 DOM 实测（横排 / 直排均可，主轴口径随书写方向转置）；多栏回退估算（空映射 → extractBlocks 采用 estimator）
  if ((options.columns ?? 1) > 1) return null;

  const axis = mainAxisOf(options.writingMode);
  const tokens = input.tokens ?? DEFAULT_THEME;
  const [marginY, marginX] = resolveMargins(tokens);
  const box = resolveContentBox(options.pageSize, marginY, marginX);
  // 书页盒 border-box：版框边框侵占内容区，量尺交叉轴尺寸需同步扣除保持同尺
  const contentMain = (axis.vertical ? box.height : box.width) - resolvePageBorderWidth(tokens) * 2;

  syncMeasureCss(tokens, options, input.fontToken);
  const sheet = ensureSheet();
  applySheetStyle(
    sheet,
    buildRootStyle({ tokens, options, fontToken: input.fontToken }),
    axis,
    contentMain,
  );

  // 块抽取：调用方已抽过（同源）则直接复用，避免同一文档重复全树遍历
  const indexed = input.extracted ?? extractBlocksIndexed(input.doc, { context: input.measure });
  const allBlocks = indexed.blocks;
  // 渲染范围：定点 [target, target+1]（后一块仅为折叠口径参照）；尾测 [from, 末]；缺省全量
  let start = 0;
  let end = allBlocks.length;
  let targetedOnly = false;
  if (input.targetBlockId !== undefined) {
    const i = allBlocks.findIndex((block) => block.id === input.targetBlockId);
    if (i >= 0) {
      start = i;
      end = Math.min(i + 2, allBlocks.length);
      targetedOnly = true;
    }
  } else if (input.fromBlockId !== undefined) {
    // 增量：只渲染 / 实测起点块及之后（起点未命中或在首位则全量）
    const i = allBlocks.findIndex((block) => block.id === input.fromBlockId);
    if (i > 0) start = i;
  }
  const blocks = allBlocks.slice(start, end);
  sheet.innerHTML = blocks
    .map((block) => {
      const node = indexed.nodeById.get(block.id);
      if (node === undefined) return '';
      const html = serializeNode(node);
      if (html.trim() === '') return '';
      return `<div class="${BLOCK_CLASS}" data-measure-id="${escapeAttr(block.id)}">${html}</div>`;
    })
    .join('');

  const nodes = Array.from(sheet.children) as HTMLElement[];
  // 按 data-measure-id 对齐回 blocks（空块未渲染 → null 占位）
  const byId = new Map<string, HTMLElement>();
  for (const el of nodes) {
    const id = el.getAttribute('data-measure-id');
    if (id !== null) byId.set(id, el);
  }
  const rendered = blocks.map((block) => byId.get(block.id) ?? null);
  return { blocks, rendered, targetedOnly, axis };
}

/** 分页量尺结果：块推进尺寸 + 每行起始字符偏移 + 真实行高 + 块体高 */
export interface MeasurePaginationResult {
  /** 块 id → 主轴推进尺寸(px)（到下一块上缘，含块间折叠外边距） */
  sizes: ReadonlyMap<string, number>;
  /** 块 id → 每行起始字符偏移[]（仅多行块产出） */
  lineOffsets: ReadonlyMap<string, number[]>;
  /** 块 id → 真实行高 px（自身高度 ÷ 行数，不含块间距；仅多行块产出） */
  lineSizes: ReadonlyMap<string, number>;
  /**
   * 块 id → 块体高（px，offsetHeight：不含上 / 下外边距）
   *
   * sizes 是「推进量」（体高 + 与下一块的折叠间距），同一份间距在前后两块的
   * 入账里各算一次；供 extractBlocks 产出 bodyMainSize，让 paginate 按体高计
   * 追加代价，消除每页虚耗一份间距造成的页底空白。
   */
  bodySizes: ReadonlyMap<string, number>;
}

/**
 * 一次建表，同时实测「块推进尺寸」与「每行起始字符偏移」。
 *
 * 前者供分页归属，后者供 getPageFragments 把跨页块按真实行切片，两者同源。
 *
 * @returns 非单栏或无 DOM 时为空映射（回退估算）。
 */
export function measurePagination(input: MeasureBlockSizesInput): MeasurePaginationResult {
  const perfStart = perfNow();
  const result = measurePaginationInner(input);
  perfRecord(PERF_MEASURE, perfStart);
  return result;
}

/** 量尺主体（埋点在外层，便于把整段 DOM 实测算作一次测量） */
function measurePaginationInner(input: MeasureBlockSizesInput): MeasurePaginationResult {
  const sheet = renderMeasureSheet(input);
  if (sheet === null)
    return { sizes: new Map(), lineOffsets: new Map(), lineSizes: new Map(), bodySizes: new Map() };
  const { blocks, rendered, targetedOnly, axis } = sheet;

  const sizes = new Map<string, number>();
  const lineOffsets = new Map<string, number[]>();
  const lineSizes = new Map<string, number>();
  const bodySizes = new Map<string, number>();
  for (let i = 0; i < blocks.length; i += 1) {
    // 定点模式：仅产出目标块（index 0）；后一块只为折叠口径参照，不入结果
    if (targetedOnly && i > 0) break;
    const el = rendered[i];
    if (el === null) continue;
    const id = (blocks[i] as (typeof blocks)[number]).id;
    // 逐块推进量 = 到下一渲染块首缘的距离（含块间折叠外边距；横排取上缘 offsetTop，
    // 直排取行款起始缘 rect.right/left）；末块取自身尺寸 + 两端外边距
    let nextEl: HTMLElement | null = null;
    for (let j = i + 1; j < rendered.length; j += 1) {
      const cand = rendered[j];
      if (cand !== null) {
        nextEl = cand;
        break;
      }
    }
    const advance =
      nextEl === null
        ? lastBlockSize(el, axis)
        : axis.vertical
          ? // 直排包裹层无内边距 / 边框：offsetLeft === rect.left；起始缘差即两包裹盒
            // 外边缘间距 + 下一块体宽，恒为正，rl / lr 皆适用
            mainStartOf(el.getBoundingClientRect(), axis) -
            (axis.rl ? nextEl.offsetLeft + nextEl.offsetWidth : nextEl.offsetLeft)
          : nextEl.offsetTop - el.offsetTop;
    if (Number.isFinite(advance) && advance > 0) sizes.set(id, advance);
    // 块体尺寸：主轴向盒尺寸（不含外边距；横排 offsetHeight、直排 offsetWidth），供 paginate 按体高计追加代价
    const body = axis.vertical ? el.offsetWidth : el.offsetHeight;
    if (body > 0) bodySizes.set(id, body);
    const offsets = measureLineOffsets(el, axis);
    if (offsets.length > 1) {
      lineOffsets.set(id, offsets);
      // 真实行高（主轴推进）：自身盒主轴尺寸 ÷ 真实行数，避免把块间距摊进行高
      if (body > 0) lineSizes.set(id, body / offsets.length);
    }
  }
  return { sizes, lineOffsets, lineSizes, bodySizes };
}

/**
 * 实测各块沿主轴（横排为高、直排为宽）的真实推进尺寸。
 *
 * @returns 「块 id → 尺寸(px)」映射；非单栏或无 DOM 时为空映射（回退估算）。
 */
export function measureBlockSizes(input: MeasureBlockSizesInput): ReadonlyMap<string, number> {
  return measurePagination(input).sizes;
}

/** 移除量尺工作表与注入样式（使用方卸载时调用，避免节点残留） */
export function disposeMeasureSheet(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(SHEET_ID)?.remove();
  document.getElementById(CSS_ID)?.remove();
}
