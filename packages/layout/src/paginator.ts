/**
 * 分页器（纸书排版引擎 Phase 2：行级拆分 + 孤寡行控制）
 *
 * 输入为「已测量主轴尺寸的内容块」序列，输出页码编排结果。测量环节由渲染层
 * （DOM 实测或预测量）负责，本模块保持纯函数：
 *
 * - 贪心装箱：块沿主轴累加，超页则换页；
 * - breakBefore / breakAfter：强制换页（章首、卷末）；
 * - keepWithNext：与下一块保持同页（标题 + 首段），放不下则整体换页；
 * - 行级拆分（纸书核心）：块标记 splittable 且给出 lineSize 时，装不下的段落
 *   可在「行」处断开跨页续排（页是固定框、正文如水流动），而非整块挪页留白；
 * - 孤寡行控制：拆分后首页片段至少 minFirst 行、末页片段至少 minLast 行，
 *   不满足则相应增减本行取用或整体换页（避免报纸式孤行）；
 * - 超大块：可拆者按每页容纳行数连续拆分跨页；不可拆者独占一页（避免死循环）；
 * - 亚像素容差：页高与尺寸来自 DOM 实测普遍带小数（如行高 30.4），装页判断与
 *   行取数统一放宽 0.5px，避免小数累加把实渲放得下的尾行 / 尾块挤到下页；
 * - 块间间距前置记账：mainSize 是「推进量」（含与下一块的折叠外边距），故页内
 *   累加时每个块的入账额已连带支付了它与后继块之间的间距；因此「往本页追加
 *   一块」的真实代价只是该块的体高（bodyMainSize），而非整个推进量。按推进量
 *   判页会逐页虚耗一份间距（标题 UA 外边距 / 段后距，可达半行～一行），把本页
 *   其实放得下的块挤到下页 → 页底空白。不变式：页视觉占用 = usedMainSize −
 *   末片段的尾部间距（keepWithNext 的预留除外，那时本块必有同页后继）；
 * - 逐行行盒（lineMainSizes）：注音（ruby）等行内增高会让行高不等，给出实测逐行
 *   尺寸时按行累加判页 / 结算片段，缺省仍按均高 `lineSize`，行为与旧版一致；
 * - 页底溢出（bottomSlack）：版心底不当硬墙，末行允许伸入下边距 slack 那么深
 *   （由调用方按「不压页码带」截断后传入，见 resolveBottomSlack）。装箱剩余
 *   不足一整行就换页，每页恒虚耗 0~1 行（叠加孤寡行可达 1~2 行），本项把
 *   可用容量放宽为「版心高 + slack」，判页与入账仍按真实几何，不改渲染侧。
 *
 * 注：直排场景下「主轴」为横向（自右向左的行款），故字段统一命名为 mainSize，
 * 由调用方按书写方向传入相应测量值。向后兼容：不给 splittable / lineSize 时，
 * 行为与块原子版完全一致。
 */
import { PERF_PHASES, profilerOrNoop } from '@bibliotype/core';
import type { Profiler } from '@bibliotype/core';

