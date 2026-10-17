/**
 * 分片存储（P2：增量落盘）
 *
 * 问题：`save` 是整本 `put`，IndexedDB 的结构化克隆在主线程同步执行，成本与
 * 文档体积成正比（1.8 MB 文档 ≈ 20~30 ms/轮）。大书连续编辑时，每轮落盘都是
 * 一次可见的卡顿。
 *
 * 方案：把文档切成「骨架 + 片」
 * - 骨架：结构树的浅层副本，被切出去的内容用 `{ $chunk: id }` 占位；
 * - 片：**一组连续兄弟节点**（单棵子树或若干相邻叶子），估算体积 ≤ 32 KiB。
 * 落盘时只写「引用发生变化」的片——IR 快照走结构共享（`getSharedDocument`），
 * 未改子树与上一轮是**同一对象引用**，据此可 O(变化路径) 判定，无需序列化比较。
 *
 * 关键设计（为什么片是「兄弟节点数组」而不是单棵子树）：
 * 只按单棵子树成片时，一万多个顶层段落会碎成一万多条记录（每条几十字节），
 * IDB 记录数爆炸反而更慢；把相邻小兄弟合并成片后，记录数 ≈ 文档体积 / 32 KiB。
 *
 * 对齐复用（局部编辑只重写局部片）：
 * 用「片首节点引用 → 旧片」建索引，重新切分时若当前节点正是某个旧片的首节点
 * 且该片节点逐项引用一致，则整片原样复用——插入一个段落后，其后所有片仍能命中
 * 旧索引，不会被"桶边界整体位移"连累。
 *
 * 正确性：引用相同 ⇒ 内容必然相同（IR 视为只读），故复用片的 id 且跳过写入。
 */
import type { Attrs, BookMark, BookNode } from '@bibliotype/core';

/** 片大小软上限（估算字节）：超过则继续下钻切分 */
export const CHUNK_BUDGET_BYTES = 32 * 1024;

/**
 * 骨架节点（可持久化）
 *
 * `{ $chunk: id }` 在 `children` 中表示「此处展开该片的全部节点」（可能是 0..n 个
 * 兄弟节点），因此恢复时按数组 splice 展开，而不是当作单个节点。
 */
export type SkeletonNode =
  | { $chunk: string }
  | {
      type: string;
      id?: string;
      attrs?: Attrs;
      children?: SkeletonNode[];
      text?: string;
      marks?: BookMark[];
    };

/** 切片结果：整片（一组兄弟节点）或下钻容器 */
export type ChunkSlice =
  | {
      kind: 'chunk';
      /** 片内节点（连续兄弟；单棵树成片时长度为 1） */
      nodes: BookNode[];
      /** 片 id */
      id: string;
      /** 估算体积（字节） */
      size: number;
    }
  | {
      kind: 'node';
      /** 该容器节点 */
      node: BookNode;
      /** 估算体积（字节） */
      size: number;
      /** 子切片（与 node.children 顺序对应，片可能覆盖多个 child） */
      children: ChunkSlice[];
    };

/** 一片待写记录 */
export interface ChunkWrite {
  /** 片 id */
  chunkId: string;
  /** 片内节点（连续兄弟） */
  nodes: BookNode[];
}

/** 一轮切片的产物 */
export interface ChunkedSnapshot {
  /** 持久化用骨架 */
  skeleton: SkeletonNode;
  /** 内存态切片树（下一轮复用；不持久化） */
  root: ChunkSlice;
  /** 本轮用到的全部片 id */
  chunkIds: Set<string>;
  /** 需要写库的片（引用未变的老片不在此列） */
  writes: ChunkWrite[];
  /** 估算总体积（调试 / 指标） */
  bytes: number;
}

/** 切片上下文 */
interface ChunkBuildContext {
  /** 取节点对应的片 id（同一对象引用 → 同一 id） */
  idOf: (node: BookNode) => string;
  /** 登记一片待写入内容 */
  markWrite: (chunkId: string, nodes: BookNode[]) => void;
}

/** 节点自身（不含子树）的粗略字节估算：只用于切片阈值，不参与内容 */
function ownBytes(node: BookNode): number {
  let total = 48;
  if (typeof node.text === 'string') total += node.text.length * 2;
  if (node.attrs !== undefined) total += Object.keys(node.attrs).length * 24;
  if (node.marks !== undefined) total += node.marks.length * 16;
  return total;
}

