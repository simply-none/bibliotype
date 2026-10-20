/**
 * 第一遍排版：建立「节点 id → 页码」索引
 *
 * 规则：
 * - 同一节点跨页出现（行级拆分）时取**首次出现页**，符合「参见第 X 页」的直觉；
 * - 页码按 `startNumber + page.index` 计算（默认 1 起），封面 / 前置页由调用方偏移；
 * - 输出可序列化（`entries` 为普通对象），便于存入缓存或传给导出期。
 */
import type { BuildPageIndexOptions, PageIndex, PageSource } from './types.js';

/** 收集单页出现的块 id（items 优先，再补 blocks，保持页内顺序） */
function collectPageIds(page: PageSource): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  (page.items ?? []).forEach((item) => push(item.block.id));
  (page.blocks ?? []).forEach((block) => push(block.id));
  return ids;
}

/**
 * 建立页码索引
 *
 * @param pages 分页结果（顺序不限，内部按 index 排序）
 */
export function buildPageIndex(
  pages: readonly PageSource[],
  options: BuildPageIndexOptions = {},
): PageIndex {
  const startNumber = options.startNumber ?? 1;
  const sorted = [...pages].sort((left, right) => left.index - right.index);
  const entries: Record<string, number> = {};
  sorted.forEach((page) => {
    const pageNumber = startNumber + page.index;
    collectPageIds(page).forEach((id) => {
      if (entries[id] === undefined) {
        entries[id] = pageNumber;
      }
    });
  });
  const lastPage = sorted.length > 0 ? (sorted[sorted.length - 1]?.index ?? 0) : -1;
  return { entries, totalPages: lastPage + 1 };
}

/** 查询节点所在页（未命中返回 undefined） */
export function lookupPage(index: PageIndex, nodeId: string): number | undefined {
  const page = index.entries[nodeId];
  return page === undefined ? undefined : page;
}

/** 序列化索引（键排序，输出确定性） */
export function serializePageIndex(index: PageIndex): string {
  const entries: Record<string, number> = {};
  Object.keys(index.entries)
    .sort()
    .forEach((key) => {
      const page = index.entries[key];
      if (page !== undefined) {
        entries[key] = page;
      }
    });
  return JSON.stringify({ entries, totalPages: index.totalPages });
}

/** 反序列化索引（非法输入抛 TypeError） */
export function deserializePageIndex(json: string): PageIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TypeError('反序列化失败：页码索引不是合法 JSON。');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError('反序列化失败：页码索引必须是对象。');
  }
  const candidate = parsed as Partial<PageIndex>;
  if (typeof candidate.entries !== 'object' || candidate.entries === null) {
    throw new TypeError('反序列化失败：缺少 entries 对象。');
  }
  if (typeof candidate.totalPages !== 'number') {
    throw new TypeError('反序列化失败：缺少 totalPages 数字。');
  }
  return { entries: { ...candidate.entries }, totalPages: candidate.totalPages };
}
