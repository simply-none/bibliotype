/**
 * 目录视图模型（纯函数）
 *
 * 把「目录树 + 当前章 + 折叠集合 + 搜索词」折算成**扁平的可见行**：
 * 折叠、过滤、活动态与命中标记一次算清，组件只负责渲染与抛事件。
 *
 * 设计约束：
 * - 不依赖 DOM / Vue 响应式，可独立测试；
 * - 键口径与 `@bibliotype/reader` 的 `outlineKeyOf` 一致（无 id 节点用树路径），
 *   保证折叠集合可持久化、重排后仍然命中；
 * - 默认全展开，未传 `expandedKeys` 时行为与旧版目录一致（向后兼容）。
 */
import { outlineKeyOf, type OutlineItem } from '@bibliotype/reader';

/** 目录可见行 */
export interface TocViewItem {
  /** 定位键（折叠 / 活动态 / 搜索结果都以它为准） */
  key: string;
  /** 原始目录项 */
  item: OutlineItem;
  /** 层级（顶层 0） */
  depth: number;
  /** 是否有子项（决定折叠按钮是否可用） */
  hasChildren: boolean;
  /** 当前是否展开（无子项恒为 false） */
  expanded: boolean;
  /** 是否为当前阅读位置所在项 */
  active: boolean;
  /** 是否命中搜索词（无搜索时为 false） */
  matched: boolean;
}

/** 构建目录视图的选项 */
export interface BuildTocViewOptions {
  /** 当前活动目录项键（通常取 `Reader.getOutlineItemAtPage` 对应项的 nodeId） */
  activeKey?: string;
  /** 已展开的键集合；省略时按 `expandByDefault` 决定 */
  expandedKeys?: readonly string[];
  /** `expandedKeys` 省略时的默认展开状态（默认 true：兼容旧版全展开） */
  expandByDefault?: boolean;
  /** 搜索词（去首尾空格、大小写不敏感；空串表示不过滤） */
  query?: string;
}

/** 标题高亮片段 */
export interface TocTitleSegment {
  /** 片段文本 */
  text: string;
  /** 是否为命中片段 */
  matched: boolean;
}

/** 子路径（与 reader `outline-query` 的扁平化口径一致） */
function childPath(path: string, index: number): string {
  return path === '' ? `${index}` : `${path}.${index}`;
}

/** 归一化搜索词：去首尾空格并转小写 */
function normalizeQuery(query: string | undefined): string {
  return (query ?? '').trim().toLowerCase();
}

/**
 * 构建目录可见行
 *
 * 规则：
 * 1. 搜索时只保留「命中项 + 其祖先 + 活动项链」，并强制展开祖先使命中可见；
 * 2. 无搜索时全部可见，展开状态由 `expandedKeys` / `expandByDefault` 决定；
 * 3. 活动项的祖先链自动展开 —— 翻到深章节时目录不会把高亮藏在折叠项里。
 *
 * @param outline 目录树（`Reader.outline`）
 * @param options 活动项 / 折叠集合 / 搜索词
 */
export function buildTocViewItems(
  outline: readonly OutlineItem[],
  options: BuildTocViewOptions = {},
): TocViewItem[] {
  const expandedKeys = options.expandedKeys;
  const expandByDefault = options.expandByDefault ?? true;
  const activeKey = options.activeKey;
  const query = normalizeQuery(options.query);

  /** 键 → 祖先键链（含自身，不含根） */
  const chainOf = new Map<string, string[]>();
  /** 键 → 自身匹配 */
  const matchedKeys = new Set<string>();
  /** 键 → 是否有后代匹配 */
  const subtreeMatched = new Map<string, boolean>();

  const index = (items: readonly OutlineItem[], path: string, ancestors: string[]): boolean => {
    let anyMatched = false;
    for (const [i, item] of items.entries()) {
      const key = outlineKeyOf(item, childPath(path, i));
      const chain = [...ancestors, key];
      chainOf.set(key, chain);
      const hit = query !== '' && item.title.toLowerCase().includes(query);
      if (hit) matchedKeys.add(key);
      const childHit = index(item.children, childPath(path, i), chain);
      const subtreeHit = hit || childHit;
      subtreeMatched.set(key, subtreeHit);
      if (subtreeHit) anyMatched = true;
    }
    return anyMatched;
  };
  index(outline, '', []);

  /** 搜索 / 活动项需要保持可见的键（自身 + 祖先链） */
  const keep = new Set<string>();
  const keepChain = (key: string | undefined): void => {
    if (key === undefined) return;
    for (const ancestor of chainOf.get(key) ?? []) keep.add(ancestor);
  };
  if (query !== '') {
    for (const key of matchedKeys) keepChain(key);
  } else {
    // 搜索时活动项不必保留：结果为空就该显示空态，不能因「当前章」而恒有行
    keepChain(activeKey);
  }

  const rows: TocViewItem[] = [];
  const walk = (items: readonly OutlineItem[], depth: number, path: string): void => {
    for (const [i, item] of items.entries()) {
      const key = outlineKeyOf(item, childPath(path, i));
      const hasChildren = item.children.length > 0;
      const visible = query === '' || keep.has(key);
      if (!visible) continue;

      const forcedExpand = query !== '' ? subtreeMatched.get(key) === true : false;
      /*
       * 只展开活动项的**祖先**（活动项自身若还有子项，不强行摊开）。
       * 仅在折叠集合未受控时生效：宿主一旦传入 `expandedKeys`，就以宿主状态为准——
       * 用户手动收起的章节不该因为翻页又被自动摊开。
       */
      const activeChain =
        expandedKeys === undefined &&
        activeKey !== undefined &&
        key !== activeKey &&
        (chainOf.get(activeKey) ?? []).includes(key);
      const expanded =
        hasChildren &&
        (forcedExpand ||
          (expandedKeys === undefined ? expandByDefault : expandedKeys.includes(key)) ||
          activeChain);

      rows.push({
        key,
        item,
        depth,
        hasChildren,
        expanded,
        active: key === activeKey,
        matched: matchedKeys.has(key),
      });
      if (expanded) walk(item.children, depth + 1, childPath(path, i));
    }
  };
  walk(outline, 0, '');
  return rows;
}

/**
 * 切换折叠状态（返回新数组，便于 v-model / 持久化）
 *
 * 保持既有顺序：新增键追加到末尾，移除键精确删除；重复切换幂等。
 */
export function toggleTocExpanded(expandedKeys: readonly string[], key: string): string[] {
  if (expandedKeys.includes(key)) return expandedKeys.filter((item) => item !== key);
  return [...expandedKeys, key];
}

/**
 * 把标题拆成「命中 / 非命中」片段（避免用 v-html 渲染搜索高亮）
 *
 * @param title 标题原文
 * @param query 搜索词（空串时返回单段原文）
 */
export function splitTocTitle(title: string, query: string | undefined): TocTitleSegment[] {
  const needle = normalizeQuery(query);
  if (needle === '') return [{ text: title, matched: false }];
  const haystack = title.toLowerCase();
  const segments: TocTitleSegment[] = [];
  let from = 0;
  let hit = haystack.indexOf(needle);
  while (hit >= 0) {
    if (hit > from) segments.push({ text: title.slice(from, hit), matched: false });
    segments.push({ text: title.slice(hit, hit + needle.length), matched: true });
    from = hit + needle.length;
    hit = haystack.indexOf(needle, from);
  }
  if (from < title.length) segments.push({ text: title.slice(from), matched: false });
  return segments;
}
