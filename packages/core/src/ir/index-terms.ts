/**
 * 索引词采集与书末索引附录（K4）
 *
 * 分三步：
 * 1. `collectIndexTerms`：遍历 IR，收集正文里 `index-term` 标记的词条与所在块 id；
 * 2. `buildIndexEntries`：按词条聚合、去重页码、把连续页合并为区间、按拼音（或
 *    显式 `sortKey`）排序；
 * 3. `buildIndexAppendix`：生成普通 `appendix` 节点，「索引」章与正文同构，EPUB /
 *    站点 / PDF 复用同一份 IR，不各写一套生成逻辑。
 *
 * 纯函数、确定性：排序只依赖 `Intl.Collator`（无则退化为码位比较），不读时间、
 * 不用随机数。EPUB 无固定页码，调用方传 `showPageNumbers: false` 时改为词条本身
 * 链接到正文锚点。
 */
import type { BookDocument } from './document.js';
import { isTextNode, type BookMark, type BookNode } from './nodes.js';
import { MARK_TYPES, NODE_TYPES } from './node-types.js';

/** 单处索引词命中 */
export interface IndexTermOccurrence {
  /** 索引词（非空） */
  term: string;
  /** 排序键（显式 sortKey 或回退 term） */
  sortKey: string;
  /** 命中所在的最近块 id */
  blockId: string;
}

/** 按词条聚合后的索引条目 */
export interface IndexEntry {
  /** 索引词 */
  term: string;
  /** 排序键 */
  sortKey: string;
  /** 升序去重后的页码（无分页信息时为空） */
  pages: number[];
  /** 连续页合并后的区间（闭区间；单页为 `[n, n]`） */
  ranges: Array<readonly [number, number]>;
  /** 首个命中块 id（回跳锚点） */
  anchorId: string;
}

/** 采集 / 聚合选项 */
export interface BuildIndexEntriesOptions {
  /** 自定义排序（缺省按 `sortKey` 拼音序） */
  compare?: (left: IndexEntry, right: IndexEntry) => number;
}

/** 附录生成选项 */
export interface BuildIndexAppendixOptions {
  /** 章节标题（缺省「索引」） */
  title?: string;
  /** 附录节点 id（缺省 `index-appendix`） */
  id?: string;
  /** 是否输出页码文本（EPUB 传 false，改为词条链接） */
  showPageNumbers?: boolean;
  /** 块 id → 链接地址（EPUB 传 `text/sec-N.xhtml#id`；缺省 `#id`） */
  hrefFor?: (blockId: string) => string;
}

/** 缺省拼音排序器（运行时无 ICU 时退化，仍保证确定性） */
const PINYIN_COLLATOR = (() => {
  try {
    return new Intl.Collator('zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' });
  } catch {
    return undefined;
  }
})();

/** 词条排序（拼音优先，缺省码位兜底） */
function compareEntries(left: IndexEntry, right: IndexEntry): number {
  if (PINYIN_COLLATOR !== undefined) {
    const result = PINYIN_COLLATOR.compare(left.sortKey, right.sortKey);
    if (result !== 0) return result;
  }
  return left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0;
}

/** 连续页码合并为闭区间 */
function mergeRanges(pages: readonly number[]): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (const page of pages) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && page === last[1] + 1) {
      ranges[ranges.length - 1] = [last[0], page];
    } else {
      ranges.push([page, page]);
    }
  }
  return ranges;
}

/**
 * 采集文档中的索引词
 *
 * 命中按文档顺序返回；术语缺失或未落在任何带 id 的块内的标记会被跳过
 * （校验层会另行上报空 term）。
 */
