/**
 * 古籍编辑命令（对应 D8：classical → editor 单向依赖）
 *
 * 复用 @bibliotype/editor 的命令工厂（toggleMarkOfType / insertBlockAfterSelection）：
 * - 行内标记：专名号、书名号、圈点、异体字；
 * - 块插入：双行小注、眉批、校勘记；
 * - 符号插入：出校符号（atom 节点，默认为 ○）。
 * 命令执行期按 IR 类型名从 schema 取节点 / 标记，未注册时返回 false。
 */
import { insertBlockAfterSelection, toggleMarkOfType } from '@bibliotype/editor';
import type { Attrs } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { CLASSICAL_MARK_TYPES, type ClassicalMarkType } from './mark-types.js';
import { CLASSICAL_NODE_TYPES } from './node-types.js';

/* ---------- 行内标记 ---------- */

/** 按古籍标记类型生成切换命令（schema 未注册该标记时不可用） */
function toggleClassicalMark(type: ClassicalMarkType, attrs?: Attrs): Command {
  return (state, dispatch, view) => {
    const markType = state.schema.marks[type];
    if (markType === undefined) {
      return false;
    }
    return toggleMarkOfType(markType, attrs)(state, dispatch, view);
  };
}

/** 切换专名号（人名 / 地名 / 书名等） */
export function toggleProperName(): Command {
  return toggleClassicalMark(CLASSICAL_MARK_TYPES.PROPER_NAME);
}

/** 切换书名号 */
export function toggleBookTitle(): Command {
  return toggleClassicalMark(CLASSICAL_MARK_TYPES.BOOK_TITLE);
}

/** 切换圈点（着重点；style 可选圈 / 点等表现） */
export function toggleCircleEmphasis(style?: string): Command {
  return toggleClassicalMark(
    CLASSICAL_MARK_TYPES.CIRCLE_EMPHASIS,
    style === undefined ? undefined : { style },
  );
}

/** 切换异体字标记 */
export function toggleVariant(): Command {
  return toggleClassicalMark(CLASSICAL_MARK_TYPES.VARIANT);
}

/* ---------- 块插入（注疏 / 眉批 / 校勘记） ---------- */

/** 在当前叶块之后插入双行小注 */
export function insertDoubleNote(): Command {
  return (state, dispatch, view) =>
    insertBlockAfterSelection(state.schema, CLASSICAL_NODE_TYPES.DOUBLE_NOTE)(
      state,
      dispatch,
      view,
    );
}

/** 在当前叶块之后插入眉批 */
export function insertHeadNote(): Command {
  return (state, dispatch, view) =>
    insertBlockAfterSelection(state.schema, CLASSICAL_NODE_TYPES.HEAD_NOTE)(state, dispatch, view);
}

/** 在当前叶块之后插入校勘记 */
export function insertCollationNote(): Command {
  return (state, dispatch, view) =>
    insertBlockAfterSelection(state.schema, CLASSICAL_NODE_TYPES.COLLATION_NOTE)(
      state,
      dispatch,
      view,
    );
}

/* ---------- 符号插入 ---------- */

/** 在光标处插入出校符号（默认 ○，可传 □ / △ 等） */
export function insertCollationSymbol(symbol = '○'): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes[CLASSICAL_NODE_TYPES.COLLATION_MARK];
    if (type === undefined) {
      return false;
    }
    const node = type.create({ symbol });
    dispatch?.(state.tr.replaceSelectionWith(node, false).scrollIntoView());
    return true;
  };
}