/** 可分页内容块 */
export interface MeasurableBlock {
  /** 块标识（通常为 IR 节点 id） */
  id: string;
  /** 沿主轴方向的尺寸（px） */
  mainSize: number;
  /** 强制本块另起一页 */
  breakBefore?: boolean;
  /** 强制本块之后换页 */
  breakAfter?: boolean;
  /**
   * 强制本块另起一**列**（直排行内流，v2 批 4）
   *
   * 来自段落行款属性 `breakLine` / 平抬（`lift: 'newline'`）：本块从新列
   * 顶格起写（仍在本页，区别于 breakBefore 的另起页）。装箱把当前列的
   * 剩余空间弃用（usedMainSize 向上对齐到行距 = 列距的整数倍），渲染侧
   * 由行内流的断列标记（`bt-vbreak`）呈现同一语义——两端口径一致。
   * 仅 `axis: 'column'`（直排）生效；横排降级为普通换段（无操作）。
   */
  breakColumn?: boolean;
  /**
   * 两截本 / 三截本截位序号（0 = 上截，v2 批 5）
   *
   * `paginateInner` 按截位分组（组内容量 = 页容量 × 截高占比），再把各截
   * 页按序交错合并（同页含各截内容）。缺省 undefined = 不分截。
   */
  band?: number;
  /** 与下一块保持同页 */
  keepWithNext?: boolean;
  /** 单行沿主轴的尺寸（px）；与 splittable 配合启用行级拆分 */
  lineSize?: number;
  /**
   * 真实行数（DOM 实测行边界时给定）
   *
   * 缺省时 paginate 按 floor(mainSize/lineSize) 折算；估算 mainSize 含块尾间距
   * （lines×lineSize + blockSpacing），round 会在间距 ≥ 半行时多出幽灵行
   * （如 blockSpacing=12、lineSize=24 → +1 行），floor 折算稳定还原真实行数。
   */
  lineCount?: number;
  /**
   * 是否允许按行跨页拆分（仅正文段落为 true）
   *
   * 标题 / 封面 / 注文 / 牌记等须整块呈现，恒为 falsy。
   */
  splittable?: boolean;
  /**
   * 逐行主轴尺寸（px，DOM 实测；长度 = 真实行数）
   *
   * 注音（ruby）与大小字混排会让行盒沿主轴不等高：给出本字段时按行累加判页 /
   * 切片，不再用 `lineSize` 均高近似（均高会把矮行空间算给高行 → 页面溢出，
   * 或把高行压成矮行 → 注音被裁）。缺省或长度不符时整体回退 `lineSize`。
   */
  lineMainSizes?: number[];
  /**
   * 块体高（px，不含与下一块的块间折叠外边距）
   *
   * 页内追加放置的代价取本值（缺失时回退 mainSize）：mainSize 是到下一块上缘的
   * 推进量，其中那份间距无论本块留在本页还是换页都要支付（前者由前一块的入账额
   * 附带），重复计入会使每页虚耗一份间距、页底留出空白。不给时行为与旧口径一致。
   */
  bodyMainSize?: number;
  /**
   * 排文主轴（缺省 `'row'`）
   *
   * `'row'` = 横排：块沿页高方向推进、行内文字沿宽度换行；
   * `'column'` = 直排：块沿页宽方向推进、行内文字沿高度换列。
   * 尺寸口径始终是「沿主轴」，故分页算术与方向无关；本字段把量尺 / 分页 /
   * 切片三方的主轴口径显式化，避免下游把直排的 `lineSize`（列宽）误作行高。
   */
  axis?: BlockAxis;
  /**
   * 是否为页底浮注（脚注）
   *
   * 置 true 且开启 `PaginateOptions.noteArea` 时，本块不进正文流：它落在所在页的
   * 页底注区，正文容量相应扣减（页底注区动态收缩正文）。注区超出页面上限时
   * 整条续到下一页页底（跨页续注）。
   */
  floatToBottom?: boolean;
  /**
   * 本块所在结构节点的分栏数（1~3，缺省 1）
   *
   * 分栏数变化时会开启新页（同一物理页内不混排不同栏数）；页容量按
   * `pageMainSize × columns` 装箱，不可拆块放不进当前列剩余空间时对齐到
   * 下一列首，渲染侧用 CSS 多栏把整页内容按序分配到各栏。多栏按横排
   * 语义定义（每栏占满 pageMainSize 主轴）；直排 + 多栏的组合未定义
   * （直排的结构分截走 bands），调用方应避免同时声明。
   */
  columns?: number;
  /**
   * 一列沿主轴的宽度（px，直排用）
   *
   * 直排的 `lineSize` 是**一个字位**的宽度（列距 ÷ 每列字数）而非一整列，
   * 故 `breakColumn` 的对齐单位不能取 lineSize（会把列首对齐到字位网格，
   * 断列失效）；本字段给出列宽，缺省回退 `lineSize`（横排多栏语义）。
   */
  columnMainSize?: number;
}

/** 排文主轴：横排按行（row）推进，直排按列（column）推进 */
export type BlockAxis = 'row' | 'column';

/** 取块的主轴口径（缺省横排） */
export function blockAxisOf(block: MeasurableBlock): BlockAxis {
  return block.axis ?? 'row';
}

/** 页内条目：一个块片段（未拆分时即整块） */
export interface PageItem {
  /** 源块 */
  block: MeasurableBlock;
  /** 本片段起始行（0 起，块内相对；未拆分为 0） */
  fromLine: number;
  /** 本片段行数（未拆分 / 不可拆块为 0，表示「整块渲染」） */
  lineCount: number;
  /** 本片段沿主轴尺寸（px） */
  mainSize: number;
}

