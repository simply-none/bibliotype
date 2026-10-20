/**
 * 编辑器状态查询（工具栏反显 / 快捷键互斥 / 上下文面板）
 *
 * 只读：不派发事务、不修改状态。所有判定基于 **PM 状态**（选区 + marks），
 * 与 IR 无关——IR 是导出产物，工具栏需要的是「此刻光标处是什么」。
 */
import { NODE_TYPES } from '@bibliotype/core';
import type { Mark, Node as PmNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

/** 祖先结构节点摘要 */
export interface BlockAncestor {
  /** PM 节点类型名（与 IR type 同名） */
  type: string;
  /** 节点 id（IR 稳定 id，若有） */
  nodeId?: string;
  /** 结构标题（卷 / 章 / 节的 attrs.title，若有） */
  title?: string;
}

/** 光标所在块信息 */
export interface ActiveBlockInfo {
  /** 块类型（paragraph / heading / code-block …） */
  type: string;
  /** 块 id（IR 稳定 id，若有） */
  nodeId?: string;
  /** 块属性（PM attrs 原样，含 id / rawAttrs） */
  attrs: Record<string, unknown>;
  /** 标题级别（仅 heading） */
  headingLevel?: number;
  /** 由外到内的结构祖先（不含文档根与块自身） */
  ancestors: BlockAncestor[];
}

/** 选区信息 */
export interface SelectionInfo {
  /** 是否空选区（光标） */
  empty: boolean;
  /** 起点（PM 位置，含） */
  from: number;
  /** 终点（PM 位置，不含） */
  to: number;
  /** 选区纯文本（块间以换行分隔） */
  text: string;
  /** 光标所在块 */
  block: ActiveBlockInfo;
  /** 选区涉及的块类型（文档序、去重） */
  blockTypes: string[];
  /** 是否跨块选区 */
  multiBlock: boolean;
}

/** 读取字符串属性 */
function readString(attrs: Record<string, unknown>, key: string): string | undefined {
  const value = attrs[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 取祖先摘要 */
function describeAncestor(node: PmNode): BlockAncestor {
  const attrs = node.attrs as Record<string, unknown>;
  const ancestor: BlockAncestor = { type: node.type.name };
  const nodeId = readString(attrs, 'id');
  if (nodeId !== undefined) {
    ancestor.nodeId = nodeId;
  }
  const title = readString(attrs, 'title');
  if (title !== undefined) {
    ancestor.title = title;
  }
  return ancestor;
}

/** 取当前选区生效的 marks（空选区取 storedMarks / 光标 marks） */
function currentMarks(state: EditorState): readonly Mark[] {
  const selection = state.selection;
  if (selection.empty) {
    return state.storedMarks ?? selection.$from.marks();
  }
  return selection.$from.marksAcross(selection.$to) ?? [];
}

/** 当前生效的标记名（去重，保持 marks 顺序） */
export function getActiveMarkNames(state: EditorState): string[] {
  const names: string[] = [];
  for (const mark of currentMarks(state)) {
    if (!names.includes(mark.type.name)) {
      names.push(mark.type.name);
    }
  }
  return names;
}

/** 指定标记是否生效 */
export function isMarkActive(state: EditorState, markName: string): boolean {
  return getActiveMarkNames(state).includes(markName);
}

/** 指定标记的属性（如 link 的 href；未生效返回 undefined） */
export function getActiveMarkAttrs(
  state: EditorState,
  markName: string,
): Record<string, unknown> | undefined {
  const mark = currentMarks(state).find((item) => item.type.name === markName);
  return mark ? { ...(mark.attrs as Record<string, unknown>) } : undefined;
}

/**
 * 光标所在块信息
 *
 * 优先取最近的文本块（paragraph / heading / code-block…）；若选中的是原子块
 * （图片 / 公式 / 分页符），退化取最近的块级节点。
 */
export function getActiveBlockInfo(state: EditorState): ActiveBlockInfo {
  const $from = state.selection.$from;
  let blockDepth = -1;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      blockDepth = depth;
      break;
    }
  }
  if (blockDepth < 0) {
    for (let depth = $from.depth; depth >= 1; depth -= 1) {
      const node = $from.node(depth);
      if (node.isBlock) {
        blockDepth = depth;
        break;
      }
    }
  }
  if (blockDepth < 0) {
    return { type: 'doc', attrs: {}, ancestors: [] };
  }

  const block = $from.node(blockDepth);
  const attrs = { ...(block.attrs as Record<string, unknown>) };
  const info: ActiveBlockInfo = {
    type: block.type.name,
    attrs,
    ancestors: [],
  };
  const nodeId = readString(attrs, 'id');
  if (nodeId !== undefined) {
    info.nodeId = nodeId;
  }
  if (block.type.name === NODE_TYPES.HEADING) {
    const level = attrs.level;
    if (typeof level === 'number') {
      info.headingLevel = level;
    }
  }
  const ancestors: BlockAncestor[] = [];
  for (let depth = 1; depth < blockDepth; depth += 1) {
    ancestors.push(describeAncestor($from.node(depth)));
  }
  info.ancestors = ancestors;
  return info;
}

/** 选区信息（文本、块类型、是否跨块） */
export function getSelectionInfo(state: EditorState): SelectionInfo {
  const { from, to, empty } = state.selection;
  const text = empty ? '' : state.doc.textBetween(from, to, '\n', ' ');
  const blockTypes: string[] = [];
  state.doc.nodesBetween(from, to, (node: PmNode) => {
    if (node.isTextblock && !blockTypes.includes(node.type.name)) {
      blockTypes.push(node.type.name);
    }
    return true;
  });
  return {
    empty,
    from,
    to,
    text,
    block: getActiveBlockInfo(state),
    blockTypes,
    multiBlock: blockTypes.length > 1,
  };
}
