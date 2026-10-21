/**
 * 目录定位（纯函数）
 *
 * 目录项指向卷 / 章 / 节等**容器**节点，而分页结果只含叶块；`Reader` 的
 * `pageByBlockId` 已把容器 id 映射到其首叶所在页（见 `indexNodeAnchors`）。
 * 本模块把这些映射整理成「按文档顺序排列的定位表」，供两类查询：
 *
 * - 节点 id → 页号（点击目录跳页、正文锚点）；
 * - 页号 → 当前目录项（目录高亮的唯一口径，避免用标题字符串模糊匹配）。
 *
 * 只做纯计算，不持有状态、不依赖 DOM，便于独立测试与 SSR 复用。
 */
import type { OutlineItem } from './outline.js';

/** 目录项定位键：节点 id（`extractOutline` 保证有值，无 id 时为树路径） */
export type OutlineKey = string;

/** 目录项定位条目 */
export interface OutlineAnchor {
  /** 定位键（与 `OutlineItem.nodeId` 一致） */
  key: OutlineKey;
  /** 目录项本体 */
  item: OutlineItem;
  /** 层级（顶层 0） */
  level: number;
  /** 起始页（自 0 起） */
  pageIndex: number;
  /** 文档顺序（前序展开序号，用于同页多条目时取最深者） */
  order: number;
}

/**
 * 目录项定位键
 *
 * `extractOutline` 会为无 id 节点回退树路径，正常路径下直接取 `nodeId`；
 * 仅在调用方自造 `OutlineItem`（未填 `nodeId`）时回退路径键，保证键唯一。
 */
export function outlineKeyOf(item: OutlineItem, path = ''): OutlineKey {
  if (item.nodeId !== undefined && item.nodeId !== '') return item.nodeId;
  return `outline:${path}`;
}

/** 前序展开目录树（父项先于子项，与文档顺序一致） */
export function flattenOutline(items: readonly OutlineItem[], path = ''): OutlineItem[] {
  const flat: OutlineItem[] = [];
  for (const [index, item] of items.entries()) {
    const keyPath = path === '' ? `${index}` : `${path}.${index}`;
    flat.push(item);
    if (item.children.length > 0) flat.push(...flattenOutline(item.children, keyPath));
  }
  return flat;
}

/** 收集全部目录项定位键（折叠状态的默认全集 / 全展开判定用） */
export function collectOutlineKeys(items: readonly OutlineItem[], path = ''): OutlineKey[] {
  const keys: OutlineKey[] = [];
  for (const [index, item] of items.entries()) {
    const keyPath = path === '' ? `${index}` : `${path}.${index}`;
    keys.push(outlineKeyOf(item, keyPath));
    if (item.children.length > 0) keys.push(...collectOutlineKeys(item.children, keyPath));
  }
  return keys;
}

/**
 * 构建目录定位表
 *
 * 只收录能解析出页号的目录项（未进入分页的项不参与高亮）；结果按
 * `pageIndex` 升序、同页按文档顺序排列，便于二分查找。
 *
 * @param outline 目录树
 * @param pageOfKey 键 → 页号（通常传 `Reader.getPageOfNode`）
 */
export function buildOutlineAnchors(
  outline: readonly OutlineItem[],
  pageOfKey: (key: OutlineKey) => number | undefined,
): OutlineAnchor[] {
  const anchors: OutlineAnchor[] = [];
  const walk = (items: readonly OutlineItem[], level: number, path: string): void => {
    for (const [index, item] of items.entries()) {
      const keyPath = path === '' ? `${index}` : `${path}.${index}`;
      const key = outlineKeyOf(item, keyPath);
      const pageIndex = pageOfKey(key);
      if (pageIndex !== undefined) {
        anchors.push({ key, item, level, pageIndex, order: anchors.length });
      }
      if (item.children.length > 0) walk(item.children, level + 1, keyPath);
    }
  };
  walk(outline, 0, '');
  // 文档顺序下页号理论单调不减；显式排序防御外部自造目录（顺序不保证）
  return anchors.sort((a, b) => a.pageIndex - b.pageIndex || a.order - b.order);
}

/**
 * 取指定页对应的目录项
 *
 * 口径：起始页不晚于该页的**最后一个**条目（同页时即最深的子项），
 * 与「翻到某页时目录高亮到最小可定位单元」的阅读直觉一致。
 *
 * @returns 未命中（该页在首个目录项之前 / 无目录 / 页号非法）时为 `undefined`
 */
export function findOutlineAnchorAtPage(
  anchors: readonly OutlineAnchor[],
  pageIndex: number,
): OutlineAnchor | undefined {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || anchors.length === 0) return undefined;
  let low = 0;
  let high = anchors.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const anchor = anchors[mid];
    if (anchor === undefined) break;
    if (anchor.pageIndex <= pageIndex) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found >= 0 ? anchors[found] : undefined;
}
