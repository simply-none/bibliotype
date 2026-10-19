/**
 * 选区转换为容器节点（无 DOM）
 *
 * 与「段后插入空容器」的 `insertBlockAfterSelection` 相对：本模块**消费选区**，
 * 把选中的文字 / 整段内容搬进目标容器，并按目标类型的行为优化选区前后内容：
 *
 * - 段中选区：按 from / to 切成「前段 + 容器(选中内容) + 后段」；
 * - 整段选中：原段整体入容器，外层不留空段；
 * - 跨多个同级段落：首段取 from→段尾、尾段取段首→to、中间整段全部入容器；
 * - 空片段（纯空白 / 无内容）按选项删除；父容器至少保留一个可编辑块；
 * - 原块 `id` 保留给文档序第一个存留片段，其余拆分片段清空，**禁止重复 id**
 *   （`tr.split` 会复制 attrs，本模块改为手工切 Fragment，从根上避免该问题）；
 * - 容器内文本块默认规范化为段落（避免标题样式 / 分页语义进入注文），
 *   列表 / 表格等非文本块原样保留（`normalizeTextblocks: false` 可关闭）。
 *
 * 行内目标（`inline*`，如夹注 / 异体载体）复用 `insertInlineNodeWrapping`，
 * 仅支持同段选区。所有操作在单个 transaction 内完成，一次撤销整体还原。
 */

import { NODE_TYPES } from '@bibliotype/core';
import { Fragment, Slice } from 'prosemirror-model';
import type { Attrs, Node as PmNode, NodeType } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { insertBlockAfterSelection, insertInlineNodeWrapping } from './commands.js';

/** 原块 id 的归属策略 */
export type ReplaceIdOwner = 'first-surviving' | 'inner' | 'none';

/** 选区转换为容器的选项 */
export interface ReplaceContainerOptions {
  /** 拆分产生的空片段（纯空白 / 无内容）是否删除（默认 true） */
  dropEmptyFragments?: boolean;
  /** 原 textblock 的 id 归属（默认 'first-surviving'） */
  idOwner?: ReplaceIdOwner;
  /** 空选区时是否退化为「插入空容器」（默认 true，兼容旧插入行为） */
  insertWhenEmpty?: boolean;
  /**
   * 容器内文本块是否规范化为段落（默认 true）
   *
   * 注文 / 版式容器内出现标题会带上标题样式；规范化后只保留行内内容与
   * `id` / `rawAttrs`，正文语义更干净。列表 / 表格等非文本块不受影响。
   */
  normalizeTextblocks?: boolean;
}

/** 片段是否为空（纯空白文本 / 无内容；原子行内节点视为有内容） */
function isBlankFragment(fragment: Fragment): boolean {
  if (fragment.size === 0) {
    return true;
  }
  let blank = true;
  fragment.forEach((node) => {
    if (node.isText) {
      if ((node.text ?? '').trim() !== '') {
        blank = false;
      }
    } else {
      blank = false;
    }
  });
  return blank;
}

/** 复制 attrs 并按需保留 / 清空 id（其余属性含 rawAttrs 原样保留） */
function attrsWithId(attrs: Attrs, keep: boolean): Attrs {
  return { ...attrs, id: keep ? (attrs.id ?? null) : null };
}

/** 解析「文档序第一个存留片段」中谁保留原 id */
function resolveOwner(
  policy: ReplaceIdOwner,
  hasBefore: boolean,
  hasInner: boolean,
  hasAfter: boolean,
): 'before' | 'inner' | 'after' | 'none' {
  if (policy === 'none') {
    return 'none';
  }
  if (policy === 'inner') {
    return hasInner ? 'inner' : 'none';
  }
  if (hasBefore) return 'before';
  if (hasInner) return 'inner';
  if (hasAfter) return 'after';
  return 'none';
}

/** 取段落类型（schema 未注册时回退原块类型） */
function paragraphTypeOf(state: EditorState, fallback: NodeType): NodeType {
  return state.schema.nodes[NODE_TYPES.PARAGRAPH] ?? fallback;
}

