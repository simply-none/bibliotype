/**
 * 古籍编辑命令（对应 D8：classical → editor 单向依赖）
 *
 * 复用 @bibliotype/editor 的命令工厂（toggleMarkOfType / insertBlockAfterSelection /
 * insertBlockOfType / insertInlineNodeWrapping / insertAtomicNode）：
 * - 行内标记：专名号、书名号、圈点、异体字、注Ref、避讳字；
 * - 行内容器：夹注、异体字载体、避讳字载体（包裹选区或插入空容器）；
 * - 块插入：双行小注、眉批、校勘记、跋文、牌记、题记、版框；
 * - 原子 / 符号插入：鱼尾、印章、出校符号。
 * 命令执行期按 IR 类型名从 schema 取节点 / 标记，未注册时返回 false。
 *
 * 使用口径（供 UI 层写按钮说明时对齐）：
 * - 行内标记（专名号 / 书名号 / 圈点 / 异体 / 注Ref / 避讳）走 `toggleMarkOfType`，
 *   空光标只写 `storedMarks`，下一次输入才继承；
 * - 行内容器（夹注 / 异体载体 / 避讳载体）**仅支持同段选区**，跨段落返回 false；
 * - 块插入（双行注 / 眉批 / 校勘记 / 跋文 / 牌记 / 题记 / 版框）以「当前叶块之后」为落点；
 * - 本包只打语义，**外观一律由 `packages/layout/src/html/book-css.ts` 的 `.bt-*` 类决定**，
 *   新增节点若没有对应样式，插入后虽然存在但看不见。
 */
import {
  insertAtomicNode,
  insertBlockAfterSelection,
  insertBlockOfType,
  insertInlineNodeWrapping,
  replaceSelectionWithContainer,
  toggleMarkOfType,
} from '@bibliotype/editor';
import type { Attrs } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { CLASSICAL_MARK_TYPES, type ClassicalMarkType } from './mark-types.js';
import { CLASSICAL_NODE_TYPES } from './node-types.js';

/* ---------- 行内标记 ---------- */

/**
 * 按古籍标记类型生成切换命令（schema 未注册该标记时不可用）
 *
 * 语义同 `toggleMarkOfType`：选区非空即对选区切换；空光标写 `storedMarks`，
 * 下一次输入才继承 —— UI 侧因此可以把空光标点击视为「设置待输入标记」。
 */
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

/**
 * 切换圈点（着重点）
 *
 * @param style 强调样式，写入 `circle-emphasis.style` 并经序列化器输出为 `data-style`。
 *   可行值（与 book-css 对齐）：circle（缺省）/ open-circle / dot / open-dot /
 *   double-circle / triangle / sesame；传 undefined 则用 spec 默认（null → 渲染为实心圈）。
 */
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

/**
 * 切换注Ref标记
 *
 * @param noteId 指向注文节点的标识；不传时标记的 `noteId` 为 spec 默认（null），
 *   结果是「只有引点、没有锚点」—— 导出时不会生成跳转，需在属性检视器补录。
 */
export function toggleNoteRef(noteId?: string): Command {
  return toggleClassicalMark(
    CLASSICAL_MARK_TYPES.NOTE_REF,
    noteId === undefined ? undefined : { noteId },
  );
}