/** 分页结果中的单页 */
export interface PaginatedPage {
  /** 页码（自 0 起） */
  index: number;
  /** 本页片段序列（行级渲染契约） */
  items: PageItem[];
  /** 本页出现的块（跨页拆分的块会在多页各出现一次；向后兼容旧消费方） */
  blocks: MeasurableBlock[];
  /**
   * 本页入账的推进量总和（含末块未渲染的尾部间距，故可略超 pageMainSize）
   *
   * 页内实际占主轴 = 本值 − 末片段的尾部块间距；可用余量据此判断是否为页底空白。
   */
  usedMainSize: number;
  /**
   * 本页页底注（仅开启 `noteArea` 且块标 `floatToBottom` 时出现）
   *
   * 页底注不占正文的 `items` / `usedMainSize`：渲染侧把它们排在版心底部的注区，
   * 并用 `noteMainSize` 判断注区高度（正文容量已为此扣减）。
   */
  notes?: PageItem[];
  /** 本页页底注区占用的主轴尺寸（px，缺省 0） */
  noteMainSize?: number;
  /**
   * 本页注区承接上一页溢出的注释（跨页续注）
   *
   * 仅当上页注区已满、本页是续接页时置真；渲染侧据以在注区顶部输出「续前页」标记。
   */
  notesCarried?: boolean;
  /** 本页分栏数（>1 时附带；缺省 1 表示单栏，产物结构与旧版一致） */
  columns?: number;
  /** 本页分截声明（两截本 / 三截本；缺省不分截） */
  bands?: { count: number; ratios: readonly number[] };
}

/** 孤寡行控制 */
export interface WidowControl {
  /** 拆分后「首页片段」最少行数（孤行控制，默认 2） */
  minFirst?: number;
  /** 拆分后「末页片段」最少行数（寡行控制，默认 2） */
  minLast?: number;
}

/** 分页选项 */
export interface PaginateOptions {
  /** 每页可用主轴尺寸（px，版心高） */
  pageMainSize: number;
  /**
   * 页底溢出（px，缺省 0）：换页线自版心底下移本值，末行可伸入下边距
   *
   * 只放宽「装得下」的容量（判页 / 取行），不改变任何块的入账尺寸与渲染几何；
   * 上限须由调用方按页码带截断（见 layout 的 `resolveBottomSlack`）。
   */
  bottomSlack?: number;
  /** 孤寡行控制（缺省 2 / 2） */
  widowControl?: WidowControl;
  /**
   * 两截本 / 三截本声明（v2 批 5，缺省不分截）
   *
   * 提供时按块 `band` 序号分组，各截以「页容量 × 截高占比」独立分页，
   * 页按序交错合并（同页含各截内容；某截页数不足则该位留空）。与分栏
   * （columns）互斥——两截本固定单栏；与页底浮注并存未支持（bands 时
   * noteArea 被忽略，文档记录）。
   */
  bands?: { count: number; ratios: readonly number[] };
  /**
   * 页底注区（脚注浮注，缺省不开启）
   *
   * 开启后，标了 `floatToBottom` 的块不进正文流，而是落在所在页的页底注区；
   * 正文可用主轴 = 页面容量 − 注区高度，即注区动态收缩正文。
   */
  noteArea?: NoteAreaOptions;
  /** 性能探针（I7，缺省 no-op：不传零行为零开销） */
  profiler?: Profiler;
  /**
   * 续排起点（增量分页）：从 `startIndex` 块起继续分页，`prefix` 页原样保留
   *
   * 只用于「前面的块尺寸未变、仅第 startIndex 块及之后受影响」的场景：
   * 流式贪心下，`prefix` 页的内容只由它们之前的块决定，与后续块无关，
   * 因此可原样复用（页对象不重建、引用不变 → 下游片段缓存仍命中）。
   * 调用方须保证 `startIndex` 是「受影响页的首块」——即该块在新旧两轮里
   * 都从页首开始放置（不是跨页续排的后续片段），否则会多出一页。
   */
  resume?: PaginateResume;
}

/** 增量分页的续排起点 */
export interface PaginateResume {
  /** 已确定的页（页码自 0 连续，通常为旧结果的 pages[0..P-1]） */
  prefix: readonly PaginatedPage[];
  /** 从该块索引起继续分页（该块从新页页首起排） */
  startIndex: number;
}

/** 页底注区选项 */
export interface NoteAreaOptions {
  /** 注区最多占页面可用主轴的多少（0~1，缺省 0.4；单条注超过时仍独占一页，不死循环） */
  maxRatio?: number;
}

