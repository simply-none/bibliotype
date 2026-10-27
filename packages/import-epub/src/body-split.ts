/**
 * 单个正文文档 → 按目录锚点切分的片段
 *
 * 为什么需要切分：很多 epub 把多章合并在同一个 XHTML 里，目录的多个条目只是
 * 指向该文件内的不同 `#id`。若按「一个文件一个章」处理，除最深的那条外其余目录项
 * 全部丢失，点击时只能落到文件开头——这正是「目录与正文对不上」的典型来源。
 *
 * 切分规则：
 * - 锚点命中某个顶层子节点（或其后代）时，该子节点起开启新片段；
 * - 首个锚点之前的散块归属文档的首个条目（不丢引言）；
 * - 找不到锚点的条目不再抢内容，只回报给调用方（容器留空，内容并入上一片段）。
 */
import { XMLSerializer } from '@xmldom/xmldom';
import type { TocEntry } from './toc-types.js';

/** 一个正文片段 */
export interface BodySegment {
  /** 归属的目录条目（无目录条目时为空，正文原样保留） */
  entry: TocEntry | undefined;
  /** 片段 HTML（body 顶层子节点序列化拼接） */
  html: string;
}

/** 切分结果 */
export interface BodySplitResult {
  segments: BodySegment[];
  /** 未在文档里定位到的锚点（`#id` 形式，供报告展示） */
  unlocated: string[];
}

/** 取元素在 `<body>` 下的顶层祖先（锚点常藏在 `<div><h2 id=…>` 里） */
function topChildOf(body: Element, element: Element): Node | undefined {
  let cursor: Node | null = element;
  while (cursor !== null && cursor.parentNode !== body) {
    cursor = cursor.parentNode;
  }
  return cursor ?? undefined;
}

/** 顶层子节点序列化为 HTML */
function serializeNodes(nodes: readonly Node[]): string {
  const serializer = new XMLSerializer();
  let html = '';
  for (const node of nodes) {
    html += serializer.serializeToString(node);
  }
  return html;
}

/**
 * 把 `<body>` 的顶层子节点按目录锚点切成片段
 *
 * @param body 已解析内容文档的 `<body>` 元素
 * @param entries 该文档对应的目录条目（文档序，来自目录树先序）
 * @returns 片段列表与未定位锚点；`entries` 为空时整篇作为一个无归属片段
 */
export function splitBodyByAnchors(
  body: Element,
  entries: readonly TocEntry[],
): BodySplitResult {
  const anchorEntries = new Map<string, TocEntry>();
  for (const entry of entries) {
    if (entry.anchor !== '' && !anchorEntries.has(entry.anchor)) {
      anchorEntries.set(entry.anchor, entry);
    }
  }

  /* 锚点 → 顶层子节点：同一顶层块只归属文档序上的首个锚点，避免内容重复 */
  const ownerOfChild = new Map<Node, TocEntry>();
  const located = new Set<string>();
  if (anchorEntries.size > 0) {
    const elements = body.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements.item(i);
      const id = element?.getAttribute('id') ?? '';
      if (id === '') continue;
      const entry = anchorEntries.get(id);
      if (entry === undefined || located.has(id)) continue;
      const top = topChildOf(body, element as Element);
      if (top === undefined || ownerOfChild.has(top)) continue;
      ownerOfChild.set(top, entry);
      located.add(id);
    }
  }

  const unlocated: string[] = [];
  for (const anchor of anchorEntries.keys()) {
    if (!located.has(anchor)) unlocated.push(`#${anchor}`);
  }

  const segments: BodySegment[] = [];
  let current: TocEntry | undefined = entries[0];
  let buffer: Node[] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    segments.push({ entry: current, html: serializeNodes(buffer) });
    buffer = [];
  };

  for (let i = 0; i < body.childNodes.length; i += 1) {
    const child = body.childNodes.item(i);
    if (child === null) continue;
    const owner = ownerOfChild.get(child);
    if (owner !== undefined && owner !== current) {
      flush();
      current = owner;
    }
    buffer.push(child);
  }
  flush();

  return { segments, unlocated };
}