/** 切换避讳字标记 */
export function toggleTaboo(): Command {
  return toggleClassicalMark(CLASSICAL_MARK_TYPES.TABOO);
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

/** 在当前叶块之后插入跋文 */
export function insertTailNote(): Command {
  return insertBlockOfType(CLASSICAL_NODE_TYPES.TAIL_NOTE);
}

/** 在当前叶块之后插入牌记 */
export function insertImprint(): Command {
  return insertBlockOfType(CLASSICAL_NODE_TYPES.IMPRINT);
}

/** 在当前叶块之后插入题记 */
export function insertColophon(): Command {
  return insertBlockOfType(CLASSICAL_NODE_TYPES.COLOPHON);
}

/** 在当前叶块之后插入版框 */
export function insertBorderFrame(): Command {
  return insertBlockOfType(CLASSICAL_NODE_TYPES.BORDER_FRAME);
}

/* ---------- 选区替换为块级容器（「替换为」） ----------
 *
 * 与上面的「段后插入空容器」相对：这几条命令**消费选区**，把选中文字搬进
 * 目标容器，并按 `replaceSelectionWithContainer` 的规则切分前后段落、清理空段、
 * 保证 id 不重复。空选区时仍退化为「段后插入空容器」，保持旧行为。
 */

/** 将选区转换为双行小注（选中文字进入注文） */
export function replaceWithDoubleNote(): Command {
  return replaceSelectionWithContainer(CLASSICAL_NODE_TYPES.DOUBLE_NOTE);
}

/** 将选区转换为眉批 */
export function replaceWithHeadNote(): Command {
  return replaceSelectionWithContainer(CLASSICAL_NODE_TYPES.HEAD_NOTE);
}

/** 将选区转换为跋文 */
export function replaceWithTailNote(): Command {
  return replaceSelectionWithContainer(CLASSICAL_NODE_TYPES.TAIL_NOTE);
}

/** 将选区转换为校勘记 */
export function replaceWithCollationNote(): Command {
  return replaceSelectionWithContainer(CLASSICAL_NODE_TYPES.COLLATION_NOTE);
}

/** 将选区转换为牌记 */
export function replaceWithImprint(): Command {
  return replaceSelectionWithContainer(CLASSICAL_NODE_TYPES.IMPRINT);
}

/** 将选区转换为题记 */
export function replaceWithColophon(): Command {
  return replaceSelectionWithContainer(CLASSICAL_NODE_TYPES.COLOPHON);
}

/** 将选区转换为版框 */
export function replaceWithBorderFrame(): Command {
  return replaceSelectionWithContainer(CLASSICAL_NODE_TYPES.BORDER_FRAME);
}

/* ---------- 行内容器包裹（夹注 / 异体字 / 避讳字载体） ----------
 *
 * 三者共用 `insertInlineNodeWrapping`，行为一致：
 * - 选区非空 → 把选区内容包进容器（内容用 `Fragment.cut` 取，不能拿 Selection.content()，
 *   那是块级根，会直接抛 `Invalid content`）；
 * - 空光标 → 插入空容器，光标进入容器内部（不是留在容器之后）；
 * - **跨段落选区返回 false**（静默不执行）：单个行内片段无法表达跨块内容。
 */

/** 将选区（或光标处新容器）包裹为夹注 */
export function toggleInlineNote(): Command {
  return insertInlineNodeWrapping(CLASSICAL_NODE_TYPES.INLINE_NOTE);
}

/** 将选区（或光标处新容器）包裹为异体字载体 */
export function toggleVariantChar(): Command {
  return insertInlineNodeWrapping(CLASSICAL_NODE_TYPES.VARIANT_CHAR);
}

/** 将选区（或光标处新容器）包裹为避讳字载体 */
export function toggleTabooChar(): Command {
  return insertInlineNodeWrapping(CLASSICAL_NODE_TYPES.TABOO_CHAR);
}

/* ---------- 原子节点插入（鱼尾 / 印章） ---------- */

/**
 * 在当前叶块之后插入鱼尾（无内容原子块）
 *
 * 第三个参数 `embedParagraph = false` 是必需的：鱼尾的 content 为空，
 * 若按默认值内嵌段落，`createChecked` 会校验失败导致点击无反应。
 */
export function insertFishTail(): Command {
  return insertBlockOfType(CLASSICAL_NODE_TYPES.FISH_TAIL, undefined, false);
}

/**
 * 在光标处插入印章
 *
 * @param text 印文，写入 `seal.text`；缺省「印章」占位。元素本身没有子节点，
 *   可见性完全依赖样式表的 `.bt-seal::after { content: attr(data-text) }` 一类规则。
 */
export function insertSeal(text = '印章'): Command {
  return insertAtomicNode(CLASSICAL_NODE_TYPES.SEAL, { text });
}

/* ---------- 符号插入 ---------- */

/**
 * 在光标处插入出校符号
 *
 * @param symbol 符号字形，写入 `collation-mark.symbol`，序列化为 `data-symbol`；
 *   缺省 ○，其余常用 □ / △ 等按需传入。样式由 `.bt-collation-mark::after` 渲染。
 */
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
