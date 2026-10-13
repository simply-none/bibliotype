/**
 * 书籍编辑命令工厂（无 DOM）
 *
 * 基于 prosemirror-commands / prosemirror-schema-list / prosemirror-history
 * 封装具备 IR 语义的命令：段落与标题、引用、列表、标记切换、块插入、
 * 节点 / 标记属性修改。
 * 所有命令均为纯函数（Command），由视图层或编辑状态机执行；
 * 节点类型名通过 NODE_TYPES 对齐，schema 未注册对应节点时命令返回 false。
 */
import { NODE_TYPES } from '@bibliotype/core';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { Attrs, Mark, MarkType, NodeType, Schema } from 'prosemirror-model';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { RAW_ATTRS_ATTR, declaredAttrNames } from './attr-mapper.js';

/* ---------- 历史 ---------- */

export {
  redo as redoCommand,
  redoDepth,
  undo as undoCommand,
  undoDepth,
} from 'prosemirror-history';

/* ---------- 内部工具 ---------- */

/** 按 IR 类型名查找节点类型（未注册返回 undefined） */
function findNodeType(schema: Schema, type: string): NodeType | undefined {
  return schema.nodes[type];
}

/** 选区是否位于指定类型节点内（沿祖先链检查，不含 doc 本身） */
function selectionInsideNode(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === type) {
      return true;
    }
  }
  return false;
}

/* ---------- 行内标记 ---------- */

/** 切换行内标记（attrs 缺省取标记规格默认值） */
export function toggleMarkOfType(markType: MarkType, attrs?: Attrs): Command {
  return toggleMark(markType, attrs);
}

/* ---------- 段落与块级 ---------- */

/** 将当前块设为标题（level 1~6；schema 未注册 heading 时不可用） */
export function setHeadingLevel(level: number): Command {
  return (state, dispatch, view) => {
    const heading = findNodeType(state.schema, NODE_TYPES.HEADING);
    if (heading === undefined) {
      return false;
    }
    return setBlockType(heading, { level })(state, dispatch, view);
  };
}

/** 将当前块设为正文段落 */
export function setParagraph(): Command {
  return (state, dispatch, view) => {
    const paragraph = findNodeType(state.schema, NODE_TYPES.PARAGRAPH);
    if (paragraph === undefined) {
      return false;
    }
    return setBlockType(paragraph)(state, dispatch, view);
  };
}

/** 切换引用块：选区位于引用内则提升（lift），否则包裹（wrapIn） */
export function toggleQuote(): Command {
  return (state, dispatch, view) => {
    const quote = findNodeType(state.schema, NODE_TYPES.QUOTE);
    if (quote === undefined) {
      return false;
    }
    if (selectionInsideNode(state, quote)) {
      return lift(state, dispatch, view);
    }
    return wrapIn(quote)(state, dispatch, view);
  };
}

/** 切换无序列表：选区位于列表内则提升列表项（退出列表），否则包裹为列表 */
export function toggleBulletList(): Command {
  return (state, dispatch, view) => {
    const list = findNodeType(state.schema, NODE_TYPES.LIST);
    const listItem = findNodeType(state.schema, NODE_TYPES.LIST_ITEM);
    if (list === undefined || listItem === undefined) {
      return false;
    }
    if (selectionInsideNode(state, list)) {
      return liftListItem(listItem)(state, dispatch, view);
    }
    return wrapInList(list)(state, dispatch, view);
  };
}

/* ---------- 属性合并（IR 语义 patch → PM attrs） ---------- */

/**
 * 将 IR 语义的属性补丁合并进 PM attrs 对象
 *
 * - spec 显式声明的键：直接写入；值为 null / undefined 时重置为 spec 默认值；
 * - 未声明的键：并入 / 移出 rawAttrs 兜底容器（保持 IR 无损往返约定）；
 * - 保留键 id 与 rawAttrs 不可经补丁修改（id 为 IR 顶层标识，rawAttrs 由本函数维护）。
 */
