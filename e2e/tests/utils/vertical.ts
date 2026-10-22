/**
 * 直排列级版式测量（B3）
 *
 * 在真实浏览器里用 Range 逐字测量行盒，还原「列数 / 每栏行数 / 断行位置」：
 * - 行聚类：直排同一竖行的字符 `left` 对齐（容差 1.5px），横排按 `top`；
 * - 行内字符：直排按 `top` 升序、横排按 `left` 升序拼接，即该行的实际文字；
 * - 分栏：CSS 多栏沿 inline 轴堆叠（直排为纵向），按行中心分桶得每栏行数。
 *
 * 结果只保留「与字体无关的几何量 + 断行文本」，坐标不落快照，
 * 保证 `toMatchSnapshot` 的基线跨机器稳定；字形本身由页面像素截图覆盖。
 */
import type { Page } from '@playwright/test';

/** 单页直排测量结果 */
export interface VerticalPageMetrics {
  /** CSS 计算值分栏数（1~3） */
  columnCount: number;
  /** 栏间距（px） */
  columnGap: number;
  /** 每栏行数（按 inline 轴分桶） */
  rowsPerColumn: number[];
  /** 行文本（阅读顺序；即断行位置指纹） */
  lines: string[];
  /** 版心宽（px，取整） */
  flowWidth: number;
  /** 版心高（px，取整） */
  flowHeight: number;
}

/** 测量当前单页正文流 */
export async function measureVerticalPage(page: Page): Promise<VerticalPageMetrics> {
  return page.evaluate(() => {
    const flow = document.querySelector<HTMLElement>('.bt-reader-page__flow');
    if (flow === null) throw new Error('未找到 .bt-reader-page__flow');
    const cs = getComputedStyle(flow);
    const columnCount = Number.parseInt(cs.columnCount, 10) || 1;
    const columnGap = Number.parseFloat(cs.columnGap) || 0;
    const rect = flow.getBoundingClientRect();
    const vertical = cs.writingMode.startsWith('vertical');

    interface CharBox {
      ch: string;
      left: number;
      top: number;
      right: number;
      bottom: number;
    }

    const boxes: CharBox[] = [];
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const textNode = node as Text;
      const data = textNode.data;
      for (let i = 0; i < data.length; i += 1) {
        const ch = data[i]!;
        if (ch.trim() === '') continue;
        const range = document.createRange();
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const box = range.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        boxes.push({ ch, left: box.left, top: box.top, right: box.right, bottom: box.bottom });
      }
    }

    /* 行聚类：同一行盒的字符在交叉轴对齐 */
    const keyOf = (box: CharBox): number => (vertical ? box.left : box.top);
    const sorted = [...boxes].sort((a, b) => keyOf(a) - keyOf(b));
    const groups: CharBox[][] = [];
    let current: CharBox[] = [];
    let anchor = Number.NaN;
    for (const box of sorted) {
      const key = keyOf(box);
      if (current.length === 0 || Math.abs(key - anchor) <= 1.5) {
        current.push(box);
        if (Number.isNaN(anchor)) anchor = key;
      } else {
        groups.push(current);
        current = [box];
        anchor = key;
      }
    }
    if (current.length > 0) groups.push(current);

    const lines = groups.map((group) => {
      const ordered = [...group].sort((a, b) => (vertical ? a.top - b.top : a.left - b.left));
      return ordered.map((box) => box.ch).join('');
    });

    /* 分栏：沿 inline 轴（直排 = y，横排 = x）按「行中心」分桶 */
    const mainStart = vertical ? rect.top : rect.left;
    const mainSize = vertical ? rect.height : rect.width;
    const colSize =
      columnCount > 1 ? (mainSize - columnGap * (columnCount - 1)) / columnCount : mainSize;
    const rowsPerColumn = Array.from({ length: columnCount }, () => 0);
    for (const group of groups) {
      const center =
        group.reduce(
          (sum, box) => sum + (vertical ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2),
          0,
        ) / group.length;
      const bucket = Math.min(
        columnCount - 1,
        Math.max(0, Math.floor((center - mainStart) / (colSize + columnGap))),
      );
      rowsPerColumn[bucket] = (rowsPerColumn[bucket] ?? 0) + 1;
    }

    return {
      columnCount,
      columnGap,
      rowsPerColumn,
      lines,
      flowWidth: Math.round(rect.width),
      flowHeight: Math.round(rect.height),
    };
  });
}

/**
 * 截图前注入「文字透明」样式（只留版式几何）
 *
 * 截图基线要跨平台可比：字形随系统字体变化，透明后像素图只反映
 * 页框 / 界行 / 分栏等几何；断行差异由 {@link measureVerticalPage} 的结构断言负责。
 */
export async function maskTextForGeometryShot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      .bt-reader-page,
      .bt-reader-page * {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
        text-decoration-color: transparent !important;
      }
    `,
  });
}
