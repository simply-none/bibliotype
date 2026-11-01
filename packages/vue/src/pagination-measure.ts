/**
 * DOM 实测分页尺寸（P3：所见即所得分页）
 *
 * 分页归属若仅靠「按字符数估算」，会与真实渲染产生偏差，导致预览页裁切 / 空白、
 * 编辑分页参考线与实际断页错位。本模块在离屏渲染一份与真实书页「同宽、同样式」
 * 的量尺工作表，把每个块（extractBlocks 的块 id）实测其沿主轴的真实推进尺寸，
 * 产出「块 id → 尺寸」映射，交给 reader.extractBlocks / Reader / BtEditor 采用，
 * 使预览分页与编辑分页线都基于同一份真实尺寸。
 *
 * 适用范围：横排 / 直排。横排量「块高与换行」，直排量「块宽（推进含行款
 * 方向）与换列」——主轴随书写方向物理转置（见 mainAxisOf），页边界来自真实
 * 布局盒。多栏（columns>1）时按「栏宽」（页宽扣栏间距后均分）量尺，分页容量
 * 由分页器乘栏数（见 paginate 的分栏分组）。
 */
import {
  DEFAULT_THEME,
  FONT_SIZE_TOKENS,
  LAYOUT_TOKENS,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import {
  buildPageStyle,
  buildRootStyle,
  DEFAULT_LAYOUT_OPTIONS,
  WRITING_MODES,
  isVerticalMode,
  mergeLayoutOptions,
  resolvePageCrossSize,
  resolvePageMarginBox,
  resolvePaginationGeometry,
  resolveVerticalMeasureContext,
  type BlockAxis,
  type LayoutOptions,
  type StyleDeclaration,
  type VerticalMeasureContext,
  type WritingMode,
} from '@bibliotype/layout';
import { buildBookCss, serializeNode, serializeVerticalFlow } from '@bibliotype/layout/html';
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
  /**
   * 功能样式表（按功能粒度覆盖节点 / 标记 / 角色样式，与渲染侧同源）
   *
   * 传入时量尺 CSS 应用功能样式，确保测量与渲染同尺（如改行高、段间距等）。
   */
  features?: import('@bibliotype/core').FeatureStyleSheet;
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

/** 栏间距（px）：从主题令牌解析 em / px，缺省 24px */
function resolveColumnGapPx(
  tokens: Readonly<Record<string, string | undefined>>,
  columns: number,
): number {
  if (columns <= 1) return 0;
  const raw = tokens[LAYOUT_TOKENS.COLUMN_GAP] ?? '2.5em';
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) return 24;
  if (raw.trim().endsWith('em')) {
    const body = Number.parseFloat(tokens[FONT_SIZE_TOKENS.BODY] ?? '16px');
    return numeric * (Number.isFinite(body) ? body : 16);
  }
  return numeric;
}

/** 主轴推进坐标（块首缘：横排取上缘 top，直排取行款起始缘——rl 取右缘、lr 取左缘） */
function mainStartOf(rect: DOMRect, axis: MeasureAxis): number {
  if (!axis.vertical) return rect.top;
  return axis.rl ? rect.right : rect.left;
}

/** 交叉轴起点（横排取左缘，直排取上缘） */
function crossStartOf(rect: DOMRect, axis: MeasureAxis): number {
  return axis.vertical ? rect.top : rect.left;
}

/** 交叉轴终点（横排取右缘，直排取下缘） */
function crossEndOf(rect: DOMRect, axis: MeasureAxis): number {
  return axis.vertical ? rect.bottom : rect.right;
}

/** 解析页边距令牌（四边盒；与 resolvePageMainSize 同源，仅支持 px） */
function resolveMargins(
  tokens: Readonly<Record<string, string | undefined>>,
): ReturnType<typeof resolvePageMarginBox> {
  return resolvePageMarginBox(tokens);
}

/** 属性值转义（id 落入 data-measure-id 属性） */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * 直排实测几何（复刻页框实测产出，覆盖令牌折算口径）
 *
 * 浏览器对 `border-style: double` 等边框风格的**used width**有自己的收敛
 * （3px double 实渲 2.67px），按令牌名义值折算「每列字数」会与真实页差 1 字：
 * 量尺按 53 字/列装箱、真实页按 54 字/列换列，每页末列系统性留白约 1/3 列
 * （「明明不是末尾却在中间截断」），breakColumn 对齐也随之逐列漂移出中页空洞。
 * 故直排几何不再依赖令牌折算，而以**复刻页框的实测盒**为准（同一浏览器、
 * 同一 CSS → 同一 used value → 两端必然一致）。
 */
export interface MeasuredVerticalGeometry {
  /** 每页主轴尺寸（页框内容宽 ÷ 列距取整 × 列距，与 resolvePaginationGeometry 同式） */
  pageMainSize: number;
  /** 每列字数（实测内容高 ÷ 字位步进，向下取整） */
  charsPerColumn: number;
  /** 列距（与令牌口径同值：line-height 为绝对 px，无 used value 收敛问题） */
  columnPitch: number;
  /** 一个字位沿主轴的宽度 px = 列距 ÷ 每列字数 */
  lineSize: number;
  /** 字位步进（字号 × (1+字距 em)） */
  charPitch: number;
  /** 实测内容高（页框复刻盒的内容盒高，浏览器 used border 口径） */
  cross: number;
}