/**
 * 估算单节点子树体积（引用与上次切片相同则取缓存值）
 *
 * 只沿「引用已变化」的路径调用（未变子树在切片阶段整棵复用，根本不进这里），
 * 故不做逐层缓存对齐：变化的子树本来就该重算。
 *
 * @param node 子树根
 * @param prev 该节点上一轮的切片（片或容器）
 */
function subtreeBytes(node: BookNode, prev: ChunkSlice | undefined): number {
  if (prev !== undefined) {
    if (prev.kind === 'chunk' && prev.nodes.length === 1 && prev.nodes[0] === node) return prev.size;
    if (prev.kind === 'node' && prev.node === node) return prev.size;
  }
  let total = ownBytes(node);
  for (const child of node.children ?? []) total += subtreeBytes(child, undefined);
  return total;
}

/** 一组节点与 children[start..] 是否逐项引用相同 */
function sameNodes(nodes: readonly BookNode[], children: readonly BookNode[], start: number): boolean {
  if (start + nodes.length > children.length) return false;
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i] !== children[start + i]) return false;
  }
  return true;
}

/** 一组节点的引用序列是否与旧片完全一致（同一批对象，顺序相同） */
function sameChunk(slice: ChunkSlice, nodes: readonly BookNode[]): boolean {
  if (slice.kind !== 'chunk' || slice.nodes.length !== nodes.length) return false;
  for (let i = 0; i < nodes.length; i += 1) {
    if (slice.nodes[i] !== nodes[i]) return false;
  }
  return true;
}

/**
 * 切分一组兄弟节点
 *
 * @param children 兄弟节点序列
 * @param prevChildren 上一轮该层的子切片（对齐索引用）
 * @param context 切片上下文
 */
function sliceChildren(
  children: readonly BookNode[],
  prevChildren: readonly ChunkSlice[] | undefined,
  context: ChunkBuildContext,
): ChunkSlice[] {
  // 旧片索引：片首节点引用 → 旧切片（对齐复用）
  const prevByHead = new Map<BookNode, ChunkSlice>();
  for (const slice of prevChildren ?? []) {
    const head = slice.kind === 'chunk' ? slice.nodes[0] : slice.node;
    if (head !== undefined) prevByHead.set(head, slice);
  }

  const out: ChunkSlice[] = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i] as BookNode;
    const prev = prevByHead.get(child);

    // ① 命中旧片首节点且整片引用一致 → 原样复用（零成本，不写库）
    if (prev?.kind === 'chunk' && sameNodes(prev.nodes, children, i)) {
      out.push(prev);
      i += prev.nodes.length;
      continue;
    }
    // ② 命中旧容器且节点引用相同 → 整棵复用
    if (prev?.kind === 'node' && prev.node === child) {
      out.push(prev);
      i += 1;
      continue;
    }

    const childSize = subtreeBytes(child, prev);
    // ③ 单节点就超预算 → 下钻（其子节点再按本函数装桶）
    if (childSize > CHUNK_BUDGET_BYTES) {
      out.push(sliceNode(child, prev, context, false));
      i += 1;
      continue;
    }

    // ④ 小节点：与后续连续小兄弟贪心装桶（遇到「旧片首节点」即断桶，保住对齐）
    const nodes: BookNode[] = [];
    let size = 0;
    let j = i;
    while (j < children.length) {
      const candidate = children[j] as BookNode;
      if (j > i && prevByHead.has(candidate)) break;
      const candidateSize = subtreeBytes(candidate, prevByHead.get(candidate));
      if (candidateSize > CHUNK_BUDGET_BYTES) break;
      if (nodes.length > 0 && size + candidateSize > CHUNK_BUDGET_BYTES) break;
      nodes.push(candidate);
      size += candidateSize;
      j += 1;
    }

    const id = context.idOf(nodes[0] as BookNode);
    context.markWrite(id, nodes);
    out.push({ kind: 'chunk', nodes, id, size });
    i = j;
  }
  return out;
}

/**
 * 切分一棵子树
 *
 * @param node 待切分节点
 * @param prev 上一轮该位置的切片（引用相同 → 整棵原样复用，不再下钻）
 * @param context 切片上下文
 * @param forceSplit 强制下钻（文档根节点用：避免整本书退化成单片，骨架失去意义）
 */