export function collectIndexTerms(document: BookDocument | BookNode): IndexTermOccurrence[] {
  const occurrences: IndexTermOccurrence[] = [];

  const walk = (node: BookNode, blockId: string | undefined): void => {
    const nextBlockId =
      typeof node.id === 'string' && node.id !== '' ? node.id : blockId;

    if (isTextNode(node)) {
      if (nextBlockId === undefined) return;
      for (const mark of node.marks ?? []) {
        if (mark.type !== MARK_TYPES.INDEX_TERM) continue;
        const term = mark.attrs?.['term'];
        if (typeof term !== 'string' || term.trim() === '') continue;
        const sortKeyRaw = mark.attrs?.['sortKey'];
        const sortKey =
          typeof sortKeyRaw === 'string' && sortKeyRaw.trim() !== ''
            ? sortKeyRaw.trim()
            : term.trim();
        occurrences.push({ term: term.trim(), sortKey, blockId: nextBlockId });
      }
      return;
    }

    for (const child of node.children ?? []) {
      walk(child, nextBlockId);
    }
  };

  walk('root' in document ? document.root : document, undefined);
  return occurrences;
}

/**
 * 聚合索引条目
 *
 * @param document 书籍文档
 * @param pageNumbers 块 id → 页码（来自 `buildPageIndex().entries`；缺省表示无分页信息）
 * @param options 排序选项
 */
export function buildIndexEntries(
  document: BookDocument | BookNode,
  pageNumbers: Readonly<Record<string, number>> = {},
  options: BuildIndexEntriesOptions = {},
): IndexEntry[] {
  const groups = new Map<string, { sortKey: string; anchorId: string; pages: Set<number> }>();

  for (const occurrence of collectIndexTerms(document)) {
    const group = groups.get(occurrence.term);
    if (group === undefined) {
      groups.set(occurrence.term, {
        sortKey: occurrence.sortKey,
        anchorId: occurrence.blockId,
        pages: new Set(),
      });
    }
    const page = pageNumbers[occurrence.blockId];
    if (typeof page === 'number' && Number.isFinite(page)) {
      groups.get(occurrence.term)?.pages.add(page);
    }
  }

  const entries: IndexEntry[] = [];
  for (const [term, group] of groups) {
    const pages = [...group.pages].sort((left, right) => left - right);
    entries.push({
      term,
      sortKey: group.sortKey,
      pages,
      ranges: mergeRanges(pages),
      anchorId: group.anchorId,
    });
  }

  const compare = options.compare ?? compareEntries;
  entries.sort(compare);
  return entries;
}

/** 页码区间 → 可读文本（`3, 5–7`） */
export function formatIndexRanges(ranges: ReadonlyArray<readonly [number, number]>): string {
  return ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}–${end}`))
    .join(', ');
}

/** 造一个带链接标记的文本节点 */
function linkedText(text: string, href: string): BookNode {
  const mark: BookMark = { type: MARK_TYPES.LINK, attrs: { href } };
  return { type: NODE_TYPES.TEXT, text, marks: [mark] };
}

/**
 * 生成「索引」附录章节
 *
 * 条目段落形如：`朱熹　3, 5–7`（页码整体可点，回跳首个命中块）；
 * `showPageNumbers: false` 时输出 `朱熹`（词条本身可点）。
 */
export function buildIndexAppendix(
  entries: readonly IndexEntry[],
  options: BuildIndexAppendixOptions = {},
): BookNode {
  const title = options.title ?? '索引';
  const hrefFor = options.hrefFor ?? ((blockId: string) => `#${blockId}`);
  const showPageNumbers = options.showPageNumbers ?? true;

  const children: BookNode[] = [
    {
      type: NODE_TYPES.HEADING,
      attrs: { level: 1 },
      children: [{ type: NODE_TYPES.TEXT, text: title }],
    },
  ];

  for (const entry of entries) {
    const href = hrefFor(entry.anchorId);
    const inline: BookNode[] = showPageNumbers
      ? [
          { type: NODE_TYPES.TEXT, text: entry.term },
          { type: NODE_TYPES.TEXT, text: '　' },
          linkedText(formatIndexRanges(entry.ranges), href),
        ]
      : [linkedText(entry.term, href)];
    children.push({ type: NODE_TYPES.PARAGRAPH, children: inline });
  }

  return {
    type: NODE_TYPES.APPENDIX,
    id: options.id ?? 'index-appendix',
    attrs: { title },
    children,
  };
}