/** 把一组块节点替换进文档（单个 transaction） */
function applyReplacement(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  rangeFrom: number,
  rangeTo: number,
  replacement: readonly PmNode[],
  beforeNode: PmNode | undefined,
): boolean {
  const tr = state.tr;
  tr.replaceRange(rangeFrom, rangeTo, new Slice(Fragment.fromArray([...replacement]), 0, 0));

  // 光标落到容器内首个可编辑位置（容器前可能有前段片段）
  const containerStart = rangeFrom + (beforeNode === undefined ? 0 : beforeNode.nodeSize);
  const innerPos = Math.min(containerStart + 2, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(innerPos)));
  tr.scrollIntoView();

  dispatch?.(tr);
  return true;
}

/** 同一段落内的选区转换 */
function replaceWithinBlock(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  type: NodeType,
  attrs: Attrs | undefined,
  from: number,
  to: number,
  options: Required<Pick<ReplaceContainerOptions, 'dropEmptyFragments' | 'idOwner' | 'normalizeTextblocks'>>,
): boolean {
  const $from = state.selection.$from;
  const block = $from.parent;
  const blockStart = $from.start();
  const blockSize = block.content.size;
  const fromOff = from - blockStart;
  const toOff = to - blockStart;
  if (fromOff < 0 || toOff > blockSize || fromOff > toOff) {
    return false;
  }

  const beforeFragment = block.content.cut(0, fromOff);
  const innerFragment = block.content.cut(fromOff, toOff);
  const afterFragment = block.content.cut(toOff, blockSize);

  const hasBefore = !options.dropEmptyFragments || !isBlankFragment(beforeFragment);
  const hasAfter = !options.dropEmptyFragments || !isBlankFragment(afterFragment);

  const innerType = options.normalizeTextblocks ? paragraphTypeOf(state, block.type) : block.type;

  const owner = resolveOwner(options.idOwner, hasBefore, true, hasAfter);

  const beforeNode = hasBefore
    ? block.type.create(attrsWithId(block.attrs, owner === 'before'), beforeFragment)
    : undefined;
  const innerNode = innerType.create(
    attrsWithId(block.attrs, owner === 'inner'),
    innerFragment,
  );
  const afterNode = hasAfter
    ? block.type.create(attrsWithId(block.attrs, owner === 'after'), afterFragment)
    : undefined;

  let container: PmNode;
  try {
    container = type.createChecked(attrs ?? null, Fragment.from(innerNode));
  } catch {
    return false;
  }

  const replacement: PmNode[] = [];
  if (beforeNode !== undefined) replacement.push(beforeNode);
  replacement.push(container);
  if (afterNode !== undefined) replacement.push(afterNode);

  return applyReplacement(
    state,
    dispatch,
    $from.before($from.depth),
    $from.after($from.depth),
    replacement,
    beforeNode,
  );
}

/** 跨多个同级段落的选区转换 */
function replaceAcrossBlocks(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  type: NodeType,
  attrs: Attrs | undefined,
  from: number,
  to: number,
  options: Required<Pick<ReplaceContainerOptions, 'dropEmptyFragments' | 'idOwner' | 'normalizeTextblocks'>>,
): boolean {
  const selection = state.selection;
  const $from = selection.$from;
  const $to = selection.$to;
  const first = $from.parent;
  const last = $to.parent;
  const firstStart = $from.start();
  const lastStart = $to.start();
  const firstSize = first.content.size;
  const lastSize = last.content.size;
  const fromOff = from - firstStart;
  const toOff = to - lastStart;
  if (fromOff < 0 || fromOff >= firstSize || toOff <= 0 || toOff > lastSize) {
    return false;
  }

  const parent = $from.node($from.depth - 1);
  const parentStart = $from.start($from.depth - 1);

  const beforeFragment = first.content.cut(0, fromOff);
  const firstInnerFragment = first.content.cut(fromOff, firstSize);
  const lastInnerFragment = last.content.cut(0, toOff);
  const afterFragment = last.content.cut(toOff, lastSize);

  const hasBefore = !options.dropEmptyFragments || !isBlankFragment(beforeFragment);
  const hasAfter = !options.dropEmptyFragments || !isBlankFragment(afterFragment);

  const innerType = options.normalizeTextblocks ? paragraphTypeOf(state, first.type) : first.type;

  const firstOwner = resolveOwner(options.idOwner, hasBefore, true, false);
  const lastOwner = resolveOwner(options.idOwner, false, true, hasAfter);

  const beforeNode = hasBefore
    ? first.type.create(attrsWithId(first.attrs, firstOwner === 'before'), beforeFragment)
    : undefined;

  const innerNodes: PmNode[] = [
    innerType.create(attrsWithId(first.attrs, firstOwner === 'inner'), firstInnerFragment),
  ];

  // 中间整块：文本块按需规范化为段落；列表 / 表格等非文本块原样搬入
  const firstBlockEnd = $from.after($from.depth);
  const lastBlockStart = $to.before($to.depth);
  if (lastBlockStart > firstBlockEnd) {
    const middle = parent.content.cut(
      firstBlockEnd - parentStart,
      lastBlockStart - parentStart,
    );
    middle.forEach((node) => {
      if (node.isTextblock && options.normalizeTextblocks) {
        const keepId = options.idOwner !== 'none';
        const normalizedType = state.schema.nodes[NODE_TYPES.PARAGRAPH] ?? node.type;
        innerNodes.push(
          normalizedType.create(attrsWithId(node.attrs, keepId), node.content),
        );
        return;
      }
      innerNodes.push(
        options.idOwner === 'none'
          ? node.type.create(attrsWithId(node.attrs, false), node.content)
          : node,
      );
    });
  }

  innerNodes.push(
    innerType.create(attrsWithId(last.attrs, lastOwner === 'inner'), lastInnerFragment),
  );

  const afterNode = hasAfter
    ? last.type.create(attrsWithId(last.attrs, lastOwner === 'after'), afterFragment)
    : undefined;

  let container: PmNode;
  try {
    container = type.createChecked(attrs ?? null, Fragment.fromArray(innerNodes));
  } catch {
    return false;
  }

  const replacement: PmNode[] = [];
  if (beforeNode !== undefined) replacement.push(beforeNode);
  replacement.push(container);
  if (afterNode !== undefined) replacement.push(afterNode);

  return applyReplacement(
    state,
    dispatch,
    $from.before($from.depth),
    $to.after($to.depth),
    replacement,
    beforeNode,
  );
}