/** 注入 / 更新量尺工作表的书册样式（块级样式与真实页一致） */
function syncMeasureCss(
  tokens: Readonly<Record<string, string | undefined>>,
  options: LayoutOptions,
  fontToken?: string,
  features?: import('@bibliotype/core').FeatureStyleSheet,
): void {
  let element = document.getElementById(CSS_ID) as HTMLStyleElement | null;
  if (element === null) {
    element = document.createElement('style');
    element.id = CSS_ID;
    document.head.appendChild(element);
  }
  const css = buildBookCss({
    tokens,
    options,
    fontToken,
    containerSelector: CONTAINER_SELECTOR,
    features,
  });
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
 * 套用与书页一致的排版（去掉栏 / 背景，按页框复刻量尺）
 *
 * **横排**：定宽（版心宽）量尺，与旧口径一致。
 * **直排**：工作表即**页框复刻**——buildPageStyle 的尺寸 / 页边距 padding /
 * 版框 border / border-box 一并复刻，行内流容器在内部填充内容盒。几何
 * （每列字数、页主轴容量）随后从复刻盒**实测**（见 MeasuredVerticalGeometry），
 * 不再用令牌名义值折算——浏览器对 double 边框的 used width 收敛（3px 实渲
 * 2.67px）会让名义折算与真实页差 1 字/列，页末系统性留白。复刻盒与真实页
 * 走同一浏览器、同一 CSS，used value 必然一致。背景仍跳过（不可见即可，
 * 无布局效果）；overflow 保持 visible（量尺主轴随全书内容增长，不能被页框
 * 裁掉）。
 */
function applySheetStyle(
  sheet: HTMLElement,
  rootStyle: StyleDeclaration,
  axis: MeasureAxis,
  contentMain: number,
  options: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): void {
  const skip = new Set(['column-count', 'column-gap', 'background-color', 'background']);
  sheet.style.cssText = '';
  for (const [prop, value] of Object.entries(rootStyle)) {
    if (skip.has(prop)) continue;
    sheet.style.setProperty(prop, value);
  }
  if (axis.vertical) {
    /* 页框复刻：尺寸 / 内边距 / 版框 / border-box 与真实页同构（buildPageStyle
     * 同源产出）；边框已在 rootStyle（buildRootStyle 非仿真时带 page-border），
     * 这里不再剔除。行内流容器在内部自动填充内容盒（直排块级子代的 inline 轴
     * auto = 填满），其内容盒即真实页的内容盒。 */
    const pageStyle = buildPageStyle(options.pageSize, tokens);
    for (const [prop, value] of Object.entries(pageStyle)) {
      sheet.style.setProperty(prop, value);
    }
    sheet.style.overflow = 'visible';
  } else {
    // 定交叉轴尺、主轴随内容，离屏不可见但保留布局盒（visibility:hidden 仍产生度量）
    //
    // 必须用 fixed 而非 absolute：长文档（尤其直排）量尺主轴会长到几十万 px，
    // absolute 定位在 left:-100000px 时右缘仍落在文档内（如 -100000 + 511277），
    // 会把文档的横向可滚动区撑到那一步，冒出一条几乎滚不动的横条；横条又吃掉
    // 视口高度，`height:100vh` 的外壳随之多出 15px，再连带出一条同样无意义的竖条。
    // fixed 元素的盒不参与文档滚动区计算，量尺再宽也不会撑出滚动条。
    const auto = `${Math.max(1, Math.round(contentMain))}px`;
    sheet.style.position = 'fixed';
    sheet.style.left = '-100000px';
    sheet.style.top = '0';
    sheet.style.width = auto;
    sheet.style.height = 'auto';
    sheet.style.minHeight = '0';
    sheet.style.maxHeight = 'none';
    sheet.style.overflow = 'visible';
    sheet.style.padding = '0';
    sheet.style.margin = '0';
    sheet.style.boxSizing = 'content-box';
  }
  sheet.style.position = 'fixed';
  sheet.style.left = '-100000px';
  sheet.style.top = '0';
  sheet.style.minWidth = '0';
  sheet.style.minHeight = '0';
  sheet.style.maxWidth = 'none';
  sheet.style.maxHeight = 'none';
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
  /* 共享流量尺：块包装器 display:contents 自身无盒——跨度取后代元素联合，
   * 尾距取末个后代元素的 block-end 外边距（真实页面同构的折叠口径） */
  if (axis.vertical && el.offsetWidth === 0) {
    const descendants = Array.from(el.querySelectorAll('*')) as HTMLElement[];
    if (descendants.length === 0) return 0;
    const rects = descendants.map((n) => n.getBoundingClientRect());
    const extent = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
    const last = descendants[descendants.length - 1] as HTMLElement;
    const lastCs = getComputedStyle(last);
    const m2 = axis.rl
      ? Number.parseFloat(lastCs.marginLeft) || 0
      : Number.parseFloat(lastCs.marginRight) || 0;
    return extent + Math.max(0, m2);
  }
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

/** 一行（列）行盒：基础文本的推进起点 + 交叉轴范围 */
interface MeasuredLineBox {
  /** 基础文本推进起点（行序 / 行首偏移二分用；注音不参与） */
  start: number;
  /** 交叉轴范围（横排 x、直排 y） */
  crossMin: number;
  crossMax: number;
}

/**
 * 由行起缘坐标推出逐行主轴尺寸（行推进量）。
 *
 * 逐行尺寸 = 相邻行起缘之差，末行补齐到块主轴尺寸，使各行之和恰等于块体高
 * （直排为宽）。不能改取单个文本矩形的主轴跨度：那是行内字形内容盒（16px
 * 字号 / 30.4px 行高时约 23px），比真实行推进小约 1/4，累加会让分页器高估
 * 每页可容纳行数，拆分片段渲染后越出版心。增量法天然保留 ruby 注音撑高的
 * 行盒（该行与下一行的起缘差随之变大）。
 *
 * @param starts 各行起缘（阅读顺序；直排 rl 为递减）
 * @param body 块主轴尺寸（横排 offsetHeight / 直排 offsetWidth）
 * @returns 逐行推进量（长度与 starts 一致）；量测异常时为空数组（调用方回退均高）
 */
export function lineAdvances(starts: readonly number[], body: number): number[] {
  if (starts.length < 2 || !(body > 0)) return [];
  const sizes: number[] = [];
  for (let k = 0; k + 1 < starts.length; k += 1) {
    const delta = Math.abs((starts[k + 1] as number) - (starts[k] as number));
    // 非正增量（行序重复）或超过块体（量测异常）都视为不可用
    if (!(delta > 0) || delta > body) return [];
    sizes.push(delta);
  }
  const span = Math.abs((starts[starts.length - 1] as number) - (starts[0] as number));
  const tail = body - span;
  if (!(tail > 0)) return [];
  sizes.push(tail);
  return sizes;
}

/**
 * 实测单块的逐行行盒：行首字符偏移 + 每行主轴尺寸。
 *
 * 行（列）划分只取基础文本矩形（跳过 `<rt>` 注文），避免注音行的 rt 被误判为
 * 独立一行；注音撑高的行盒由「行推进量」自动体现（该行与下一行的起缘差随之
 * 变大），无需单独并入 rt 矩形。happy-dom 无布局（rects 为空）→ 返回单行 [0]
 * + 空尺寸，由调用方回退均高估算。浏览器下产出的边界即真实换行 / 换列位置。
 *
 * 逐行尺寸见 lineAdvances：取行推进量而非字形内容盒，保证与块体尺寸同尺。
 */
function measureLineBoxes(
  el: HTMLElement,
  axis: MeasureAxis,
): { offsets: number[]; mainSizes: number[]; body: number } {
  const list = collectTextOffsets(el);
  const total = list.reduce((sum, entry) => sum + entry.len, 0);
  if (total === 0) return { offsets: [0], mainSizes: [], body: 0 };

  // 逐文本节点取矩形：整块 Range 会连带 `<rt>` 注文（它是真实文本节点），
  // 其推进坐标与基础行不同源，会把注音误算成额外一行
  const baseRects: DOMRect[] = [];
  for (const entry of list) {
    const range = document.createRange();
    range.selectNodeContents(entry.node);
    baseRects.push(
      ...Array.from(range.getClientRects()).filter((r) => r.height > 0 || r.width > 0),
    );
  }
  if (baseRects.length === 0) return { offsets: [0], mainSizes: [], body: 0 };

  // 归并同一行（列）的矩形（容差 2px）：同一行的多段文本 / 行内元素共享推进起点
  const boxes: MeasuredLineBox[] = [];
  for (const rect of baseRects) {
    const start = mainStartOf(rect, axis);
    const crossMin = crossStartOf(rect, axis);
    const crossMax = crossEndOf(rect, axis);
    const box = boxes.find((candidate) => Math.abs(candidate.start - start) <= 2);
    if (box === undefined) {
      boxes.push({ start, crossMin, crossMax });
      continue;
    }
    box.start = Math.min(box.start, start);
    box.crossMin = Math.min(box.crossMin, crossMin);
    box.crossMax = Math.max(box.crossMax, crossMax);
  }

  boxes.sort((a, b) => (axis.vertical && axis.rl ? b.start - a.start : a.start - b.start));
  if (boxes.length <= 1) return { offsets: [0], mainSizes: [], body: el.offsetWidth };

  /** 字符 g 的推进起点（行首偏移二分用） */
  const edgeOf = (g: number): number => {
    const loc = locateChar(list, Math.min(g, total - 1));
    if (loc === null) return Number.NaN;
    const r = document.createRange();
    const local = Math.min(loc.local, Math.max(0, loc.node.data.length - 1));
    r.setStart(loc.node, local);
    r.setEnd(loc.node, local + 1);
    return mainStartOf(r.getBoundingClientRect(), axis);
  };

  const edges = boxes.map((box) => box.start);
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

  /*
   * 行盒尺寸与行首偏移同序：仅在行数一致时成对产出（偏移去重后可能少于行盒）。
   * 逐行尺寸取行推进量而非字形内容盒（详见 lineAdvances）。
   * body 为块的主轴**联合跨度**（首列起缘 → 末列终缘，baseRects 全覆盖）：
   * 共享流量尺下块与块共享列，块的真实占位含末列的不满部分，必须用小数
   * 跨度记账——曾按 offsetWidth（整数、浏览器已按整列归并）取值，每块虚高
   * ~0.5 列 × 每页块数 = 页末 1~3 列空白。
   */
  const body =
    axis.vertical
      ? Math.max(...baseRects.map((r) => r.right)) - Math.min(...baseRects.map((r) => r.left))
      : Math.max(...baseRects.map((r) => r.bottom)) - Math.min(...baseRects.map((r) => r.top));
  const mainSizes =
    offsets.length === boxes.length ? lineAdvances(boxes.map((box) => box.start), body) : [];
  return { offsets, mainSizes, body };
}

/**
 * 直排字位坐标探针
 *
 * 把矩形的「列向缘 + 列内纵向偏移」换算成**绝对流位置**（单位：字位）：
 *
 * ```
 * position = 列序号 × 每列字数 + (纵向偏移 ÷ 字位步进)
 * ```
 *
 * 直排正文是字位网格（一列排满换列），故同一坐标系下相邻块的流位置之差
 * 就是块的**真实占位**（含列尾余量、行款空位盒、断列空转）。曾按相邻块
 * 的「行款起始缘（rect.right）之差」当推进量：同列内相邻块该缘完全相同
 * （都取到列右边界），差恒为 0 → 全部回退估算器，页内只能装十几块、
 * 每页大片空白。
 *
 * 列序号取整：列向坐标取矩形的**中心**再向下取整——字盒宽（1 字）比列距窄，
 * 若拿字盒的左右缘各自取整，同一列会算出相邻两个列号（右缘 → k、左缘 →
 * k+1），块跨度凭空多出整整一列（13 字段落量成 66 字位，分页器以为一页
 * 只装得下十几块）。列心落在 (k+0.5)×列距，向下取整后同列恒得 k，与字盒
 * 左对齐 / 居中 / 右对齐均无关；常量偏移（容器内边距）对所有块同时生效，
 * 在取差时抵消。
 */
function createSlotProbe(
  flow: HTMLElement,
  axis: MeasureAxis,
  slot: VerticalMeasureContext,
): (colCenter: number, crossEdge: number) => number {
  const rect = flow.getBoundingClientRect();
  const originMain = axis.rl ? rect.right : rect.left;
  const originCross = rect.top;
  return (colCenter, crossEdge) => {
    const col = Math.floor(
      (axis.rl ? originMain - colCenter : colCenter - originMain) / slot.columnPitch + 1e-6,
    );
    return col * slot.charsPerColumn + (crossEdge - originCross) / slot.charPitch;
  };
}

/**
 * 块的字位跨度（首字位 → 末字位之后）
 *
 * 块包装器是 `display:contents`（自身无盒），故用 Range 取**后代的行盒矩形**：
 * 竖排下每个矩形即一列在该块上的片段（top = 该列首字、bottom = 该列末字），
 * 首矩形取列序最前（rl 取最右）、末矩形取列序最后（rl 取最左）。跨度因此
 * 自动包含列尾余量与跨列空转，与真实页内占位同尺。
 */
function slotExtentOf(
  el: HTMLElement,
  axis: MeasureAxis,
  at: (colCenter: number, crossEdge: number) => number,
): { start: number; end: number } | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  const head = rects[0];
  if (head === undefined) return null;
  let first = head;
  let last = head;
  for (const rect of rects) {
    /* 列序最前 = 最靠右（rl）；同列内并列矩形（段首空位盒 bt-vpad 与首字
     * 右缘几乎重合）取**最上**者——块的流起点含空位盒，取到首字矩形会让
     * 块跨度少 1 个字位（分页预算少 1 字位/块，页末累积出 1 字溢出被裁）。
     * 列序最后同理取最下。 */
    if (axis.rl ? rect.right > first.right + 0.5 : rect.left < first.left - 0.5) {
      first = rect;
    } else if (
      Math.abs(rect.right - first.right) <= 0.5 &&
      Math.abs(rect.left - first.left) <= 0.5 &&
      rect.top < first.top
    ) {
      first = rect;
    }
    if (axis.rl ? rect.left < last.left - 0.5 : rect.right > last.right + 0.5) {
      last = rect;
    } else if (
      Math.abs(rect.right - last.right) <= 0.5 &&
      Math.abs(rect.left - last.left) <= 0.5 &&
      rect.bottom > last.bottom
    ) {
      last = rect;
    }
  }
  /* 列向取矩形中心：字盒（1 字宽）窄于列距，左右缘各自取整会落到相邻两列 */
  const centerOf = (rect: DOMRect): number => (rect.left + rect.right) / 2;
  return {
    start: at(centerOf(first), first.top),
    end: at(centerOf(last), last.bottom),
  };
}

/**
 * 复刻页框的实测几何（直排）
 *
 * 空复刻盒上先量出真实内容盒（浏览器 used border / padding 口径），折算
 * 每列字数与页主轴容量。量不出（happy-dom 等无布局环境 rect 为 0）返回
 * undefined，调用方回退令牌折算口径（与旧版行为一致）。
 */
function measureReplicaGeometry(
  sheet: HTMLElement,
  flow: HTMLElement,
  tokenSlot: VerticalMeasureContext,
): MeasuredVerticalGeometry | undefined {
  const flowRect = flow.getBoundingClientRect();
  const realCross = flowRect.height;
  if (!(realCross > 0) || !Number.isFinite(realCross)) return undefined;
  const sheetRect = sheet.getBoundingClientRect();
  if (!(sheetRect.width > 0)) return undefined;
  const cs = getComputedStyle(sheet);
  const borderX =
    (Number.parseFloat(cs.borderLeftWidth) || 0) + (Number.parseFloat(cs.borderRightWidth) || 0);
  const padX =
    (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
  const realMain = sheetRect.width - borderX - padX;
  if (!(realMain > 0) || !Number.isFinite(realMain)) return undefined;
  const charPitch = tokenSlot.charPitch;
  const columnPitch = tokenSlot.columnPitch;
  const charsPerColumn = Math.max(1, Math.floor(realCross / charPitch + 1e-6));
  /* 页主轴按列距取整（与 resolvePaginationGeometry 的直排量化同式），
   * 保证容量恒为整列数——每页末列满格、左右缘齐平（古籍形制） */
  const pageMainSize = Math.max(columnPitch, Math.floor(realMain / columnPitch + 1e-6) * columnPitch);
  return {
    pageMainSize,
    charsPerColumn,
    columnPitch,
    lineSize: columnPitch / charsPerColumn,
    charPitch,
    cross: realCross,
  };
}

/** 建表并渲染各块（复用），返回与 blocks 对齐的已渲染元素（含空位 null） */
function renderMeasureSheet(
  input: MeasureBlockSizesInput,
): {
  blocks: ReturnType<typeof extractBlocksIndexed>['blocks'];
  rendered: (HTMLElement | null)[];
  targetedOnly: boolean;
  axis: MeasureAxis;
  /** 直排字位口径（横排缺省）：每列字数 / 列距 / 字位步进 */
  slot?: VerticalMeasureContext;
  /** 直排共享流容器（字位坐标原点，横排缺省） */
  flow?: HTMLElement | null;
  /** 复刻页框实测几何（直排且可量测时产出；横排 / 无布局环境缺省） */
  geometry?: MeasuredVerticalGeometry;
} | null {
  if (typeof document === 'undefined') return null;

  const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, input.options ?? {});

  const axis = mainAxisOf(options.writingMode);
  const tokens = input.tokens ?? DEFAULT_THEME;
  /*
   * 版心交叉轴与渲染同源：直接采用 resolvePageCrossSize（渲染侧权威口径）。
   * 该函数的方向性语义：页眉页脚只在**直排**侵占交叉轴（天头地脚横条吃掉
   * 列的行长）故扣减；**横排**下它们侵占主轴（由 resolvePageMainSize 扣减），
   * 交叉轴不重复扣——曾在此按方向无关地手扣 chromeSize，横排行宽被系统性
   * 压窄 headerSize+footerSize，量尺与渲染整体错尺。边框仅非仿真扣除，
   * chrome 的 header/footer === 'none' 单侧跳过也由其处理。
   */
  const cross = resolvePageCrossSize(options, tokens);
  /*
   * 多栏：正文在「栏宽」内换行，故按**单栏宽**量尺（分页器容量侧乘栏数）。
   * 工作表不再叠加 column-count：定尺即单栏宽，再开多栏会把栏宽二次除以
   * N（2 栏时实测换行宽度 ≈ 版心宽/4），且 CSS balancing 会把块摊进多栏、
   * offsetTop 推进量错乱。直排多栏未定义（直排的结构分截走 bands），
   * 栏数 > 1 时按横排口径折算。
   */
  const columns = Math.min(3, Math.max(1, Math.round(options.columns ?? 1)));
  const gap = resolveColumnGapPx(tokens, columns);
  const contentMain =
    columns > 1 ? (cross - gap * (columns - 1)) / columns : cross;

  syncMeasureCss(tokens, options, input.fontToken, input.features);
  const sheet = ensureSheet();
  applySheetStyle(
    sheet,
    buildRootStyle({ tokens, options, fontToken: input.fontToken }),
    axis,
    contentMain,
    options,
    tokens,
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
  /*
   * 直排行内流同形态量尺（v2 批 2）：块 HTML 与预览同构（段落行内化、
   * 夹注双列小字盒），行边界与夹注原子性随真实布局自洽。
   * 每行大字数：**复刻页框实测**（measureReplicaGeometry）——曾按令牌折算
   * （resolveCharsPerColumn），浏览器对 double 边框的 used width 收敛让名义
   * 值与真实页差 1 字/列，分页按 53 字装箱、页面按 54 字换列，页末系统性
   * 留白 1/3 列。无布局环境（happy-dom）量不出时回退令牌口径
   * （resolveCharsPerColumn，与预览 readerColumnCapacity、打印 charsPerColumn、
   * 仿真几何层统一）。
   */
  if (axis.vertical) {
    /* 先渲染**空**复刻盒测真实几何：页框内容盒高与流内容无关（块级子代
     * inline 轴 auto = 填满），一次布局即可；实测后再按实测口径序列化，
     * 夹注双列小字盒的容量规划与真实页同源。 */
    sheet.innerHTML = `<div class="${CONTAINER_SELECTOR}__flow bt-vflow"></div>`;
    const probeFlow = sheet.firstElementChild as HTMLElement | null;
    let slot = resolveVerticalMeasureContext(options, tokens);
    let geometry: MeasuredVerticalGeometry | undefined;
    if (probeFlow !== null) {
      geometry = measureReplicaGeometry(sheet, probeFlow, slot);
      if (geometry !== undefined) {
        slot = {
          charsPerLine: 1,
          blockSpacing: 0,
          columnPitch: geometry.columnPitch,
          charsPerColumn: geometry.charsPerColumn,
          charPitch: geometry.charPitch,
          lineSize: geometry.lineSize,
        };
      }
    }
    const flowChars = slot.charsPerColumn;
    /* 直排：**共享流容器**量尺——所有块的行内流 HTML 连续放入同一个
     * `.bt-vflow`（块包装器 display:contents，不产生盒），与真实页面完全
     * 同构。曾把每块独立包在 block div 里：直排下每个 div 独立断列、
     * mainSize 向上取整到整列，而真实页面块与块**共享列**（上块末列的
     * 残差由下一段填充）——每块虚高 ~0.5 列 × 每页块数 = 页末 1~3 列空白。 */
    const blockHtml = blocks
      .map((block) => {
        const node = indexed.nodeById.get(block.id);
        if (node === undefined) return '';
        const html = serializeVerticalFlow([node], { charsPerColumn: flowChars });
        if (html.trim() === '') return '';
        return `<div class="${BLOCK_CLASS}" data-measure-id="${escapeAttr(block.id)}" style="display:contents">${html}</div>`;
      })
      .join('');
    sheet.innerHTML = `<div class="${CONTAINER_SELECTOR}__flow bt-vflow">${blockHtml}</div>`;
    const wrappers = Array.from(sheet.querySelectorAll(`[data-measure-id]`)) as HTMLElement[];
    const byId = new Map<string, HTMLElement>();
    for (const el of wrappers) {
      const id = el.getAttribute('data-measure-id');
      if (id !== null) byId.set(id, el);
    }
    const rendered = blocks.map((block) => byId.get(block.id) ?? null);
    /* 直排：字位口径与共享流容器一并回传——量尺按「列序号 × 每列字数 +
     * 列内字位偏移」求每块的绝对流位置（见 createSlotProbe） */
    return {
      blocks,
      rendered,
      targetedOnly,
      axis,
      slot,
      flow: sheet.firstElementChild as HTMLElement | null,
      ...(geometry !== undefined ? { geometry } : {}),
    };
  }
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
  /**
   * 排文主轴（直排 `'column'` / 横排 `'row'`）
   *
   * 与 `sizes` / `lineSizes` 同源解析：调用方把它透传给 `extractBlocks` 的
   * `axis`，块上的主轴标注即与实测口径一致（多栏回退时也照常给出）。
   */
  axis: BlockAxis;
  /** 块 id → 主轴推进尺寸(px)（到下一块上缘，含块间折叠外边距） */
  sizes: ReadonlyMap<string, number>;
  /**
   * 块 id → 行数（直排：字位数）
   *
   * 直排的一「行」就是一个字位（见 resolveVerticalMeasureContext），故本表给出
   * 的是块占用的**字位个数**；分页器按它做行级拆分，与字符的映射退化为恒等
   * （第 k 个字位 = 第 k 个字），跨页切片的字符边界与真实换列位置严格一致。
   * 横排不产出本表（行边界由 lineOffsets 承载）。
   */
  lineCounts: ReadonlyMap<string, number>;
  /** 块 id → 每行起始字符偏移[]（仅多行块产出） */
  lineOffsets: ReadonlyMap<string, number[]>;
  /** 块 id → 真实行高 px（自身高度 ÷ 行数，不含块间距；仅多行块产出） */
  lineSizes: ReadonlyMap<string, number>;
  /**
   * 块 id → 逐行主轴尺寸 px（长度 = 行数；仅多行块产出）
   *
   * 行盒逐行实测（含 ruby 注音增高），供 `extractBlocks` 的 `lineMainSizes`
   * 与分页器按行累加判页；`lineSizes` 是它的均值回退口径。
   */
  lineMainSizes: ReadonlyMap<string, number[]>;
  /**
   * 块 id → 块体高（px，offsetHeight：不含上 / 下外边距）
   *
   * sizes 是「推进量」（体高 + 与下一块的折叠间距），同一份间距在前后两块的
   * 入账里各算一次；供 extractBlocks 产出 bodyMainSize，让 paginate 按体高计
   * 追加代价，消除每页虚耗一份间距造成的页底空白。
   */
  bodySizes: ReadonlyMap<string, number>;
  /**
   * 直排实测几何（复刻页框产出；横排 / 无布局环境缺省）
   *
   * 宿主应把 `geometry.pageMainSize` 用作该方向的分页容量、把本几何折算的
   * 字位口径（charsPerColumn / lineSize / columnPitch / charPitch）传回
   * Reader 的 `measure`——量尺、分页、渲染三方同尺（见
   * {@link MeasuredVerticalGeometry} 的浏览器 used border 说明）。
   */
  geometry?: MeasuredVerticalGeometry;
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

/** 由布局选项解析块主轴（直排 → column；多栏回退时同样适用） */
function resolveBlockAxis(input: MeasureBlockSizesInput): BlockAxis {
  const options = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, input.options ?? {});
  return isVerticalMode(options.writingMode) ? 'column' : 'row';
}

/** 量尺主体（埋点在外层，便于把整段 DOM 实测算作一次测量） */
function measurePaginationInner(input: MeasureBlockSizesInput): MeasurePaginationResult {
  const blockAxis = resolveBlockAxis(input);
  const sheet = renderMeasureSheet(input);
  if (sheet === null)
    return {
      axis: blockAxis,
      sizes: new Map(),
      lineCounts: new Map(),
      lineOffsets: new Map(),
      lineSizes: new Map(),
      lineMainSizes: new Map(),
      bodySizes: new Map(),
    };
  const { blocks, rendered, targetedOnly, axis, slot, flow, geometry } = sheet;

  const sizes = new Map<string, number>();
  const lineCounts = new Map<string, number>();
  const lineOffsets = new Map<string, number[]>();
  const lineSizes = new Map<string, number>();
  const lineMainSizes = new Map<string, number[]>();
  const bodySizes = new Map<string, number>();
  /* 直排：字位绝对流位置（列序号 × 每列字数 + 列内字位）；横排不建 */
  const slotAt = slot !== undefined && flow ? createSlotProbe(flow, axis, slot) : null;
  const extents =
    slotAt === null
      ? []
      : rendered.map((el) => (el === null ? null : slotExtentOf(el, axis, slotAt)));
  for (let i = 0; i < blocks.length; i += 1) {
    // 定点模式：仅产出目标块（index 0）；后一块只为折叠口径参照，不入结果
    if (targetedOnly && i > 0) break;
    const el = rendered[i];
    if (el === null) continue;
    const id = (blocks[i] as (typeof blocks)[number]).id;
    if (axis.vertical && slot !== undefined && slotAt !== null) {
      measureVerticalBlock(id, el, i, extents, slot, rendered.length, slotAt, {
        sizes,
        lineCounts,
        lineOffsets,
        bodySizes,
      });
      continue;
    }
    // 逐块推进量 = 到下一渲染块首缘的距离（含块间折叠外边距；横排取上缘 offsetTop）
    let nextEl: HTMLElement | null = null;
    for (let j = i + 1; j < rendered.length; j += 1) {
      const cand = rendered[j];
      if (cand !== null) {
        nextEl = cand;
        break;
      }
    }
    const advance =
      nextEl === null ? lastBlockSize(el, axis) : nextEl.offsetTop - el.offsetTop;
    if (Number.isFinite(advance) && advance > 0) sizes.set(id, advance);
    const lines = measureLineBoxes(el, axis);
    const body = el.offsetHeight;
    if (body > 0) bodySizes.set(id, body);
    if (lines.offsets.length > 1) {
      lineOffsets.set(id, lines.offsets);
      // 真实行高（主轴推进）：自身跨度 ÷ 真实行数，避免把块间距摊进行高
      if (body > 0) lineSizes.set(id, body / lines.offsets.length);
      // 逐行行盒：注音行不等高时供分页按行累加（与 lineOffsets 等长才产出）
      if (lines.mainSizes.length === lines.offsets.length) {
        lineMainSizes.set(id, lines.mainSizes);
      }
    }
  }
  return {
    axis: blockAxis,
    sizes,
    lineCounts,
    lineOffsets,
    lineSizes,
    lineMainSizes,
    bodySizes,
    ...(geometry !== undefined ? { geometry } : {}),
  };
}

/**
 * 直排块内「宽字符」判定（每字符恰占 1 字位）
 *
 * CJK 统代表意字符、全角标点与**中文排版的全角形式标点**（破折号 ——、
 * 省略号 ……、弯引号 “”‘’——这些在 CJK 字体里是全宽字形，直排下每字
 * 恰推进 1 个字位步进；漏判会把均摊推进估成半字位，run 字符数翻倍，
 * 偏移表多交付字符 → 跨页片段溢出被裁）。拉丁字母 / 数字在 vertical-rl
 * 下侧旋排布，比例字宽均值 ≈ 半个字位（0.5 步进）。
 * 用于字位→字符偏移表的段内推进估算。
 */
function charIsWide(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xfe10 && code <= 0xfe4f) ||
    code === 0x2014 || // — 破折号（CJK 字体全宽）
    code === 0x2026 || // … 省略号（CJK 字体全宽）
    (code >= 0x2018 && code <= 0x201d) // ‘ ’ “ ” 弯引号（CJK 字体全宽）
  );
}

