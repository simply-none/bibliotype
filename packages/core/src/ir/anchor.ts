/**
 * 锚点（Anchor）：正文位置的稳定引用
 *
 * 页码会随字号 / 版式 / 屏宽变化而漂移，节点 id 不会。因此所有需要「记住某个位置」
 * 的能力统一走本模块的锚点契约：
 * - 阅读位置恢复（记住读到哪一段哪一字的偏移）；
 * - 书签 / 高亮 / 批注（annotation 包基于本类型）；
 * - 脚注 ref 与交叉引用（xref 包基于本类型定位目标）；
 * - 协同光标（远端位置描述）。
 *
 * 序列化格式（单一字符串，可存 localStorage / IndexedDB / URL）：
 * - 块锚点：`bt:block:<nodeId>`（nodeId 经 encodeURIComponent）
 * - 文本锚点：`bt:text:<nodeId>:<offset>:<length>`
 *
 * 设计约束：偏移量以「节点纯文本」为坐标轴（`nodePlainText`），不含注文标记之外的
 * 任何 DOM 结构信息，因此跨渲染后端（HTML / EPUB / 分页预览）语义一致。
 */
import type { NodeId } from './types.js';
import type { BookNode } from './nodes.js';
import { isTextNode } from './nodes.js';

/** 锚点类型常量 */
export const ANCHOR_TYPES = {
  /** 整块锚点（段落 / 标题 / 图片等） */
  BLOCK: 'block',
  /** 文本区间锚点（块内纯文本偏移） */
  TEXT: 'text',
} as const;

/** 锚点类型联合 */
export type AnchorType = (typeof ANCHOR_TYPES)[keyof typeof ANCHOR_TYPES];

/** 序列化前缀（用于区分「锚点字符串」与普通文本） */
export const ANCHOR_PREFIX = 'bt';

/** 整块锚点 */
export interface BlockAnchor {
  /** 锚点类型 */
  type: typeof ANCHOR_TYPES.BLOCK;
  /** 目标节点 id */
  nodeId: NodeId;
}

/** 文本区间锚点（半开区间 [offset, offset + length)） */
export interface TextAnchor {
  /** 锚点类型 */
  type: typeof ANCHOR_TYPES.TEXT;
  /** 目标节点 id（提供纯文本坐标轴的块节点） */
  nodeId: NodeId;
  /** 起始偏移（含） */
  offset: number;
  /** 长度（0 表示插入型光标位置） */
  length: number;
}

/** 锚点联合类型 */
export type Anchor = BlockAnchor | TextAnchor;

/** 锚点解析结果 */
export interface ResolvedAnchor {
  /** 规范化后的锚点（偏移量已按当前文本长度裁剪） */
  anchor: Anchor;
  /** 目标节点 */
  node: BookNode;
  /** 锚点覆盖的纯文本（块锚点为整块文本） */
  text: string;
  /** 是否因原文变短而裁剪了偏移量 */
  clamped: boolean;
}

/** 创建整块锚点 */
export function createBlockAnchor(nodeId: NodeId): BlockAnchor {
  if (!nodeId) {
    throw new RangeError('创建块锚点失败：nodeId 不能为空。');
  }
  return { type: ANCHOR_TYPES.BLOCK, nodeId };
}

/** 创建文本区间锚点（负值抛错，长度缺省为 0 表示光标） */
export function createTextAnchor(nodeId: NodeId, offset: number, length = 0): TextAnchor {
  if (!nodeId) {
    throw new RangeError('创建文本锚点失败：nodeId 不能为空。');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError('创建文本锚点失败：offset 必须为非负整数。');
  }
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('创建文本锚点失败：length 必须为非负整数。');
  }
  return { type: ANCHOR_TYPES.TEXT, nodeId, offset, length };
}

