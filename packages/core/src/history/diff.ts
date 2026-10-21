/**
 * 文档 diff（C7）：节点级增 / 删 / 改 + 文本内联差异
 *
 * 定位：版本对比面板与「改了哪里」摘要的唯一口径，纯函数、无 DOM、确定性。
 *
 * 对齐策略：
 * - 子节点先按 `id` 对齐；无 id 时退化为 `type + 首行文本` 键；
 * - 同层用 LCS 求最长公共子序列，未匹配的旧节点记删除、新节点记新增；
 * - 同键节点递归比较：文本叶子做字符级内联 diff，其余比较 attrs。
 *
 * 复杂度 O(n·m) 只作用于**同一父节点的子序列**，千块文档为毫秒级。
 */
import type { BookDocument } from '../ir/document.js';
import type { BookNode } from '../ir/nodes.js';
import { isTextNode } from '../ir/nodes.js';

/** 差异种类常量 */
export const DOCUMENT_CHANGE_KINDS = {
  /** 新增节点 */
  ADDED: 'added',
  /** 删除节点 */
  REMOVED: 'removed',
  /** 内容 / 属性 / 标记变化 */
  MODIFIED: 'modified',
} as const;

/** 差异种类联合 */
export type DocumentChangeKind =
  (typeof DOCUMENT_CHANGE_KINDS)[keyof typeof DOCUMENT_CHANGE_KINDS];

/** 单条差异 */
export interface DocumentChange {
  /** 差异种类 */
  kind: DocumentChangeKind;
  /** 结构路径，如 `root.children[0].children[1]` */
  path: string;
  /** 节点类型 */
  nodeType?: string;
  /** 节点 id */
  nodeId?: string;
  /** 变化前摘要（删除 / 修改时） */
  before?: string;
  /** 变化后摘要（新增 / 修改时） */
  after?: string;
}

/** 文档差异结果 */
export interface DocumentDiff {
  /** 全部差异（按遍历顺序） */
  changes: DocumentChange[];
  /** 新增节点数 */
  added: number;
  /** 删除节点数 */
  removed: number;
  /** 修改节点数 */
  modified: number;
}

/** 内联文本差异片段 */
export interface TextDiffSegment {
  /** 片段种类 */
  kind: 'equal' | 'insert' | 'delete';
  /** 片段文本 */
  text: string;
}

/** 内联 diff 的最大字符数（超出改用整体替换，避免 O(n·m) 爆炸） */
const INLINE_DIFF_LIMIT = 2000;

/** 节点对齐键 */
function alignKey(node: BookNode, index: number): string {
  if (node.id !== undefined && node.id !== '') {
    return `id:${node.id}`;
  }
  if (isTextNode(node)) {
    return `text:${node.type}:${(node.text ?? '').slice(0, 40)}`;
  }
  const title = node.attrs?.['title'];
  return `node:${node.type}:${typeof title === 'string' ? title : index}`;
}

/** 节点内容摘要（差异列表展示用） */
function excerptOf(node: BookNode): string {
  if (isTextNode(node)) {
    return (node.text ?? '').slice(0, 80);
  }
  const title = node.attrs?.['title'];
  if (typeof title === 'string' && title !== '') {
    return title;
  }
  const texts: string[] = [];
  collectText(node, texts, 80);
  return texts.join('').slice(0, 80);
}

/** 递归收集文本（限量） */
function collectText(node: BookNode, out: string[], limit: number): void {
  if (out.join('').length >= limit) {
    return;
  }
  if (isTextNode(node)) {
    out.push(node.text ?? '');
    return;
  }
  for (const child of node.children ?? []) {
    collectText(child, out, limit);
  }
}

/** 属性快照（稳定键序，便于比较） */
function attrsSnapshot(node: BookNode): string {
  const attrs = node.attrs;
  if (attrs === undefined) {
    return '';
  }
  const keys = Object.keys(attrs).sort();
  return keys.map((key) => `${key}=${JSON.stringify(attrs[key])}`).join('&');
}

/** 标记快照（顺序即层级，直接 JSON） */
function marksSnapshot(node: BookNode): string {
  const marks = node.marks;
  if (marks === undefined || marks.length === 0) {
    return '';
  }
  return JSON.stringify(marks);
}

/**
 * 字符级内联 diff（LCS）
 *
 * 超长文本（任一侧 > 2000 字符）退化为「整段删除 + 整段新增」，
 * 避免版本对比在超长段落上卡顿。
 */
export function inlineTextDiff(before: string, after: string): TextDiffSegment[] {
  if (before === after) {
    return before === '' ? [] : [{ kind: 'equal', text: before }];
  }
  const left = Array.from(before);
  const right = Array.from(after);
  if (left.length > INLINE_DIFF_LIMIT || right.length > INLINE_DIFF_LIMIT) {
    return [
      { kind: 'delete', text: before },
      { kind: 'insert', text: after },
    ];
  }
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      const nextRow = table[i + 1];
      if (row === undefined || nextRow === undefined) {
        continue;
      }
      row[j] =
        left[i] === right[j]
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const segments: TextDiffSegment[] = [];
  const push = (kind: TextDiffSegment['kind'], text: string): void => {
    if (text === '') {
      return;
    }
    const last = segments[segments.length - 1];
    if (last !== undefined && last.kind === kind) {
      segments[segments.length - 1] = { kind, text: last.text + text };
      return;
    }
    segments.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push('equal', left[i] ?? '');
      i += 1;
      j += 1;
      continue;
    }
    const down = table[i + 1]?.[j] ?? 0;
    const right0 = table[i]?.[j + 1] ?? 0;
    if (down >= right0) {
      push('delete', left[i] ?? '');
      i += 1;
    } else {
      push('insert', right[j] ?? '');
      j += 1;
    }
  }
  while (i < left.length) {
    push('delete', left[i] ?? '');
    i += 1;
  }
  while (j < right.length) {
    push('insert', right[j] ?? '');
    j += 1;
  }
  return segments;
}