/**
 * 直排块的字位 → 字符偏移表（跨页切片的真实边界）
 *
 * 分页器按「字位」切片段，切片却要落成**字符区间**（sliceNodeByCharRange）。
 * 字位与字符不是恒等映射：段首空位盒（bt-vpad）占字位而无字符（+1 字位），
 * 侧旋的拉丁 / 数字每字符只推进约半个字位（字符多于字位）——恒等切片让
 * 续页片段比预算多渲 / 少渲若干字位，页末溢出 1~2 字位被页框裁掉（字符
 * 整段丢失 =「突然从中间截断」）或页底空出近一列。
 *
 * 本表从量尺 DOM 实测：逐文本节点取列段（run）矩形，run 起点（首字符的
 * 绝对流位置）精确探测；run 内字符按内容类型估算推进（宽字符 1 字位、
 * 窄字符 0.5 字位——比例字宽均值，±1 字误差不跨节点累积）。产出
 * `offsets[k] = 首个流位置 ≥ k 字位的字符偏移`（k = 0..⌈块字位跨度⌉），
 * 与 `charRangeForLines` 的实测偏移消费口径一致；空位盒无文本节点、自动
 * 体现在其后字符的实测位置里，无需显式登记。
 *
 * 无布局环境（happy-dom，矩形为 0）返回 null，调用方回退恒等映射。
 */
