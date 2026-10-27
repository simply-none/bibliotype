/**
 * 正文结构重建：目录树 + spine 文档 → 带层级的正文 HTML
 *
 * 与旧实现（每文件一个「卷 > 章」两层包裹）的差异：
 * - 顺序以**目录**为准（spine 只决定「哪些文件是正文」），目录顺序 = 正文顺序 = 点击落点；
 * - 一个文件内含多章时按锚点切分（`body-split`），每章各自成容器；
 * - 容器按目录树的真实嵌套输出 `bt-volume / bt-chapter / bt-section`，
 *   经 schema 的 parseDOM 回收为卷 / 章 / 节结构节点，目录面板因此恢复层级；
 * - 目录未收录的文档（封面 / 版权页 / 后记等）按位置就近归档，不丢内容。
 */
import { decode, parseXml } from './xml.js';
import { inlineBodyImages } from './media.js';
import { groupEntriesByDoc, lookupEntry, orderContentPaths } from './toc-path.js';
import { splitBodyByAnchors } from './body-split.js';
import { STRUCTURE_CLASSES } from './toc-types.js';
import type { EpubFiles, EpubImportReport, TocEntry, TocPlan } from './toc-types.js';

/** 结构重建选项 */
export interface StructuredHtmlOptions {
  /** 是否把图片内联为 data URI */
  inlineImages: boolean;
  /** 「zip 路径 → 媒体类型」表（内联时用于写 `data:` 前缀） */
  mediaTypes: ReadonlyMap<string, string>;
  /** 诊断回调（缺省不收集） */
  onReport?: (report: EpubImportReport) => void;
}

/** HTML 属性值转义 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 是否为自动生成的内联目录页（Kindle 等转换产物；内容与目录重复，导入时丢弃） */
function isAutoTocBody(html: string): boolean {
  return html.includes('kindle-cn-toc-title') || /class="[^"]*\bbt-toc\b/.test(html);
}

/** 目录条目总数（含各级子条目） */
function countEntries(entries: readonly TocEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    total += 1 + countEntries(entry.children);
  }
  return total;
}

/**
 * 层级 → 结构容器类名
 *
 * 根层无子项的条目是「扁平书的章」，不能用 volume 包（否则目录面板把每章都显示成卷）；
 * 更深层级一律退到 section（样式与语义都以 section 为末级）。
 */
function structureClassOf(entry: TocEntry, depth: number): string {
  const index = depth === 0 && entry.children.length === 0 ? 1 : Math.min(depth, STRUCTURE_CLASSES.length - 1);
  return STRUCTURE_CLASSES[index] ?? 'bt-section';
}

/** 递归渲染目录条目（自身片段在前，子容器在后） */
function renderEntry(
  entry: TocEntry,
  depth: number,
  parts: ReadonlyMap<TocEntry, string[]>,
): string {
  const inner = [...(parts.get(entry) ?? []), ...entry.children.map((child) => renderEntry(child, depth + 1, parts))];
  const title = escapeAttr(entry.title);
  return `<div class="${structureClassOf(entry, depth)}" data-title="${title}">${inner.join('\n')}</div>`;
}

/** 序列化 `<body>` 内层（文档未收录进目录时可整篇保留） */
function serializeBody(body: Element): string {
  const segments = splitBodyByAnchors(body, []);
  return segments.segments.map((segment) => segment.html).join('');
}

/**
 * 依目录树重建带层级的正文 HTML
 *
 * @param files 解包后的条目表
 * @param contentPaths spine 解析出的正文文档（保序；本函数会按目录顺序校正）
 * @param toc 目录计划（`readToc` 产物）
 * @param options 图片内联与诊断选项
 * @returns 正文 HTML 片段（含 `bt-volume` / `bt-chapter` / `bt-section` 嵌套）
 * @throws RangeError 一个内容文档都取不到时（空书 / 结构不受支持）
 */
export function buildStructuredHtml(
  files: EpubFiles,
  contentPaths: readonly string[],
  toc: TocPlan,
  options: StructuredHtmlOptions,
): string {
  const ordered = orderContentPaths(contentPaths, toc.entries);
  const byDoc = groupEntriesByDoc(toc.entries);
  const parts = new Map<TocEntry, string[]>();
  const leading: string[] = [];
  const missingFiles: string[] = toc.missing.slice();
  const unlocatedAnchors: string[] = [];
  let lastEntry: TocEntry | undefined;

  const appendTo = (entry: TocEntry, html: string): void => {
    const bucket = parts.get(entry);
    if (bucket === undefined) parts.set(entry, [html]);
    else bucket.push(html);
    lastEntry = entry;
  };

  for (const path of ordered) {
    const actual = lookupEntry(files, path);
    const bytes = actual === undefined ? undefined : files[actual];
    if (actual === undefined || bytes === undefined) {
      if (!missingFiles.includes(path)) missingFiles.push(path);
      continue;
    }

    const doc = parseXml(decode(bytes), `内容文档 ${actual}`);
    const body = doc.getElementsByTagName('body').item(0);
    if (body === null) continue;
    if (options.inlineImages) {
      inlineBodyImages(doc, actual, files, options.mediaTypes);
    }

    const entries = byDoc.get(actual) ?? byDoc.get(path) ?? [];
    if (entries.length === 0) {
      /* 目录未收录的文档：整篇保留。自动内联目录页仅在此时才丢弃，
         避免把正文里带 bt-toc 类名的章节误删。 */
      const html = serializeBody(body as Element);
      if (html.trim() === '' || isAutoTocBody(html)) continue;
      if (lastEntry === undefined) leading.push(html);
      else appendTo(lastEntry, html);
      continue;
    }

    const split = splitBodyByAnchors(body as Element, entries);
    for (const anchor of split.unlocated) {
      if (!unlocatedAnchors.includes(`${actual}${anchor}`)) {
        unlocatedAnchors.push(`${actual}${anchor}`);
      }
    }
    for (const segment of split.segments) {
      if (segment.html.trim() === '') continue;
      if (segment.entry === undefined) {
        if (lastEntry === undefined) leading.push(segment.html);
        else appendTo(lastEntry, segment.html);
        continue;
      }
      appendTo(segment.entry, segment.html);
    }
  }

  const blocks = [...leading, ...toc.entries.map((entry) => renderEntry(entry, 0, parts))];
  if (blocks.length === 0) {
    throw new RangeError('epub 未解析出任何正文内容：文件可能为空或结构不受支持。');
  }

  options.onReport?.({
    tocSource: toc.source,
    tocEntries: countEntries(toc.entries),
    missingFiles,
    unlocatedAnchors,
  });

  return blocks.join('\n');
}