/** LCS 对齐（返回匹配索引对） */
function alignSequences(left: readonly string[], right: readonly string[]): [number, number][] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      const nextRow = table[i + 1];
      if (row === undefined || nextRow === undefined) {
        continue;
      }
      row[j] =
        left[i] === right[j]
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** 差异收集器 */
class DiffCollector {
  readonly changes: DocumentChange[] = [];
  added = 0;
  removed = 0;
  modified = 0;

  push(change: DocumentChange): void {
    this.changes.push(change);
    if (change.kind === DOCUMENT_CHANGE_KINDS.ADDED) {
      this.added += 1;
    } else if (change.kind === DOCUMENT_CHANGE_KINDS.REMOVED) {
      this.removed += 1;
    } else {
      this.modified += 1;
    }
  }

  toResult(): DocumentDiff {
    return { changes: this.changes, added: this.added, removed: this.removed, modified: this.modified };
  }
}

/** 递归比较两个节点 */
function diffNode(
  before: BookNode,
  after: BookNode,
  path: string,
  collector: DiffCollector,
): void {
  const base: { path: string; nodeType?: string; nodeId?: string } = { path };
  base.nodeType = before.type;
  if (after.id !== undefined) {
    base.nodeId = after.id;
  } else if (before.id !== undefined) {
    base.nodeId = before.id;
  }
  if (before.type !== after.type) {
    collector.push({ ...base, kind: DOCUMENT_CHANGE_KINDS.REMOVED, before: excerptOf(before) });
    collector.push({
      ...base,
      nodeType: after.type,
      kind: DOCUMENT_CHANGE_KINDS.ADDED,
      after: excerptOf(after),
    });
    return;
  }
  if (isTextNode(before) && isTextNode(after)) {
    const beforeText = before.text ?? '';
    const afterText = after.text ?? '';
    if (beforeText !== afterText) {
      collector.push({
        ...base,
        kind: DOCUMENT_CHANGE_KINDS.MODIFIED,
        before: beforeText.slice(0, 80),
        after: afterText.slice(0, 80),
      });
    }
    if (marksSnapshot(before) !== marksSnapshot(after)) {
      collector.push({
        ...base,
        kind: DOCUMENT_CHANGE_KINDS.MODIFIED,
        before: marksSnapshot(before),
        after: marksSnapshot(after),
      });
    }
    return;
  }
  if (attrsSnapshot(before) !== attrsSnapshot(after)) {
    collector.push({
      ...base,
      kind: DOCUMENT_CHANGE_KINDS.MODIFIED,
      before: attrsSnapshot(before),
      after: attrsSnapshot(after),
    });
  }
  diffChildren(before.children ?? [], after.children ?? [], path, collector);
}

/** 同层子序列对齐后递归 */
function diffChildren(
  before: readonly BookNode[],
  after: readonly BookNode[],
  path: string,
  collector: DiffCollector,
): void {
  const leftKeys = before.map((node, index) => alignKey(node, index));
  const rightKeys = after.map((node, index) => alignKey(node, index));
  const pairs = alignSequences(leftKeys, rightKeys);
  const matchedLeft = new Set(pairs.map(([i]) => i));
  const matchedRight = new Set(pairs.map(([, j]) => j));

  let cursor = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (matchedLeft.has(i)) {
      continue;
    }
    const node = before[i];
    if (node === undefined) {
      continue;
    }
    collector.push({
      kind: DOCUMENT_CHANGE_KINDS.REMOVED,
      path: `${path}.children[${cursor}]`,
      nodeType: node.type,
      ...(node.id === undefined ? {} : { nodeId: node.id }),
      before: excerptOf(node),
    });
    cursor += 1;
  }
  for (let j = 0; j < after.length; j += 1) {
    if (matchedRight.has(j)) {
      continue;
    }
    const node = after[j];
    if (node === undefined) {
      continue;
    }
    collector.push({
      kind: DOCUMENT_CHANGE_KINDS.ADDED,
      path: `${path}.children[${j}]`,
      nodeType: node.type,
      ...(node.id === undefined ? {} : { nodeId: node.id }),
      after: excerptOf(node),
    });
  }
  for (const [i, j] of pairs) {
    const left = before[i];
    const right = after[j];
    if (left !== undefined && right !== undefined) {
      diffNode(left, right, `${path}.children[${j}]`, collector);
    }
  }
}

/**
 * 比较两份文档
 *
 * 顶层元数据差异记为 `root` 路径上的 `modified`（标题 / 责任者等书目信息变化）。
 */
export function diffDocuments(before: BookDocument, after: BookDocument): DocumentDiff {
  const collector = new DiffCollector();
  const beforeMeta = JSON.stringify(before.metadata);
  const afterMeta = JSON.stringify(after.metadata);
  if (beforeMeta !== afterMeta) {
    collector.push({
      kind: DOCUMENT_CHANGE_KINDS.MODIFIED,
      path: 'metadata',
      nodeType: 'metadata',
      before: before.metadata.title,
      after: after.metadata.title,
    });
  }
  diffNode(before.root, after.root, 'root', collector);
  return collector.toResult();
}