/** 分页统计 */
export interface PaginationResult {
  pages: PaginatedPage[];
  /** 总页数 */
  totalPages: number;
  /** 总块数 */
  totalBlocks: number;
}

/** 块是否可按行拆分 */
function isSplittable(block: MeasurableBlock): boolean {
  return (
    block.splittable === true &&
    typeof block.lineSize === 'number' &&
    block.lineSize > 0
  );
}

/**
 * 亚像素容差（px）
 *
 * 页高与块推进量来自 getComputedStyle / offsetTop，普遍带小数（如行高 30.4）；
 * 严格 ≤ 与向下取整会把「实渲放得下」的尾行 / 尾块挤到下一页，且误差逐块累积，
 * 一页可虚耗近一行。比较统一放宽半个像素，行取数先加容差再向下取整。
 */
const SUBPIXEL_TOL = 0.5;

/** 带容差的「装得下」判断 */
function fits(used: number, required: number, capacity: number): boolean {
  return used + required <= capacity + SUBPIXEL_TOL;
}

/** 带容差的「可放行数」（向下取整前先把可用空间放宽半个像素） */
function linesWithin(avail: number, lineSize: number): number {
  return Math.floor((avail + SUBPIXEL_TOL) / lineSize);
}

/** 块的真实行数：逐行尺寸优先，其次显式 lineCount，最后按 mainSize/lineSize 折算 */
export function lineCountOfBlock(block: MeasurableBlock): number {
  const sizes = block.lineMainSizes;
  if (sizes !== undefined && sizes.length > 0) return sizes.length;
  return block.lineCount ?? Math.max(1, Math.floor(block.mainSize / (block.lineSize as number)));
}

/** 第 index 行沿主轴的尺寸（逐行尺寸优先，越界 / 缺省回退均高 `lineSize`） */
export function lineMainSizeAt(block: MeasurableBlock, index: number): number {
  const sizes = block.lineMainSizes;
  if (sizes !== undefined && index >= 0 && index < sizes.length) {
    return sizes[index] as number;
  }
  return block.lineSize as number;
}

/**
 * [from, from+count) 行的主轴尺寸合计
 *
 * 与 `count × lineSize` 在无逐行尺寸时完全等价；供分页器与渲染层（片段尺寸、
 * 续排切片）共用同一口径，避免两侧一个按均高、一个按逐行累加而错位。
 */
export function lineRangeMainSize(
  block: MeasurableBlock,
  from: number,
  count: number,
): number {
  const sizes = block.lineMainSizes;
  if (sizes === undefined || sizes.length === 0) {
    return count * (block.lineSize as number);
  }
  let sum = 0;
  for (let i = from; i < from + count; i += 1) {
    sum += sizes[i] ?? (block.lineSize as number);
  }
  return sum;
}

/** 从 from 行起，avail 空间内能放下的行数（逐行尺寸优先，带亚像素容差） */
function linesFitting(block: MeasurableBlock, from: number, avail: number): number {
  const sizes = block.lineMainSizes;
  if (sizes === undefined || sizes.length === 0) {
    return linesWithin(avail, block.lineSize as number);
  }
  let used = 0;
  let count = 0;
  for (let i = from; i < sizes.length; i += 1) {
    const size = sizes[i] as number;
    if (used + size > avail + SUBPIXEL_TOL) break;
    used += size;
    count += 1;
  }
  return count;
}

/**
 * 页内追加一块的真实代价（px）
 *
 * 取块体高：与下一块的折叠间距已包含在前一块的推进量入账里（同页时该间距就
 * 渲染在这两份入账之间），按 mainSize 判页会多扣一份间距。不可拆块同样受益
 * （标题 / 注文 的 UA 外边距可达 20px+）。缺 bodyMainSize 时回退 mainSize。
 */
function costOf(block: MeasurableBlock): number {
  const body = block.bodyMainSize;
  return typeof body === 'number' && body > 0 && body <= block.mainSize ? body : block.mainSize;
}

/**
 * 执行分页
 *
 * @throws RangeError 当 pageMainSize 非正数或块尺寸为负。
 */
