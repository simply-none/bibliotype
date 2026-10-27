/**
 * PDF 书签（/Outlines）生成
 *
 * 动机：图片型 PDF（应用内光栅直出）与 Chromium 打印的 PDF 都没有目录树，
 * 第三方阅读器只能按页翻。本模块把阅读器目录面板（结构节点优先，无结构时
 * 按标题回退，见 reader 的 `extractOutline`）原样转成 PDF 书签：每条带目标页、
 * 按层级嵌套，写入 catalog 的 `/Outlines` 并置 `/PageMode /UseOutlines`，
 * 阅读器侧栏打开即见目录，条目可直接跳页。
 *
 * pdf-lib 没有书签的高层 API，这里用其低级字典接口手拼：
 * - 标题必须 `PDFHexString.fromText`（中文走 UTF-16BE；`context.obj` 会把普通
 *   字符串当 `PDFName` 写出，中文名直接乱码）；
 * - `/Dest [页 ref /Fit]`：`/Fit` 让阅读器把目标页整页适配窗口，比 `/XYZ` 少
 *   一组需要按页高换算的坐标（直排 / 双页版式下坐标口径易错）。
 */
import { PDFHexString, PDFName, PDFNumber } from 'pdf-lib';
import type { PDFDocument, PDFRef } from 'pdf-lib';
import { outlineKeyOf, type OutlineItem } from '@bibliotype/reader';

/** PDF 书签条目（`pageIndex` 自 0 起；`children` 为下一级） */
export interface PdfOutlineEntry {
  /** 书签标题（阅读器侧栏显示） */
  title: string;
  /** 目标页（自 0 起，与分页器页序一致） */
  pageIndex: number;
  /** 子条目 */
  children: PdfOutlineEntry[];
}

/** 书签写入选项 */
export interface PdfOutlineWriteOptions {
  /**
   * 页序偏移（缺省 0）
   *
   * 分段导出用：分段 PDF 的首页是全书第 `from` 页，书签目标页需减去该偏移
   * 才落在段内正确页上；越界条目（不属于本段）自动丢弃。
   */
  pageOffset?: number;
}

/**
 * 目录树 → 书签树
 *
 * - 页号由 `pageOfKey` 给出（通常传 `Reader.getPageOfNode`），键口径与阅读器
 *   目录高亮同源（`outlineKeyOf`：有 id 用 id，无 id 用树路径）；
 * - 无标题的条目丢弃（空条目在侧栏是空白行，误导读者）；
 * - 定位不到页的条目（如空容器）**不丢子树**：把子项上提一级，保证有页的
 *   孙项仍可跳转。
 *
 * @param outline 目录树（`reader.outline` / `extractOutline` 产物）
 * @param pageOfKey 键 → 页号（自 0 起）；未命中返回 `undefined`
 */
export function buildPdfOutline(
  outline: readonly OutlineItem[],
  pageOfKey: (key: string) => number | undefined,
): PdfOutlineEntry[] {
  const walk = (items: readonly OutlineItem[], path: string): PdfOutlineEntry[] => {
    const entries: PdfOutlineEntry[] = [];
    for (const [index, item] of items.entries()) {
      const keyPath = path === '' ? String(index) : `${path}.${index}`;
      const children = walk(item.children, keyPath);
      const title = item.title.trim();
      const pageIndex = pageOfKey(outlineKeyOf(item, keyPath));
      if (title === '' || pageIndex === undefined) {
        entries.push(...children);
        continue;
      }
      entries.push({ title, pageIndex, children });
    }
    return entries;
  };
  return walk(outline, '');
}

/** 书签总条目数（含各级子条目；空树为 0） */
export function countPdfOutlineEntries(entries: readonly PdfOutlineEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    count += 1 + countPdfOutlineEntries(entry.children);
  }
  return count;
}

/** 已分配引用节点的书签（先分配后写字典：子项要先拿到自身 ref 才能挂到父项的 /First） */
interface OutlineNode {
  ref: PDFRef;
  entry: PdfOutlineEntry;
  children: OutlineNode[];
}

/**
 * 写入书签目录
 *
 * @param pdf 目标 PDF（已建页；页序即书签页序）
 * @param entries 书签树（`buildPdfOutline` 产物）
 * @param options 页序偏移（分段导出）
 * @returns 实际写入的条目数（0 表示没有可写的书签，catalog 未被改动）
 */
export function writePdfOutline(
  pdf: PDFDocument,
  entries: readonly PdfOutlineEntry[],
  options: PdfOutlineWriteOptions = {},
): number {
  const offset = Math.max(0, Math.trunc(options.pageOffset ?? 0));
  const pageCount = pdf.getPageCount();

  /* 页序校正 + 越界裁剪；父项越界时子项上提，避免整枝丢失 */
  const prune = (list: readonly PdfOutlineEntry[]): PdfOutlineEntry[] => {
    const out: PdfOutlineEntry[] = [];
    for (const entry of list) {
      const children = prune(entry.children);
      const pageIndex = entry.pageIndex - offset;
      if (pageIndex >= 0 && pageIndex < pageCount) {
        out.push({ title: entry.title, pageIndex, children });
      } else {
        out.push(...children);
      }
    }
    return out;
  };
  const roots = prune(entries);
  if (roots.length === 0) return 0;

  const { context } = pdf;
  const allocate = (list: readonly PdfOutlineEntry[]): OutlineNode[] =>
    list.map((entry) => ({
      ref: context.nextRef(),
      entry,
      children: allocate(entry.children),
    }));
  const tree = allocate(roots);

  /**
   * 写一层：兄弟间串 /Prev /Next，父项记 /First /Last /Count
   *
   * /Count 为正表示默认展开，绝对值是可见后代数——本书目录层级不深，
   * 统一全展开（读者点开侧栏即可见完整结构）。
   */
  const writeLevel = (nodes: readonly OutlineNode[], parent: PDFRef): number => {
    for (const [index, node] of nodes.entries()) {
      const previous = nodes[index - 1];
      const next = nodes[index + 1];
      const dict = context.obj({
        Title: PDFHexString.fromText(node.entry.title),
        Parent: parent,
        Dest: context.obj([pdf.getPage(node.entry.pageIndex).ref, PDFName.of('Fit')]),
        ...(previous === undefined ? {} : { Prev: previous.ref }),
        ...(next === undefined ? {} : { Next: next.ref }),
      });
      if (node.children.length > 0) {
        const descendants = writeLevel(node.children, node.ref);
        dict.set(PDFName.of('First'), node.children[0]!.ref);
        dict.set(PDFName.of('Last'), node.children[node.children.length - 1]!.ref);
        dict.set(PDFName.of('Count'), PDFNumber.of(descendants));
      }
      context.assign(node.ref, dict);
    }
    return countNodes(nodes);
  };

  /* 顶层条目的 /Parent 指向 /Outlines 自身：先取引用再写条目字典，最后回填根字典 */
  const outlinesRef = context.nextRef();
  const total = writeLevel(tree, outlinesRef);
  context.assign(
    outlinesRef,
    context.obj({
      Type: PDFName.of('Outlines'),
      First: tree[0]!.ref,
      Last: tree[tree.length - 1]!.ref,
      Count: PDFNumber.of(total),
    }),
  );
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return total;
}

/** 节点数（含全部后代） */
function countNodes(nodes: readonly OutlineNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1 + countNodes(node.children);
  }
  return count;
}