function measureSlotCharOffsets(
  el: HTMLElement,
  probe: (colCenter: number, crossEdge: number) => number,
  charPitch: number,
  slotSpan: number,
  blockStartSlot: number,
): number[] | null {
  const list = collectTextOffsets(el);
  const totalChars = list.reduce((sum, entry) => sum + entry.len, 0);
  if (totalChars === 0) return null;
  /* 每列段（run）：起点字位（精确探测）+ 段内字符数（估算后归一）。
   * 探针给出的是**共享流的绝对字位**，必须减去块首字位折成块内相对
   * 字位——分页切片的下标是块相对的，绝对值混入会让全部偏移塌到 0，
   * 所有跨页片段被切成空片段（内容整段丢失）。 */
  const runs: { startSlot: number; startChar: number; chars: number }[] = [];
  for (const entry of list) {
    const range = document.createRange();
    range.selectNodeContents(entry.node);
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.height > 0 || r.width > 0,
    );
    if (rects.length === 0) continue;
    const text = entry.node.data ?? '';
    const n = Math.max(1, text.length);
    let wide = 0;
    for (const ch of text) {
      if (charIsWide(ch)) wide += 1;
    }
    /* 节点均摊推进（字位/字符）：宽字符 1、窄字符 0.5，夹在 0.3~1 */
    const avgAdvance = Math.min(1, Math.max(0.3, (wide + (n - wide) * 0.5) / n));
    const raws = rects.map(
      (rect) => Math.max(1, Math.round(rect.height / charPitch / avgAdvance)),
    );
    /* 跨列节点按比例归一到节点真实字符数（估算的 ±1 字误差摊到段内，
     * 不落在段界上） */
    const rawSum = raws.reduce((sum, v) => sum + v, 0);
    const scale = rawSum > 0 ? n / rawSum : 1;
    let localChar = 0;
    let acc = 0;
    rects.forEach((rect, i) => {
      const chars = Math.max(1, Math.round(raws[i] * scale));
      const startSlot = probe((rect.left + rect.right) / 2, rect.top) - blockStartSlot;
      if (!Number.isFinite(startSlot)) return;
      runs.push({ startSlot, startChar: entry.start + localChar, chars });
      acc += chars;
      localChar = Math.min(n, acc);
    });
  }
  if (runs.length === 0) return null;
  runs.sort((a, b) => a.startSlot - b.startSlot);
  /*
   * offsets[k] = 首个流位置 ≥ k 字位的字符偏移。run 内按「每字恰推进
   * runChars/chars 字位」线性内插（宽字符恒 1 字位，段内插值即精确值）；
   * k 落在 run 之间的空档（空位盒 / 换列取整误差）取下一 run 首字，
   * 末 run 之后取总长（尾部空位之后无字）。
   */
  const lastK = Math.max(1, Math.ceil(slotSpan));
  const offsets: number[] = [];
  let r = 0;
  for (let k = 0; k <= lastK; k += 1) {
    while (r < runs.length && runs[r].startSlot + runs[r].chars <= k + 1e-6) r += 1;
    if (r >= runs.length) {
      offsets.push(totalChars);
      continue;
    }
    const run = runs[r];
    if (k >= run.startSlot - 1e-6) {
      offsets.push(Math.min(totalChars, run.startChar + Math.max(0, Math.round(k - run.startSlot))));
    } else {
      offsets.push(run.startChar);
    }
  }
  return offsets;
}