function paginateSingle(
  blocks: readonly MeasurableBlock[],
  options: PaginateOptions,
  columns = 1,
): PaginationResult {
  const { pageMainSize } = options;
  if (pageMainSize <= 0) {
    throw new RangeError(`pageMainSize 必须为正数：${pageMainSize}`);
  }
  /*
   * 装箱容量 = 页主轴容量 × 栏数 + 页底溢出：只影响「装得下」的判断，不改
   * 任何块的入账尺寸（usedMainSize 仍是真实推进量之和，供上层量页底残留）。
   * 多栏（columns > 1）按「单序列 × 栏数容量」装箱：块沿主轴顺序推进，
   * 列边界在 k × pageMainSize；渲染侧 CSS 多栏把页内容按序分配到各栏。
   */
  const slack = options.bottomSlack ?? 0;
  const capacity = pageMainSize * columns + (slack > 0 ? slack : 0);
  for (const block of blocks) {
    if (block.mainSize < 0) {
      throw new RangeError(`块 "${block.id}" 的 mainSize 不能为负：${block.mainSize}`);
    }
  }

  const minFirst = Math.max(1, options.widowControl?.minFirst ?? 2);
  const minLast = Math.max(1, options.widowControl?.minLast ?? 2);

  if (blocks.length === 0) {
    return { pages: [], totalPages: 0, totalBlocks: 0 };
  }

  interface MutablePage {
    items: PageItem[];
    /**
     * 本页入账的推进量总和
     *
     * 记账口径：每块按推进量（含与后继块的折叠间距）入账，页视觉占用恒等于
     * 本值减去末块的尾部间距（该间距仅在下一块同页追加时才渲染）；放置判断
     * 因此按块体高取代价（见 costOf）。
     */
    usedMainSize: number;
    /** 页底注区条目 */
    notes: PageItem[];
    /** 页底注区占用的主轴尺寸 */
    noteSize: number;
    /**
     * 本页注区承接上一页溢出的注释（跨页续注）
     *
     * 仅当上页注区已满、本页是 `placeNote` 因溢出新建的续接页时置真；
     * 渲染侧据以在注区顶部输出「续前页」标记。
     */
    notesCarried?: boolean;
  }
  // 增量续排：前缀页原样复用（只由前面的块决定，与后续块无关），从 startIndex 起从新页续排
  const startIndex =
    options.resume === undefined
      ? 0
      : Math.max(0, Math.min(options.resume.startIndex, blocks.length));
  const pages: MutablePage[] = (options.resume?.prefix ?? []).map((page) => ({
    items: [...page.items],
    usedMainSize: page.usedMainSize,
    notes: [...(page.notes ?? [])],
    noteSize: page.noteMainSize ?? 0,
    notesCarried: page.notesCarried,
  }));
  let cur: MutablePage = { items: [], usedMainSize: 0, notes: [], noteSize: 0 };
  let pendingBreak = false;

  function startPage(): MutablePage {
    const page: MutablePage = { items: [], usedMainSize: 0, notes: [], noteSize: 0 };
    pages.push(page);
    return page;
  }

  /* 页底注区：上限 = 页面容量 × maxRatio（缺省 0.4，夹在 5%~100%） */
  const noteArea = options.noteArea;
  const noteLimit =
    noteArea === undefined
      ? 0
      : capacity * Math.min(1, Math.max(0.05, noteArea.maxRatio ?? 0.4));

  /** 本页正文可用容量（扣掉页底注区：注区越高，正文越短） */
  function bodyCapacity(): number {
    return noteArea === undefined ? capacity : Math.max(0, capacity - cur.noteSize);
  }

  /**
   * 放置一条页底注
   *
   * 注区满（超过页面上限）或「正文 + 累计注文」放不下时，注文整条续到
   * 下一页页底；单条注自身超过上限时仍独占一页（避免死循环），交由渲染侧
   * 截断 / 拆条。记账口径：注区与正文共享页面容量，判断必须按
   * 「正文已入账 + 全部注区（含本条）」累计——只按单条注判会叠出页底
   * （正文 500 + 注 60 + 注 60 = 620 排进 600px 页的实证缺陷）。
   */
  function placeNote(block: MeasurableBlock): void {
    const size = costOf(block);
    /* 空页（无正文也无注文）不判溢出：单条超限注独占一页由这里放行 */
    const hasContent = cur.usedMainSize > 0 || cur.noteSize > 0;
    const overflow =
      hasContent &&
      (cur.noteSize + size > noteLimit || cur.usedMainSize + cur.noteSize + size > capacity);
    if (overflow) {
      cur = startPage();
      cur.notesCarried = true;
    }
    cur.notes.push({ block, fromLine: 0, lineCount: 0, mainSize: size });
    cur.noteSize += size;
  }
  if (startIndex < blocks.length) cur = startPage();

  function pushFragment(block: MeasurableBlock, fromLine: number, lineCount: number, size: number): void {
    cur.items.push({ block, fromLine, lineCount, mainSize: size });
    cur.usedMainSize += size;
  }

  /** keepWithNext 时下一块「至少需与标题同页」的头部代价 */
  function headSizeOf(block: MeasurableBlock, next: MeasurableBlock): number {
    if (!isSplittable(next)) return costOf(next);
    const totalLines = lineCountOfBlock(next);
    // 放置标题后，下一段在本页可容纳的行数；模拟 placeSplittable 的取行约束：
    // 头部合规行数取不足（minFirst / minLast 不满足）时下一段会整体换页，
    // 此时改要求整段随标题同页，避免标题违反 keepWithNext 孤悬页尾
    const availLines = linesFitting(
      next,
      0,
      bodyCapacity() - (cur.usedMainSize + block.mainSize),
    );
    if (availLines < totalLines) {
      const leftover = totalLines - availLines;
      const take = leftover < minLast ? totalLines - minLast : availLines;
      if (take < minFirst) return costOf(next);
    }
    return Math.min(costOf(next), lineRangeMainSize(next, 0, minFirst));
  }

  /**
   * 多栏列边界对齐：原子块（含 keepWithNext 预留）放不进当前列剩余空间时，
   * 弃用列尾空白、把推进量对齐到下一列首（块从新列顶格起写，仍在同页）。
   *
   * 容量模型：页容量 = 栏容量（pageMainSize）× 栏数，块沿主轴顺序推进；
   * CSS 多栏按序填充各栏，不认分页器的栏归属——分页器只需保证两点：
   * ① 页总量 ≤ 栏容量 × 栏数；② 不可拆块不跨列（跨列会被 break-inside
   * 整体挪栏，产生分页器不知情的额外空白）。可拆块（段落）可跨列断行，
   * 与 CSS 行为一致，无需对齐。
   */
  function padToNextColumn(required: number): void {
    if (columns <= 1) return;
    const pos = cur.usedMainSize % pageMainSize;
    if (pos > 0 && pos + required > pageMainSize + SUBPIXEL_TOL) {
      cur.usedMainSize += pageMainSize - pos;
    }
  }

  /** 页面对正文是否为「真空页」（无正文也无注文——注文占页时正文须另起） */
  function pageEmptyForBody(): boolean {
    return cur.items.length === 0 && cur.noteSize === 0;
  }

  /** 不可拆块：整块贪心放置（保持块原子版行为） */
  function placeAtomic(block: MeasurableBlock, next: MeasurableBlock | undefined): void {
    const keep = block.keepWithNext === true && next !== undefined && next.breakBefore !== true;
    // 代价取体高：前一块的推进量入账已附带本块上方的折叠间距。但 keepWithNext
    // 成立时本块必有同页后继，其尾部间距会真实渲染 → 改按推进量入账再加后继预留
    const required = keep
      ? block.mainSize + headSizeOf(block, next as MeasurableBlock)
      : costOf(block);
    padToNextColumn(required);
    // 「空页也必须放置」（超大块独占一页，避免死循环）只对真空页放行：
    // 注文已占页时正文放不下须另起，否则注文与正文在页底重叠
    if (!fits(cur.usedMainSize, required, bodyCapacity()) && !pageEmptyForBody()) {
      cur = startPage();
    }
    // 入账仍用推进量（含块尾间距）
    pushFragment(block, 0, 0, block.mainSize);
  }

  /** 可拆块：按行跨页续排，含孤寡行约束 */
  function placeSplittable(block: MeasurableBlock): void {
    const totalLines = lineCountOfBlock(block);
    let from = 0;
    let remaining = totalLines;

    while (remaining > 0) {
      // 页内剩余空间取未入账值：上一块的推进量入账已附带本片段上方的折叠间距，
      // 换页后的空页则无此负担（usedMainSize = 0），两种情形口径一致
      const avail = bodyCapacity() - cur.usedMainSize;
      let availLines = linesFitting(block, from, avail);
      if (availLines <= 0) {
        if (!pageEmptyForBody()) {
          cur = startPage();
          continue;
        }
        availLines = 1; // 病态页（行高 > 页）兜底推进
      }

      let take = Math.min(availLines, remaining);
      const leftover = remaining - take;
      // 整块从块首起完整落入本页：按「未拆分」输出（与原子块同一契约 lineCount=0）
      if (from === 0 && leftover === 0) {
        pushFragment(block, 0, 0, block.mainSize);
        break;
      }
      if (leftover > 0) {
        // 将拆分：先保证末页片段 ≥ minLast（不足则少取，把行留给续页）
        if (leftover < minLast) {
          take = remaining - minLast;
        }
        // 再保证首页片段 ≥ minFirst（块首片段在本页放不下合规头部则整体换页）
        if (from === 0 && take < minFirst) {
          if (cur.items.length > 0) {
            cur = startPage();
            continue;
          }
          take = Math.min(remaining, availLines);
        }
        if (take < 1) {
          if (cur.items.length > 0) {
            cur = startPage();
            continue;
          }
          take = 1; // 病态页（行高 > 页）兜底推进
        }
      }

      // 块尾片段一次性结算 mainSize 余量（含块尾折叠外边距），行高不含间距时不丢账
      const size =
        from + take >= totalLines
          ? Math.max(
              lineRangeMainSize(block, from, take),
              block.mainSize - lineRangeMainSize(block, 0, from),
            )
          : lineRangeMainSize(block, from, take);
      pushFragment(block, from, take, size);
      from += take;
      remaining -= take;
      if (remaining > 0) {
        cur = startPage(); // 余下部分续到下一页
      }
    }
  }

  for (let i = startIndex; i < blocks.length; i += 1) {
    const block = blocks[i] as MeasurableBlock;
    const onFreshPage = cur.items.length === 0 && cur.notes.length === 0;
    if (!onFreshPage && (pendingBreak || block.breakBefore === true)) {
      cur = startPage();
    }
    pendingBreak = false;

    /* 列级断列（直排行内流）：当前列剩余空间弃用（对齐列距），本块从新列
     * 顶格起写；横排（axis 'row'）无列概念，无操作。对齐单位取列宽
     * （columnMainSize）而非 lineSize：直排 lineSize 是一个字位宽，按它对
     * 齐等于把块对齐到字位网格，断列完全失效。 */
    if (
      !onFreshPage &&
      block.breakColumn === true &&
      blockAxisOf(block) === 'column'
    ) {
      const pitch = block.columnMainSize ?? block.lineSize ?? 0;
      if (pitch > 0) cur.usedMainSize = Math.ceil(cur.usedMainSize / pitch - 1e-9) * pitch;
    }

    /* 页底浮注：不进正文流，落到本页注区（容量随之收缩） */
    if (noteArea !== undefined && block.floatToBottom === true) {
      placeNote(block);
      if (block.breakAfter === true) pendingBreak = true;
      continue;
    }

    if (isSplittable(block)) {
      placeSplittable(block);
    } else {
      placeAtomic(block, blocks[i + 1]);
    }

    if (block.breakAfter === true) {
      pendingBreak = true;
    }
  }

  const resultPages: PaginatedPage[] = pages.map((page, index) => {
    const base: PaginatedPage = {
      index,
      items: page.items,
      blocks: page.items.map((item) => item.block),
      usedMainSize: page.usedMainSize,
      ...(columns > 1 ? { columns } : {}),
    };
    /* 仅在开启注区时附带注字段，保证未开启时的产物结构完全不变 */
    if (noteArea === undefined) return base;
    return { ...base, notes: page.notes, noteMainSize: page.noteSize, notesCarried: page.notesCarried };
  });

  return {
    pages: resultPages,
    totalPages: resultPages.length,
    totalBlocks: blocks.length,
  };
}

