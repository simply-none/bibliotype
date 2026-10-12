/**
 * 分页器（POC 骨架）
 *
 * 输入为「已测量高度的内容块」序列，输出页码编排结果。
 * 测量环节由渲染层负责（DOM 实测或预测量），本模块保持纯函数：
 *
 * - 贪心装箱：块沿主轴方向累加，超页则换页；
 * - breakBefore / breakAfter：强制换页（章首、卷末）；
 * - keepWithNext：与下一块同页（标题+首段），放不下则整体换页；
 * - 超大块：独占一页（避免死循环）。
 *
 * 注：直排场景下「主轴」为横向（自右向左的行款），
 * 故字段统一命名为 mainSize，由调用方按书写方向传入相应测量值。
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
}

/** 分页结果中的单页 */
export interface PaginatedPage {
  /** 页码（自 0 起） */
  index: number;
  /** 本页容纳的块 */
  blocks: MeasurableBlock[];
  /** 本页已用主轴尺寸 */
  usedMainSize: number;
}

/** 分页选项 */
export interface PaginateOptions {
  /** 每页可用主轴尺寸（px） */
  pageMainSize: number;
}

/** 分页统计 */
export interface PaginationResult {
  pages: PaginatedPage[];
  /** 总页数 */
  totalPages: number;
  /** 总块数 */
  totalBlocks: number;
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

  const pages: PaginatedPage[] = [];
  let current: PaginatedPage | undefined;

  const startPage = (): PaginatedPage => {
    const page: PaginatedPage = {
      index: pages.length,
      blocks: [],
      usedMainSize: 0,
    };
    pages.push(page);
    return page;
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i] as MeasurableBlock;

    if (current === undefined || (block.breakBefore && current.blocks.length > 0)) {
      current = startPage();
    }

    // keepWithNext：需求尺寸含下一块（下一块强制换页时不连坐）
    const next = blocks[i + 1];
    const keepWithNext = block.keepWithNext === true
      && next !== undefined
      && next.breakBefore !== true;
    const required = keepWithNext
      ? block.mainSize + (next?.mainSize ?? 0)
      : block.mainSize;

    const fits = current.usedMainSize + required <= pageMainSize;
    if (!fits && current.blocks.length > 0) {
      current = startPage();
    }

    current.blocks.push(block);
    current.usedMainSize += block.mainSize;

    if (block.breakAfter && i < blocks.length - 1) {
      current = undefined;
    }
  }

  return {
    pages,
    totalPages: pages.length,
    totalBlocks: blocks.length,
  };
}