/** 直排单块的占位入账（字位口径） */
function measureVerticalBlock(
  id: string,
  el: HTMLElement,
  index: number,
  extents: readonly ({ start: number; end: number } | null)[],
  slot: VerticalMeasureContext,
  total: number,
  probe: (colCenter: number, crossEdge: number) => number,
  out: {
    sizes: Map<string, number>;
    lineCounts: Map<string, number>;
    lineOffsets: Map<string, number[]>;
    bodySizes: Map<string, number>;
  },
): void {
  const extent = extents[index] ?? null;
  if (extent === null) return;
  /* 字位跨度（slots）与主轴长度（px）严格分开：extent 是**字位数**，
   * 一切写进分页模型的 size 都必须是 px。曾把两者直接 Math.max 混用，
   * 每个连排段落的推进量被放大 1/lineSize（≈1.74）倍 → 分页预算按
   * 578px 报满、真实内容只占 405px，整页 40% 是空白。 */
  const slots = Math.max(0, extent.end - extent.start);
  const body = slots * slot.lineSize;
  if (!(body > 0)) return;
  out.bodySizes.set(id, body);
  /*
   * 推进量 = 到**下一块首字位**的流位置之差，而非块自身跨度：
   * - 连排段落（行内流）与后继同列接排，两值相等；
   * - 断列块（标题 / 表 / 图 / 注文）在竖排 block 流里是块级元素，块尾必落
   *   列尾（后继另起一列），这段空耗必须计入推进量，否则分页器以为还有
   *   空间、排进的内容在真实页末溢出被裁（用户可见的「段落截断」）。
   */
  let nextStart: number | null = null;
  for (let j = index + 1; j < total; j += 1) {
    const cand = extents[j];
    if (cand !== null && cand !== undefined) {
      nextStart = cand.start;
      break;
    }
  }
  const span = nextStart === null ? slots : Math.max(slots, nextStart - extent.start);
  const advance = span * slot.lineSize;
  if (Number.isFinite(advance) && advance > 0) out.sizes.set(id, advance);
  /*
   * 字位数四舍五入成整数行（分页器按整数行切）。切片边界不再按「第 k 字位 =
   * 第 k 字符」恒等折算——空位盒 / 侧旋拉丁让两者错位（见
   * measureSlotCharOffsets）；实测偏移表产出时以它为准，跨页片段的字符
   * 区间与真实字位边界严格一致，页末不再溢出被裁或留白。
   */
  out.lineCounts.set(id, Math.max(1, Math.round(slots)));
  const offsets = measureSlotCharOffsets(el, probe, slot.charPitch, slots, extent.start);
  if (offsets !== null) out.lineOffsets.set(id, offsets);
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