/** 单块分栏数（夹在 1~3） */
function columnsOfBlock(block: MeasurableBlock): number {
  const raw = block.columns;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.min(3, Math.max(1, Math.round(raw)));
}

/**
 * 分页（公开入口，支持分栏）
 *
 * 分栏模型（单序列 × 栏数容量）：页容量 = 栏容量（pageMainSize）× 栏数，
 * 块沿主轴顺序装箱，不可拆块放不进当前列剩余空间时对齐到下一列首
 * （弃用列尾空白）；渲染侧用 CSS 多栏把整页内容按序分配到各栏。栏数
 * 以「块所在结构节点的 columns 属性」为准（随结构树继承），栏数变化
 * 即开新页（同一物理页内不混排不同栏数）。
 *
 * 约束：
 * - 同一物理页不混排不同栏数（栏数变化即开新页）；
 * - 跨栏数组（组间）不支持增量续排（`resume` 被忽略）；单一栏数组时
 *   resume 语义与单栏一致；
 * - 栏数取 1~3，越界夹紧；
 * - 多栏与分截（bands）互斥：bands 时忽略 columns 分组，两截本固定单栏；
 *   多栏与页底浮注（noteArea）可在单一栏数组内共存（注区容量按页总量计）。
 */
export function paginate(
  blocks: readonly MeasurableBlock[],
  options: PaginateOptions,
): PaginationResult {
  /* I7：可选探针（缺省 no-op，零行为）；span 覆盖整轮装箱（含校验与分栏分组） */
  const profiler = profilerOrNoop(options.profiler);
  const span = profiler.span(PERF_PHASES.LAYOUT, { blocks: blocks.length });
  try {
    return paginateInner(blocks, options);
  } finally {
    span.end();
  }
}