/**
 * 把当前选区转换为容器节点（块级 `block+` / 行内 `inline*`）
 *
 * - 行内目标：委托 {@link insertInlineNodeWrapping}（仅同段选区）；
 * - 块级目标：按选区切分 → 包进容器 → 清理空片段 → 单事务派发；
 * - 空选区：默认退化为「段后插入空容器」（与旧插入命令一致）；
 * - schema 未注册、目标非容器、内容表达式不兼容、跨父容器 / 跨章节选区 → false。
 *
 * @param typeName 目标节点类型名（IR 口径，如 `double-note`）
 * @param attrs 新建容器的属性（缺省取规格默认值）
 * @param options 拆分 / 空段 / id 归属 / 文本块规范化选项
 */
export function replaceSelectionWithContainer(
  typeName: string,
  attrs?: Attrs,
  options: ReplaceContainerOptions = {},
): Command {
  return (state, dispatch, view) => {
    const type = state.schema.nodes[typeName];
    if (type === undefined) {
      return false;
    }

    if (!(state.selection instanceof TextSelection)) {
      return false;
    }

    if (state.selection.empty) {
      if (options.insertWhenEmpty === false) {
        return false;
      }
      return type.isInline
        ? insertInlineNodeWrapping(typeName, attrs)(state, dispatch, view)
        : insertBlockAfterSelection(state.schema, typeName, attrs, true)(state, dispatch, view);
    }

    // 行内容器：只支持同段选区，复用既有实现（跨段返回 false）
    if (type.isInline) {
      return insertInlineNodeWrapping(typeName, attrs)(state, dispatch, view);
    }

    const $from = state.selection.$from;
    const $to = state.selection.$to;
    if (!$from.parent.isTextblock || !$to.parent.isTextblock) {
      return false;
    }
    // 跨父容器 / 跨章节：块的直接父级必须一致，否则拒绝（不产生半成品事务）
    if (
      $from.depth !== $to.depth ||
      $from.node($from.depth - 1) !== $to.node($to.depth - 1)
    ) {
      return false;
    }

    const resolved = {
      dropEmptyFragments: options.dropEmptyFragments !== false,
      idOwner: options.idOwner ?? 'first-surviving',
      normalizeTextblocks: options.normalizeTextblocks !== false,
    } as const;

    const { from, to } = state.selection;
    const sameBlock = $from.parent === $to.parent;
    return sameBlock
      ? replaceWithinBlock(state, dispatch, type, attrs, from, to, resolved)
      : replaceAcrossBlocks(state, dispatch, type, attrs, from, to, resolved);
  };
}