/** 运行时判定是否为合法锚点对象 */
export function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate: { type?: unknown; nodeId?: unknown; offset?: unknown; length?: unknown } =
    value as { type?: unknown; nodeId?: unknown; offset?: unknown; length?: unknown };
  if (typeof candidate.nodeId !== 'string' || candidate.nodeId.length === 0) {
    return false;
  }
  if (candidate.type === ANCHOR_TYPES.BLOCK) {
    return true;
  }
  return (
    candidate.type === ANCHOR_TYPES.TEXT &&
    Number.isInteger(candidate.offset) &&
    (candidate.offset as number) >= 0 &&
    Number.isInteger(candidate.length) &&
    (candidate.length as number) >= 0
  );
}

/** 序列化锚点为单一字符串 */
export function serializeAnchor(anchor: Anchor): string {
  const id = encodeURIComponent(anchor.nodeId);
  if (anchor.type === ANCHOR_TYPES.BLOCK) {
    return `${ANCHOR_PREFIX}:block:${id}`;
  }
  return `${ANCHOR_PREFIX}:text:${id}:${anchor.offset}:${anchor.length}`;
}

/** 安全解码（非法百分号编码返回 undefined 而非抛错） */
function safeDecode(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** 解析锚点字符串（非法输入返回 undefined，不抛错） */
export function parseAnchor(value: string): Anchor | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value.split(':');
  if (parts[0] !== ANCHOR_PREFIX) {
    return undefined;
  }
  if (parts[1] === ANCHOR_TYPES.BLOCK && parts.length === 3) {
    const nodeId = safeDecode(parts[2]);
    return nodeId ? { type: ANCHOR_TYPES.BLOCK, nodeId } : undefined;
  }
  if (parts[1] === ANCHOR_TYPES.TEXT && parts.length === 5) {
    const nodeId = safeDecode(parts[2]);
    const offset = Number.parseInt(parts[3] ?? '', 10);
    const length = Number.parseInt(parts[4] ?? '', 10);
    if (!nodeId || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 0) {
      return undefined;
    }
    return { type: ANCHOR_TYPES.TEXT, nodeId, offset, length };
  }
  return undefined;
}

/** 收集节点纯文本（递归拼接叶子文本，不含任何标记信息） */
export function nodePlainText(node: BookNode): string {
  if (isTextNode(node)) {
    return node.text ?? '';
  }
  let text = '';
  for (const child of node.children ?? []) {
    text += nodePlainText(child);
  }
  return text;
}

/** 深度优先查找节点（先序，命中 id 即返回） */
export function locateNode(root: BookNode, nodeId: NodeId): BookNode | undefined {
  if (root.id === nodeId) {
    return root;
  }
  for (const child of root.children ?? []) {
    const hit = locateNode(child, nodeId);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

/** 按当前文本长度裁剪锚点偏移（超界时收缩到文本末尾） */
export function clampAnchor(anchor: Anchor, textLength: number): Anchor {
  if (anchor.type === ANCHOR_TYPES.BLOCK) {
    return anchor;
  }
  const offset = Math.min(anchor.offset, textLength);
  const length = Math.min(anchor.length, textLength - offset);
  return { type: ANCHOR_TYPES.TEXT, nodeId: anchor.nodeId, offset, length };
}

/**
 * 解析锚点到具体节点与文本
 *
 * 目标节点不存在（被删除）时返回 undefined——调用方据此判定「孤儿锚点」，
 * 不应抛错：文档演进中锚点失效是常态，需由上层决定降级策略。
 */
export function resolveAnchor(root: BookNode, anchor: Anchor): ResolvedAnchor | undefined {
  const node = locateNode(root, anchor.nodeId);
  if (!node) {
    return undefined;
  }
  const plain = nodePlainText(node);
  if (anchor.type === ANCHOR_TYPES.BLOCK) {
    return { anchor, node, text: plain, clamped: false };
  }
  const normalized = clampAnchor(anchor, plain.length);
  const clamped =
    normalized.type === ANCHOR_TYPES.TEXT &&
    (normalized.offset !== anchor.offset || normalized.length !== anchor.length);
  const start = normalized.type === ANCHOR_TYPES.TEXT ? normalized.offset : 0;
  const size = normalized.type === ANCHOR_TYPES.TEXT ? normalized.length : plain.length;
  return {
    anchor: normalized,
    node,
    text: plain.slice(start, start + size),
    clamped,
  };
}
