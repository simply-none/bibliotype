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
 * - 超大块：可拆者按每页容纳行数连续拆分跨页；不可拆者独占一页（避免死循环）。
 *
 * 注：直排场景下「主轴」为横向（自右向左的行款），故字段统一命名为 mainSize，
 * 由调用方按书写方向传入相应测量值。向后兼容：不给 splittable / lineSize 时，
 * 行为与块原子版完全一致。
 */

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
  /** 本页已用主轴尺寸 */
  usedMainSize: number;
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
  /** 每页可用主轴尺寸（px） */
  pageMainSize: number;
  /** 孤寡行控制（缺省 2 / 2） */
  widowControl?: WidowControl;
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
 * 执行分页
 *
 * @throws RangeError 当 pageMainSize 非正数或块尺寸为负。
 */
export function paginate(
  blocks: readonly MeasurableBlock[],
  options: PaginateOptions,
): PaginationResult {
  const { pageMainSize } = options;
  if (pageMainSize <= 0) {
    throw new RangeError(`pageMainSize 必须为正数：${pageMainSize}`);
  }
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
    usedMainSize: number;
  }
  // 增量续排：前缀页原样复用（只由前面的块决定，与后续块无关），从 startIndex 起从新页续排
  const startIndex =
    options.resume === undefined
      ? 0
      : Math.max(0, Math.min(options.resume.startIndex, blocks.length));
  const pages: MutablePage[] = (options.resume?.prefix ?? []).map((page) => ({
    items: [...page.items],
    usedMainSize: page.usedMainSize,
  }));
  let cur: MutablePage = { items: [], usedMainSize: 0 };
  if (startIndex < blocks.length) cur = startPage();
  let pendingBreak = false;

  function startPage(): MutablePage {
    const page: MutablePage = { items: [], usedMainSize: 0 };
    pages.push(page);
    return page;
  }

  function pushFragment(block: MeasurableBlock, fromLine: number, lineCount: number, size: number): void {
    cur.items.push({ block, fromLine, lineCount, mainSize: size });
    cur.usedMainSize += size;
  }

  /** keepWithNext 时下一块「至少需与标题同页」的头部尺寸 */
  function headSizeOf(block: MeasurableBlock, next: MeasurableBlock): number {
    if (!isSplittable(next)) return next.mainSize;
    const lineSize = next.lineSize as number;
    const totalLines = lineCountOf(next);
    // 放置标题后，下一段在本页可容纳的行数；模拟 placeSplittable 的取行约束：
    // 头部合规行数取不足（minFirst / minLast 不满足）时下一段会整体换页，
    // 此时改要求整段随标题同页，避免标题违反 keepWithNext 孤悬页尾
    const availLines = Math.floor((pageMainSize - cur.usedMainSize - block.mainSize) / lineSize);
    if (availLines < totalLines) {
      const leftover = totalLines - availLines;
      const take = leftover < minLast ? totalLines - minLast : availLines;
      if (take < minFirst) return next.mainSize;
    }
    return Math.min(next.mainSize, minFirst * lineSize);
  }

  /** 不可拆块：整块贪心放置（保持块原子版行为） */
  function placeAtomic(block: MeasurableBlock, next: MeasurableBlock | undefined): void {
    const keep = block.keepWithNext === true && next !== undefined && next.breakBefore !== true;
    const required = block.mainSize + (keep ? headSizeOf(block, next as MeasurableBlock) : 0);
    const fits = cur.usedMainSize + required <= pageMainSize;
    if (!fits && cur.items.length > 0) {
      cur = startPage();
    }
    // 空页也必须放置（超大块独占一页，避免死循环）
    pushFragment(block, 0, 0, block.mainSize);
  }

  /** 块的真实行数：显式 lineCount 优先，缺省按 mainSize/lineSize 下折算 */
  function lineCountOf(block: MeasurableBlock): number {
    return block.lineCount ?? Math.max(1, Math.floor(block.mainSize / (block.lineSize as number)));
  }

  /** 可拆块：按行跨页续排，含孤寡行约束 */
  function placeSplittable(block: MeasurableBlock): void {
    const lineSize = block.lineSize as number;
    const totalLines = lineCountOf(block);
    let from = 0;
    let remaining = totalLines;

    while (remaining > 0) {
      const avail = pageMainSize - cur.usedMainSize;
      let availLines = Math.floor(avail / lineSize);
      if (availLines <= 0) {
        if (cur.items.length > 0) {
          cur = startPage();
          continue;
        }
        availLines = 1; // 空页至少推进一行
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
          ? Math.max(take * lineSize, block.mainSize - from * lineSize)
          : take * lineSize;
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
    const onFreshPage = cur.items.length === 0;
    if (!onFreshPage && (pendingBreak || block.breakBefore === true)) {
      cur = startPage();
    }
    pendingBreak = false;

    if (isSplittable(block)) {
      placeSplittable(block);
    } else {
      placeAtomic(block, blocks[i + 1]);
    }

    if (block.breakAfter === true) {
      pendingBreak = true;
    }
  }

  const resultPages: PaginatedPage[] = pages.map((page, index) => ({
    index,
    items: page.items,
    blocks: page.items.map((item) => item.block),
    usedMainSize: page.usedMainSize,
  }));

  return {
    pages: resultPages,
    totalPages: resultPages.length,
    totalBlocks: blocks.length,
  };
}