function sliceNode(
  node: BookNode,
  prev: ChunkSlice | undefined,
  context: ChunkBuildContext,
  forceSplit: boolean,
): ChunkSlice {
  // 引用相同 ⇒ 内容必然相同：整片 / 整棵子树原样复用
  if (prev !== undefined && prev.kind === 'node' && prev.node === node) return prev;
  if (prev !== undefined && prev.kind === 'chunk' && prev.nodes.length === 1 && prev.nodes[0] === node) {
    return prev;
  }

  const size = subtreeBytes(node, prev);
  const children = node.children;
  if (!forceSplit && (children === undefined || children.length === 0 || size <= CHUNK_BUDGET_BYTES)) {
    const id = context.idOf(node);
    context.markWrite(id, [node]);
    return { kind: 'chunk', nodes: [node], id, size };
  }

  const prevChildren = prev?.kind === 'node' ? prev.children : undefined;
  return {
    kind: 'node',
    node,
    size,
    children: sliceChildren(children ?? [], prevChildren, context),
  };
}

/** 切片树 → 可持久化骨架 */
function toSkeleton(slice: ChunkSlice): SkeletonNode {
  // 片（可能覆盖多个兄弟节点）统一用一个占位表示：恢复时展开为该片全部节点
  if (slice.kind === 'chunk') return { $chunk: slice.id };
  const node = slice.node;
  const skeleton: SkeletonNode & { children: SkeletonNode[] } = {
    type: node.type,
    children: (slice.children ?? []).map(toSkeleton),
  };
  if (node.id !== undefined) skeleton.id = node.id;
  if (node.attrs !== undefined) skeleton.attrs = node.attrs;
  if (node.text !== undefined) skeleton.text = node.text;
  if (node.marks !== undefined) skeleton.marks = node.marks;
  return skeleton;
}

/**
 * 构建一轮切片（增量：引用未变的子树整棵复用）
 *
 * @param root 文档根节点
 * @param previous 上一轮切片树（无则全量切分）
 * @param ids 片 id 池（WeakMap：同一对象引用 → 同一 id，跨轮复用）
 * @param nextId 分配新片 id 的回调（仅在遇到新首节点时调用）
 * @returns 本轮切片产物（含待写片与全部在用 id）
 */
export function buildChunkedSnapshot(
  root: BookNode,
  previous: ChunkSlice | undefined,
  ids: WeakMap<BookNode, string>,
  nextId: () => string,
): ChunkedSnapshot {
  /** 本轮需写入的片（引用未变的老片不进这里） */
  const writes: ChunkWrite[] = [];
  const context: ChunkBuildContext = {
    idOf: (node: BookNode): string => {
      const cached = ids.get(node);
      if (cached !== undefined) return cached;
      const id = nextId();
      ids.set(node, id);
      return id;
    },
    markWrite: (chunkId: string, nodes: BookNode[]): void => {
      writes.push({ chunkId, nodes });
    },
  };

  const sliced = sliceNode(root, previous, context, true);

  const chunkIds = new Set<string>();
  const collect = (slice: ChunkSlice): void => {
    if (slice.kind === 'chunk') {
      chunkIds.add(slice.id);
      return;
    }
    for (const child of slice.children) collect(child);
  };
  collect(sliced);

  return {
    skeleton: toSkeleton(sliced),
    root: sliced,
    chunkIds,
    writes,
    bytes: sliced.size,
  };
}

/** 片 id → 片内节点（读取时按骨架展开） */
export type ChunkNodeMap = ReadonlyMap<string, readonly BookNode[]>;

/**
 * 骨架 + 片 → 完整 IR 节点
 *
 * @param skeleton 持久化骨架
 * @param chunks 片 id → 片内节点
 * @returns 重建的节点；缺片时返回 undefined（调用方按「记录损坏」处理）
 */
export function fromSkeleton(
  skeleton: SkeletonNode,
  chunks: ChunkNodeMap,
): BookNode | undefined {
  if ('$chunk' in skeleton) {
    // 文档根不会是片（切片强制下钻），出现此形态说明骨架损坏
    return undefined;
  }
  const node: BookNode = { type: skeleton.type };
  if (skeleton.id !== undefined) node.id = skeleton.id;
  if (skeleton.attrs !== undefined) node.attrs = skeleton.attrs;
  if (skeleton.text !== undefined) node.text = skeleton.text;
  if (skeleton.marks !== undefined) node.marks = skeleton.marks;
  if (skeleton.children !== undefined) {
    const children: BookNode[] = [];
    for (const child of skeleton.children) {
      if ('$chunk' in child) {
        const nodes = chunks.get(child.$chunk);
        if (nodes === undefined) return undefined;
        children.push(...nodes);
        continue;
      }
      const restored = fromSkeleton(child, chunks);
      if (restored === undefined) return undefined;
      children.push(restored);
    }
    node.children = children;
  }
  return node;
}
