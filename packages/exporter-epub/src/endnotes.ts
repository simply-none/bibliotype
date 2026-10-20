/**
 * 尾注聚合（导出期重排）
 *
 * 尾注（`endnote`）在 IR 里与脚注一样是就地块；但纸书 / 电子书的习惯是
 * **篇末或书末集中排**。本模块在导出前把尾注从正文流中抽出，按章聚合到
 * 章末（`chapter`）或全书末（`book`），正文顺序与节点 id 均保持不变，
 * 因而正文里的 `noteref` 链接照旧有效。
 *
 * 只处理 `endnote`：脚注（页底）与边注（旁栏）的位置语义就是「就地」，
 * 抽走反而破坏版式。
 */
import { NODE_TYPES, type BookNode } from '@bibliotype/core';

/** 尾注聚合范围 */
export type EndnoteGrouping = 'keep' | 'chapter' | 'book';

/** 聚合选项 */
export interface EndnoteGroupingOptions {
  /** 聚合范围（`chapter` 章末 / `book` 书末） */
  scope: 'chapter' | 'book';
  /** 聚合区标题（缺省「注释」；空串表示不加标题行） */
  title?: string;
  /** 书末聚合章的 id（缺省 `endnotes`；仅在无同名节点时生效） */
  id?: string;
}

/** 深拷贝节点（attrs / marks 一并复制，保证原文档不被改动） */
function cloneNode(node: BookNode): BookNode {
  const copy: BookNode = { ...node };
  if (node.attrs !== undefined) copy.attrs = { ...node.attrs };
  if (node.marks !== undefined) {
    copy.marks = node.marks.map((mark) =>
      mark.attrs === undefined ? { ...mark } : { ...mark, attrs: { ...mark.attrs } },
    );
  }
  if (node.children !== undefined) copy.children = node.children.map(cloneNode);
  return copy;
}

/** 是否为待聚合的尾注块 */
function isEndnote(node: BookNode): boolean {
  return node.type === NODE_TYPES.ENDNOTE;
}

/** 聚合区标题行（空标题返回空数组） */
function titleBlocks(title: string, level: number): BookNode[] {
  if (title === '') return [];
  return [
    {
      type: NODE_TYPES.HEADING,
      attrs: { level },
      children: [{ type: NODE_TYPES.TEXT, text: title }],
    },
  ];
}

/**
 * 递归抽出尾注
 *
 * 返回 `{ node, notes }`：`node` 是去掉尾注后的克隆，`notes` 为按文档先序
 * 收集到的尾注（同为克隆，可直接搬到别处）。
 */
function extract(node: BookNode): { node: BookNode; notes: BookNode[] } {
  const notes: BookNode[] = [];
  const copy = cloneNode(node);
  if (node.children === undefined) return { node: copy, notes };

  const kept: BookNode[] = [];
  (node.children ?? []).forEach((child) => {
    if (isEndnote(child)) {
      notes.push(cloneNode(child));
      return;
    }
    const result = extract(child);
    kept.push(result.node);
    notes.push(...result.notes);
  });
  copy.children = kept;
  return { node: copy, notes };
}

/**
 * 章末聚合（递归）
 *
 * 返回 `{ node, pending }`：章内的尾注已收到该章末尾并返回空 `pending`；
 * 非章容器（卷 / 前言 / 扁平文档）把尚未归属的尾注原样向上冒泡，
 * 由最近的章或书末兜底接收。
 */
function groupByChapter(node: BookNode, title: string): { node: BookNode; pending: BookNode[] } {
  const copy = cloneNode(node);
  if (node.children === undefined) return { node: copy, pending: [] };

  const kept: BookNode[] = [];
  const pending: BookNode[] = [];
  (node.children ?? []).forEach((child) => {
    if (isEndnote(child)) {
      pending.push(cloneNode(child));
      return;
    }
    const result = groupByChapter(child, title);
    kept.push(result.node);
    pending.push(...result.pending);
  });

  if (copy.type === NODE_TYPES.CHAPTER) {
    copy.children = [...kept, ...titleBlocks(title, 2), ...pending];
    return { node: copy, pending: [] };
  }
  copy.children = kept;
  return { node: copy, pending };
}

/**
 * 聚合尾注，返回新根节点（原文档不变）
 *
 * - `scope: 'chapter'`：每章末尾追加「注释」标题行 + 该章尾注；
 *   不在任何章内的尾注（扁平文档 / 卷首）兜底排到书末；
 * - `scope: 'book'`：所有尾注集中到书末新增的一章（id 缺省 `endnotes`）。
 */
export function groupEndnotes(root: BookNode, options: EndnoteGroupingOptions): BookNode {
  const title = options.title ?? '注释';

  if (options.scope === 'book') {
    const { node, notes } = extract(root);
    if (notes.length === 0) return node;

    const chapterId = options.id ?? 'endnotes';
    const used = new Set<string>();
    const collectIds = (target: BookNode): void => {
      if (target.id !== undefined) used.add(target.id);
      for (const child of target.children ?? []) collectIds(child);
    };
    collectIds(node);
    const id = used.has(chapterId) ? `${chapterId}-2` : chapterId;

    const chapter: BookNode = {
      type: NODE_TYPES.CHAPTER,
      id,
      attrs: { title },
      children: [...titleBlocks(title, 1), ...notes],
    };
    return { ...node, children: [...(node.children ?? []), chapter] };
  }

  const { node, pending } = groupByChapter(root, title);
  if (pending.length === 0) return node;
  return { ...node, children: [...(node.children ?? []), ...titleBlocks(title, 1), ...pending] };
}