function mergeAttrsPatch(
  current: Record<string, unknown>,
  specAttrs: Record<string, unknown> | null | undefined,
  patch: Attrs,
): Record<string, unknown> {
  const declared = new Set(declaredAttrNames(specAttrs));
  const next: Record<string, unknown> = { ...current };
  const currentRaw = next[RAW_ATTRS_ATTR];
  const raw: Record<string, unknown> =
    typeof currentRaw === 'object' && currentRaw !== null
      ? { ...(currentRaw as Record<string, unknown>) }
      : {};
  let rawTouched = false;

  for (const [key, value] of Object.entries(patch)) {
    if (key === RAW_ATTRS_ATTR || key === 'id') {
      continue; // 保留键不经属性命令修改
    }
    const cleared = value === null || value === undefined;
    if (declared.has(key)) {
      const attrSpec = (specAttrs ?? {})[key] as { default?: unknown } | undefined;
      next[key] = cleared ? attrSpec?.default ?? null : value;
    } else {
      rawTouched = true;
      if (cleared) {
        delete raw[key];
      } else {
        raw[key] = value;
      }
    }
  }

  if (rawTouched) {
    next[RAW_ATTRS_ATTR] = Object.keys(raw).length > 0 ? raw : null;
  }
  return next;
}

/* ---------- 节点属性 ---------- */

/**
 * 修改选区祖先链中最近的目标节点属性（属性检视器地基）
 *
 * - patch 为 IR 语义属性（与 getDocument 的 attrs 同构）；
 * - 沿祖先链自内向外找到首个目标类型节点后合并属性（内容不变）；
 * - schema 未注册该节点类型、或选区不在该类型节点内时返回 false。
 */
export function setNodeAttrs(typeName: string, patch: Attrs): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes[typeName];
    if (type === undefined) {
      return false;
    }
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type === type) {
        const node = $from.node(depth);
        const attrs = mergeAttrsPatch(node.attrs, type.spec.attrs, patch);
        dispatch?.(state.tr.setNodeMarkup($from.before(depth), undefined, attrs));
        return true;
      }
    }
    return false;
  };
}

/* ---------- 标记属性 ---------- */

/**
 * 修改选区内目标标记实例的属性（属性检视器地基）
 *
 * - 选区非空：对区间内每个携带该标记的文本段逐一合并（addMark 替换同类型实例）；
 * - 选区为空：光标处存在待输入标记（storedMarks / marks）时更新其属性；
 * - schema 未注册该标记、或选区 / 光标处无该标记实例时返回 false。
 */
export function setMarkAttrs(markName: string, patch: Attrs): Command {
  return (state, dispatch) => {
    const type = state.schema.marks[markName];
    if (type === undefined) {
      return false;
    }
    const { from, to, empty } = state.selection;
    const $cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null;

    if (empty) {
      const stored: readonly Mark[] = state.storedMarks ?? ($cursor !== null ? $cursor.marks() : []);
      const mark = type.isInSet(stored);
      if (mark === undefined) {
        return false;
      }
      const attrs = mergeAttrsPatch(mark.attrs, type.spec.attrs, patch);
      const nextMarks: Mark[] = stored.map((m) => (m === mark ? type.create(attrs) : m));
      dispatch?.(state.tr.setStoredMarks(nextMarks));
      return true;
    }

    const ranges: Array<{ from: number; to: number; mark: Mark }> = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) {
        return true;
      }
      const mark = type.isInSet(node.marks);
      if (mark !== undefined) {
        ranges.push({ from: pos, to: pos + node.nodeSize, mark });
      }
      return false;
    });
    if (ranges.length === 0) {
      return false;
    }

    const tr = state.tr;
    for (const range of ranges) {
      const attrs = mergeAttrsPatch(range.mark.attrs, type.spec.attrs, patch);
      tr.addMark(range.from, range.to, type.create(attrs));
    }
    dispatch?.(tr);
    return true;
  };
}

/* ---------- 块插入（注疏 / 眉批 / 校勘记等复用） ---------- */

/**
 * 在当前叶块之后插入块节点
 *
 * - 新块显式内嵌一个空段落（适用于 content: 'block+' 类容器）；
 * - 插入后光标进入新块内首个可编辑位置；
 * - 供古籍注疏节点（双行小注 / 眉批 / 校勘记）等命令复用。
 */
export function insertBlockAfterSelection(
  schema: Schema,
  typeName: string,
  attrs?: Attrs,
): Command {
  return (state, dispatch) => {
    const type = findNodeType(schema, typeName);
    const paragraph = findNodeType(schema, NODE_TYPES.PARAGRAPH);
    if (type === undefined || paragraph === undefined) {
      return false;
    }

    const { $to } = state.selection;
    if ($to.depth === 0) {
      return false;
    }
    const insertPos = $to.after($to.depth);
    const block = type.create(attrs, paragraph.create());
    const transaction = state.tr.insert(insertPos, block);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertPos + 1)));
    dispatch?.(transaction.scrollIntoView());
    return true;
  };
}
