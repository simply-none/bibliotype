/**
 * 书籍编辑命令工厂（无 DOM）
 *
 * 基于 prosemirror-commands / prosemirror-schema-list / prosemirror-history
 * 封装具备 IR 语义的命令：段落与标题、引用、列表、标记切换、块插入。
 * 所有命令均为纯函数（Command），由视图层或编辑状态机执行；
 * 节点类型名通过 NODE_TYPES 对齐，schema 未注册对应节点时命令返回 false。
 */
import { NODE_TYPES } from '@bibliotype/core';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { Attrs, MarkType, NodeType, Schema } from 'prosemirror-model';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

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