function paginateInner(
  blocks: readonly MeasurableBlock[],
  options: PaginateOptions,
): PaginationResult {
  /* 与单栏核心保持一致的参数契约（空 blocks 也要先校验） */
  if (!(options.pageMainSize > 0)) {
    throw new RangeError(`pageMainSize 必须为正数：${options.pageMainSize}`);
  }
  for (const block of blocks) {
    if (block.mainSize < 0) {
      throw new RangeError(`块 "${block.id}" 的 mainSize 不能为负：${block.mainSize}`);
    }
  }
  if (blocks.length === 0) {
    return { pages: [], totalPages: 0, totalBlocks: 0 };
  }

  /*
   * 两截本 / 三截本（v2 批 5）：按截位分组、各截独立分页、页按序交错合并。
   * 与分栏互斥（bands 时忽略 columns 分组）；页底浮注并存未支持（bands 时
   * 忽略 noteArea——文档记录）。空位页由存在该截内容的合并页自然缺失。
   */
  if (options.bands !== undefined && options.bands.count >= 2) {
    const { count, ratios } = options.bands;
    const bandPages: PaginatedPage[][] = [];
    for (let band = 0; band < count; band += 1) {
      const bandBlocks = blocks.filter((block) => (block.band ?? count - 1) === band);
      const ratio = ratios[band] ?? 1 / count;
      const result = paginateSingle(bandBlocks, {
        ...options,
        pageMainSize: Math.max(1, options.pageMainSize * ratio),
        noteArea: undefined,
        resume: undefined,
      });
      bandPages.push(result.pages);
    }
    const totalPages = Math.max(...bandPages.map((pages) => pages.length), 1);
    const pages: PaginatedPage[] = [];
    for (let index = 0; index < totalPages; index += 1) {
      const items = bandPages.flatMap((pages) => pages[index]?.items ?? []);
      if (items.length === 0) {
        /* 各截本位均无内容（越界合并页）——跳过（全书页数由最大截决定） */
        continue;
      }
      pages.push({
        index: pages.length,
        items,
        blocks: items.map((item) => item.block),
        usedMainSize: bandPages.reduce((sum, pages) => sum + (pages[index]?.usedMainSize ?? 0), 0),
        bands: options.bands,
      });
    }
    if (pages.length === 0) {
      return paginateSingle(blocks, { ...options, noteArea: undefined }, 1);
    }
    return { pages, totalPages: pages.length, totalBlocks: blocks.length };
  }

  const groups: { columns: number; blocks: MeasurableBlock[] }[] = [];
  for (const block of blocks) {
    const columns = columnsOfBlock(block);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.columns === columns) {
      last.blocks.push(block);
    } else {
      groups.push({ columns, blocks: [block] });
    }
  }

  /*
   * 单一栏数组：单序列直通 paginateSingle（栏数进容量与列边界对齐；
   * resume 语义天然成立——前缀页只由之前的块决定）。
   */
  if (groups.length === 1) {
    const group = groups[0]!;
    return paginateSingle(group.blocks, options, group.columns);
  }

  /*
   * 栏数变化切组：组间开新页（组内以该组栏数装箱），组页按序拼接。
   * 跨组续排语义未定义，resume 被忽略（调用方需整篇重排）。
   */
  const pages: PaginatedPage[] = [];
  for (const group of groups) {
    const result = paginateSingle(group.blocks, { ...options, resume: undefined }, group.columns);
    for (const page of result.pages) {
      pages.push({ ...page, index: pages.length });
    }
  }

  return { pages, totalPages: pages.length, totalBlocks: blocks.length };
}
