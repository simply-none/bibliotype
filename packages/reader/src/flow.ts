/**
 * 流式阅读分块（P3 D5）
 *
 * 把 IR 树切成「章 + 分块」的扁平列表，供 `scroll-flow` 模式按需挂载：
 *
 * - **章边界**：卷 / 章 / 节 / 序 / 跋 / 附录 各自成组，块不跨章拼接，
 *   这样懒加载与「跳到第 N 章」都以章为单位，占位高度误差不跨章累积；
 * - **块上限**：章内按块数与字数双上限切片（默认 24 块 / 1200 字），
 *   单个表格、注文等块不被切开，避免渲染半张表；
 * - **确定性**：无 id 的块按文档顺序合成 `flow-<序号>`，同文档同选项
 *   两次调用结果逐字段一致；不取时间、不随机。
 *
 * 纯函数、不依赖分页结果——这正是流式模式能「绕开一次性预分页」的原因。
 */
import { NODE_TYPES, isTextNode, type BookDocument, type BookNode } from '@bibliotype/core';
import { collectNodeText } from './document-blocks.js';

/** 单个分块默认最多容纳的块数 */
export const DEFAULT_FLOW_CHUNK_BLOCKS = 24;
/** 单个分块默认最多容纳的字数 */
export const DEFAULT_FLOW_CHUNK_CHARS = 1200;

/** 参与分章的容器类型（其余容器透明下钻） */
const FLOW_SECTION_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
  NODE_TYPES.APPENDIX,
]);

/** 流式分块 */
export interface FlowChunk {
  /** 稳定 key（`<容器 id>#<序号>`，同文档同选项可复现） */
  key: string;
  /** 所属章容器 id（顶层散块为根节点 id 或 `flow-root`） */
  containerId: string;
  /** 章标题（取容器下首个 heading 或 `attrs.title`；顶层块无标题） */
  title?: string;
  /** 结构层级（根下第一层为 1） */
  level: number;
  /**
   * 分块内的块节点（IR 引用，不复制）
   *
   * 视图层直接用它序列化——不必再按 id 反查，无 id 的块也能渲染。
   */
  nodes: readonly BookNode[];
  /**
   * 分块内块的 id（与 `nodes` 一一对应）
   *
   * 原节点无 id 时合成 `flow-<块序号>`：可作稳定 key / 占位标识，
   * 但 `Reader.getNode` 查不到（不存在的节点不该被反查到）。
   */
  nodeIds: string[];
  /** 文档内块序号起点（0 起，用于阅读进度） */
  startIndex: number;
  /** 分块总字数（高度估算与进度用） */
  charCount: number;
}

/** 分块选项 */
export interface BuildFlowChunksOptions {
  /** 单块最多块数（缺省 24；< 1 时按 1 处理） */
  maxBlocksPerChunk?: number;
  /** 单块最多字数（缺省 1200；< 1 时按 1 处理） */
  maxCharsPerChunk?: number;
}

/** 是否为分章容器 */
function isSectionNode(node: BookNode): boolean {
  return FLOW_SECTION_TYPES.has(node.type);
}

/** 是否还有元素子节点（有则继续下钻，否则视为可渲染的块） */
function hasElementChildren(node: BookNode): boolean {
  return (node.children ?? []).some((child) => !isTextNode(child));
}

/**
 * 章标题
 *
 * 优先 `attrs.title`，其次容器下第一个 heading 的文本；都没有则不设标题
 * （顶层散块、无标题章）。不递归取首个段落的文字——那会把正文当标题。
 */
function sectionTitleOf(node: BookNode): string | undefined {
  const attrTitle = node.attrs?.['title'];
  if (typeof attrTitle === 'string' && attrTitle.trim() !== '') {
    return attrTitle.trim();
  }
  const heading = (node.children ?? []).find((child) => child.type === NODE_TYPES.HEADING);
  if (heading === undefined) return undefined;
  const text = collectNodeText(heading).trim();
  return text === '' ? undefined : text;
}

/** 分章上下文 */
interface SectionCursor {
  containerId: string;
  title?: string;
  level: number;
}

/**
 * 构建流式分块
 *
 * @param document IR 文档
 * @param options 块数 / 字数上限
 * @returns 按文档顺序排列的分块列表（空文档返回 `[]`）
 */
export function buildFlowChunks(
  document: BookDocument,
  options: BuildFlowChunksOptions = {},
): FlowChunk[] {
  const maxBlocks = Math.max(1, Math.floor(options.maxBlocksPerChunk ?? DEFAULT_FLOW_CHUNK_BLOCKS));
  const maxChars = Math.max(1, Math.floor(options.maxCharsPerChunk ?? DEFAULT_FLOW_CHUNK_CHARS));

  const chunks: FlowChunk[] = [];
  let blockIndex = 0;
  let seq = 0;

  interface Buffer {
    cursor: SectionCursor;
    nodes: BookNode[];
    nodeIds: string[];
    chars: number;
    startIndex: number;
  }
  let buffer: Buffer | undefined;

  const flush = (): void => {
    if (buffer === undefined) return;
    const { cursor, nodes, nodeIds, chars, startIndex } = buffer;
    buffer = undefined;
    if (nodes.length === 0) return;
    chunks.push({
      key: `${cursor.containerId}#${seq}`,
      containerId: cursor.containerId,
      ...(cursor.title === undefined ? {} : { title: cursor.title }),
      level: cursor.level,
      nodes,
      nodeIds,
      startIndex,
      charCount: chars,
    });
    seq += 1;
  };

  const pushBlock = (node: BookNode, cursor: SectionCursor): void => {
    if (buffer !== undefined && buffer.cursor.containerId !== cursor.containerId) flush();
    if (buffer === undefined) {
      buffer = { cursor, nodes: [], nodeIds: [], chars: 0, startIndex: blockIndex };
    }
    buffer.nodes.push(node);
    buffer.nodeIds.push(
      typeof node.id === 'string' && node.id !== '' ? node.id : `flow-${blockIndex}`,
    );
    buffer.chars += collectNodeText(node).length;
    blockIndex += 1;
    if (buffer.nodes.length >= maxBlocks || buffer.chars >= maxChars) flush();
  };

  const walk = (node: BookNode, cursor: SectionCursor): void => {
    const section = isSectionNode(node);
    const nextCursor: SectionCursor = section
      ? {
          containerId:
            typeof node.id === 'string' && node.id !== ''
              ? node.id
              : `${cursor.containerId}/${node.type}`,
          ...(sectionTitleOf(node) === undefined ? {} : { title: sectionTitleOf(node) as string }),
          level: cursor.level + 1,
        }
      : cursor;

    // 进入新章前先收束上一章的分块，保证块不跨章
    if (section) flush();

    for (const child of node.children ?? []) {
      if (isTextNode(child)) continue;
      if (isSectionNode(child) || hasElementChildren(child)) {
        walk(child, nextCursor);
      } else {
        pushBlock(child, nextCursor);
      }
    }

    if (section) flush();
  };

  const root: BookNode = document.root;
  walk(root, {
    containerId:
      typeof root.id === 'string' && root.id !== '' ? root.id : 'flow-root',
    level: 0,
  });
  flush();

  return chunks;
}
