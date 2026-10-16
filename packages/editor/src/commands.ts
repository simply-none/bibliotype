/**
 * 书籍编辑命令工厂（无 DOM）
 *
 * 基于 prosemirror-commands / prosemirror-schema-list / prosemirror-history
 * 封装具备 IR 语义的命令：段落与标题、引用、列表、标记切换、块插入、
 * 节点 / 标记属性修改。
 * 所有命令均为纯函数（Command），由视图层或编辑状态机执行；
 * 节点类型名通过 NODE_TYPES 对齐，schema 未注册对应节点时命令返回 false。
 */
import { MARK_TYPES, NODE_TYPES } from '@bibliotype/core';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { Attrs, Mark, MarkType, Node as PmNode, NodeType, Schema } from 'prosemirror-model';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import {
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
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

/** 按 IR 标记类型名切换标记（schema 未注册时不可用）；
 * requireSelection 为 true 时空选区不执行（避免工具条按钮误清空待输入标记） */
export function toggleMarkByName(
  markName: string,
  attrs?: Attrs,
  requireSelection = false,
): Command {
  return (state, dispatch, view) => {
    if (requireSelection && state.selection.empty) {
      return false;
    }
    const markType = state.schema.marks[markName];
    if (markType === undefined) {
      return false;
    }
    return toggleMarkOfType(markType, attrs)(state, dispatch, view);
  };
}

/* ---------- 链接 ---------- */

/**
 * 为选区设置 / 更新链接（link 标记携 href）
 *
 * - 选区非空：整段应用链接标记（已有实例则替换 href）；
 * - 空选区：光标处存在待输入链接标记时更新其 href，否则不可用；
 * - schema 未注册 link 标记或 href 为空串时返回 false。
 */
export function setLink(href: string): Command {
  return (state, dispatch) => {
    const type = state.schema.marks[MARK_TYPES.LINK];
    if (type === undefined || href === '') {
      return false;
    }
    const { from, to, empty } = state.selection;
    if (empty) {
      const $cursor =
        state.selection instanceof TextSelection ? state.selection.$cursor : null;
      const stored: readonly Mark[] =
        state.storedMarks ?? ($cursor !== null ? $cursor.marks() : []);
      const mark = type.isInSet(stored);
      if (mark === undefined) {
        return false;
      }
      dispatch?.(state.tr.setStoredMarks(stored.map((m) => (m === mark ? type.create({ href }) : m))));
      return true;
    }
    dispatch?.(state.tr.addMark(from, to, type.create({ href })).scrollIntoView());
    return true;
  };
}

/** 移除选区 / 光标 storedMarks 中的链接 */
export function unsetLink(): Command {
  return (state, dispatch) => {
    const type = state.schema.marks[MARK_TYPES.LINK];
    if (type === undefined) {
      return false;
    }
    const { from, to, empty } = state.selection;
    if (empty) {
      const $cursor =
        state.selection instanceof TextSelection ? state.selection.$cursor : null;
      const stored: readonly Mark[] =
        state.storedMarks ?? ($cursor !== null ? $cursor.marks() : []);
      if (type.isInSet(stored) === undefined) {
        return false;
      }
      dispatch?.(state.tr.setStoredMarks(stored.filter((m) => m.type !== type)));
      return true;
    }
    dispatch?.(state.tr.removeMark(from, to, type));
    return true;
  };
}

/* ---------- 段落与块级 ---------- */

/**
 * 切换选中文本块的类型，但显式保留每个块的 `id`。
 *
 * 背景：prosemirror-commands 的 `setBlockType` 以 `type.create(attrsHere, null, marks)`
 * 重建节点，且 `prosemirror-model@1.25` 的 `hasMarkup` 不再对 `attrs == null` 短路，
 * 导致即便「已是该类型」也会重写、`id` 被整体归默认 —— 表现为工具栏「正文 / H1 / H2 / H3」
 * 每次点击都把块的 `id` 清空（`packages/editor/src/commands.ts` R2）。此处改用
 * `tr.setNodeMarkup` 并为每个块合并 `{ ...原 attrs, ...patch }`，从而保留 `id` 与 `rawAttrs`。
 *
 * 跨文本块选区会逐块处理，分别保留各自 `id`；与原生 `setBlockType` 不同，本函数不会把
 * 单一 `attrs` 套用到所有块。
 */
function setBlockTypeKeepingId(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  nodeType: NodeType,
  patch: Attrs = {},
): boolean {
  const { from, to } = state.selection;
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) {
      return true; // 继续向块内下钻
    }
    if (!node.type.compatibleContent(nodeType)) {
      return false; // 目标类型不兼容，跳过该块
    }
    const merged = { ...node.attrs, ...patch };
    if (node.hasMarkup(nodeType, merged)) {
      return false; // 已是目标类型且属性一致，无需改写
    }
    tr.setNodeMarkup(pos, nodeType, merged);
    changed = true;
    return false; // 不再下钻文本块内部
  });
  if (changed) {
    dispatch?.(tr.scrollIntoView());
    return true;
  }
  return false;
}

/** 将当前块设为标题（level 1~6；schema 未注册 heading 时不可用） */
export function setHeadingLevel(level: number): Command {
  return (state, dispatch) => {
    const heading = findNodeType(state.schema, NODE_TYPES.HEADING);
    if (heading === undefined) {
      return false;
    }
    return setBlockTypeKeepingId(state, dispatch, heading, { level });
  };
}

/** 将当前块设为正文段落 */
export function setParagraph(): Command {
  return (state, dispatch) => {
    const paragraph = findNodeType(state.schema, NODE_TYPES.PARAGRAPH);
    if (paragraph === undefined) {
      return false;
    }
    return setBlockTypeKeepingId(state, dispatch, paragraph);
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

/** 切换列表（包裹 / 退出 / 有序无序互转）：选区位于列表内时，类型一致则提升退出，
 * 否则切换 ordered 属性；列表外包裹目标类型列表 */
function toggleList(ordered: boolean): Command {
  return (state, dispatch, view) => {
    const list = findNodeType(state.schema, NODE_TYPES.LIST);
    const listItem = findNodeType(state.schema, NODE_TYPES.LIST_ITEM);
    if (list === undefined || listItem === undefined) {
      return false;
    }
    if (selectionInsideNode(state, list)) {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type === list) {
          if (Boolean(node.attrs.ordered) === ordered) {
            return liftListItem(listItem)(state, dispatch, view);
          }
          dispatch?.(state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...node.attrs,
            ordered,
          }).scrollIntoView());
          return true;
        }
      }
    }
    return wrapInList(list, { ordered } as Attrs)(state, dispatch, view);
  };
}

/** 切换无序列表 */
export function toggleBulletList(): Command {
  return toggleList(false);
}

/** 切换有序列表 */
export function toggleOrderedList(): Command {
  return toggleList(true);
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
 * - embedParagraph 为 true（默认）时显式内嵌一个空段落（适用于 content: 'block+' 类容器）；
 *   置 false 适用于无内容原子块（如鱼尾），仅校验规格后直接插入；
 * - 插入后光标进入新块内首个可编辑位置；
 * - 供古籍注疏节点（双行小注 / 眉批 / 校勘记）等命令复用。
 */
export function insertBlockAfterSelection(
  schema: Schema,
  typeName: string,
  attrs?: Attrs,
  embedParagraph = true,
): Command {
  return (state, dispatch) => {
    const type = findNodeType(schema, typeName);
    if (type === undefined) {
      return false;
    }
    const paragraph = embedParagraph ? findNodeType(schema, NODE_TYPES.PARAGRAPH) : null;
    if (embedParagraph && paragraph === null) {
      return false;
    }

    const { $to } = state.selection;
    if ($to.depth === 0) {
      return false;
    }
    const insertPos = $to.after($to.depth);
    const block = embedParagraph
      ? type.createChecked(attrs ?? null, paragraph!.create())
      : type.createChecked(attrs ?? null);
    if (block === null) {
      return false;
    }
    const transaction = state.tr.insert(insertPos, block);
    if (embedParagraph) {
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertPos + 1)));
    }
    dispatch?.(transaction.scrollIntoView());
    return true;
  };
}

/** 在当前叶块之后插入块容器（取当前状态 schema，免调用方传参） */
export function insertBlockOfType(typeName: string, attrs?: Attrs, embedParagraph = true): Command {
  return (state, dispatch, view) =>
    insertBlockAfterSelection(state.schema, typeName, attrs, embedParagraph)(
      state,
      dispatch,
      view,
    );
}

/* ---------- 结构容器插入 ---------- */

/** 结构 / 书页类节点名（插入时作为定位“结构层”的判据） */
export const STRUCTURE_BLOCK_TYPE_NAMES: readonly string[] = [
  NODE_TYPES.COVER,
  NODE_TYPES.TITLE_PAGE,
  NODE_TYPES.COPYRIGHT_PAGE,
  NODE_TYPES.BACK_COVER,
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
  NODE_TYPES.TOC,
];

/**
 * 在最近的「结构层」祖先之后插入同级结构容器（章后加章不嵌套）
 *
 * - 沿祖先链自内向外首个结构类节点（卷 / 章 / 节 / 封面等）之后插入；
 * - 无结构祖先（光标直接在书根的块层）时，在当前叶块之后插入；
 * - 新容器内嵌空段落，光标进入其内。
 */
export function insertStructureBlock(typeName: string, attrs?: Attrs): Command {
  return (state, dispatch) => {
    const type = findNodeType(state.schema, typeName);
    const paragraph = findNodeType(state.schema, NODE_TYPES.PARAGRAPH);
    if (type === undefined || paragraph === undefined) {
      return false;
    }
    const { $from } = state.selection;
    let targetDepth = 0;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if (STRUCTURE_BLOCK_TYPE_NAMES.includes($from.node(depth).type.name)) {
        targetDepth = depth;
        break;
      }
    }
    if (targetDepth === 0) {
      if ($from.depth === 0) {
        return false;
      }
      targetDepth = $from.depth;
    }
    const block = type.create(attrs ?? null, paragraph.create());
    const insertPos = $from.after(targetDepth);
    const tr = state.tr.insert(insertPos, block);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/* ---------- 行内容器 / 原子节点插入 ---------- */

/**
 * 用行内容器节点包裹选区（如夹注 / 异体字 / 避讳字载体）
 *
 * - 选区非空：取选区内行内容包裹进节点（含块级内容时 createChecked 校验失败返回 false）；
 * - 空选区：插入空容器并将光标置于其内。
 */
export function insertInlineNodeWrapping(typeName: string, attrs?: Attrs): Command {
  return (state, dispatch) => {
    const type = findNodeType(state.schema, typeName);
    if (type === undefined) {
      return false;
    }
    const { from, to, empty } = state.selection;
    if (empty) {
      const node = type.createChecked(attrs ?? null);
      if (node === null) {
        return false;
      }
      const tr = state.tr.replaceRangeWith(from, to, node);
      const inside = tr.doc.resolve(from + 1);
      tr.setSelection(TextSelection.between(inside, inside));
      dispatch?.(tr.scrollIntoView());
      return true;
    }
    const $from = state.selection.$from;
    const $to = state.selection.$to;
    // 跨块选区无法用单一行内 Fragment 表达（其根会是块级祖先），显式放弃，
    // 避免 `type.createChecked(...)` 吞入块级切片而抛 `Invalid content` 异常
    // （选中文字点击夹注 / 异体载体 / 避讳载体「完全无反应」的根因，R1）。
    if ($from.parent !== $to.parent) {
      return false;
    }
    const start = $from.start();
    const inner = $from.parent.content.cut(from - start, to - start);
    const node = type.createChecked(attrs ?? null, inner);
    if (node === null) {
      return false;
    }
    const tr = state.tr.replaceRangeWith(from, to, node);
    // 把光标移入新包裹节点内部（与空选区分支一致），否则光标落在夹注之后
    const inside = tr.doc.resolve(from + 1);
    tr.setSelection(TextSelection.between(inside, inside));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 在光标 / 选区处插入原子节点（图片 / 公式 / 印章 / 鱼尾等，内容由 attrs 承载） */
export function insertAtomicNode(typeName: string, attrs?: Attrs): Command {
  return (state, dispatch) => {
    const type = findNodeType(state.schema, typeName);
    if (type === undefined) {
      return false;
    }
    const node = type.createChecked(attrs ?? null);
    if (node === null) {
      return false;
    }
    dispatch?.(state.tr.replaceSelectionWith(node, false).scrollIntoView());
    return true;
  };
}

/* ---------- 常用内容插入（在通用插入工厂上预置属性与光标行为） ---------- */

/** 在光标 / 选区处插入图片（src 缺省用占位图；alt 为替代文） */
export function insertImage(attrs: { src?: string; alt?: string } = {}): Command {
  return insertAtomicNode(NODE_TYPES.IMAGE, {
    src: attrs.src ?? 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    alt: attrs.alt ?? '',
  });
}

/** 在当前叶块之后插入代码块（language 缺省纯文本），光标进入块内 */
export function insertCodeBlock(language?: string): Command {
  return (state, dispatch) => {
    const type = findNodeType(state.schema, NODE_TYPES.CODE_BLOCK);
    if (type === undefined) {
      return false;
    }
    const { $to } = state.selection;
    if ($to.depth === 0) {
      return false;
    }
    const block = type.create(language === undefined ? null : { language });
    const insertPos = $to.after($to.depth);
    const tr = state.tr.insert(insertPos, block);
    // 空 textblock 用 near 前探落位（between 会停在块前的块层）
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/* ---------- 表格（简化模型：无跨行 / 跨列） ---------- */

/** 表格上下文（选区位于单元格时产出） */
interface TableContext {
  table: PmNode;
  tablePos: number;
  row: PmNode;
  rowPos: number;
  rowIndex: number;
  columnIndex: number;
}

/** 从选区定位表格上下文（cell → row → table 祖先前两两校验） */
function tableContext(state: EditorState): TableContext | null {
  const table = findNodeType(state.schema, NODE_TYPES.TABLE);
  const row = findNodeType(state.schema, NODE_TYPES.TABLE_ROW);
  const cell = findNodeType(state.schema, NODE_TYPES.TABLE_CELL);
  if (table === undefined || row === undefined || cell === undefined) {
    return null;
  }
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 2; depth -= 1) {
    if (
      $from.node(depth).type === cell &&
      $from.node(depth - 1).type === row &&
      $from.node(depth - 2).type === table
    ) {
      const tableNode = $from.node(depth - 2);
      return {
        table: tableNode,
        tablePos: $from.before(depth - 2),
        row: $from.node(depth - 1),
        rowPos: $from.before(depth - 1),
        rowIndex: $from.index(depth - 2),
        columnIndex: $from.index(depth - 1),
      };
    }
  }
  return null;
}

/** 新建空单元格工厂（内嵌空段落，每次调用产出独立实例） */
function emptyCellFactory(schema: Schema): (() => PmNode) | null {
  const cell = findNodeType(schema, NODE_TYPES.TABLE_CELL);
  const paragraph = findNodeType(schema, NODE_TYPES.PARAGRAPH);
  if (cell === undefined || paragraph === undefined) {
    return null;
  }
  return () => cell.create(null, paragraph.create());
}

/** 在当前叶块之后插入表格（默认 3×3，无跨格简化模型） */
export function insertTable(rows = 3, columns = 3): Command {
  return (state, dispatch) => {
    const schema = state.schema;
    const table = findNodeType(schema, NODE_TYPES.TABLE);
    const rowType = findNodeType(schema, NODE_TYPES.TABLE_ROW);
    if (table === undefined || rowType === undefined) {
      return false;
    }
    const createCell = emptyCellFactory(schema);
    if (createCell === null) {
      return false;
    }
    const safeRows = Math.max(1, Math.round(rows));
    const safeColumns = Math.max(1, Math.round(columns));
    const node = table.create(
      null,
      Array.from({ length: safeRows }, () =>
        rowType.create(null, Array.from({ length: safeColumns }, createCell)),
      ),
    );
    const { $to } = state.selection;
    if ($to.depth === 0) {
      return false;
    }
    const insertPos = $to.after($to.depth);
    dispatch?.(state.tr.insert(insertPos, node).scrollIntoView());
    return true;
  };
}

/** 在当前行之后追加同列数的新行 */
export function tableAddRow(): Command {
  return (state, dispatch) => {
    const ctx = tableContext(state);
    const rowType = findNodeType(state.schema, NODE_TYPES.TABLE_ROW);
    if (ctx === null || rowType === undefined) {
      return false;
    }
    const createCell = emptyCellFactory(state.schema);
    if (createCell === null) {
      return false;
    }
    const newRow = rowType.create(
      null,
      Array.from({ length: ctx.row.childCount }, createCell),
    );
    dispatch?.(state.tr.insert(ctx.rowPos + ctx.row.nodeSize, newRow).scrollIntoView());
    return true;
  };
}

/** 在当前列之后追加同位的新列（逐行插入，经事务映射保持位置正确） */
export function tableAddColumn(): Command {
  return (state, dispatch) => {
    const ctx = tableContext(state);
    if (ctx === null) {
      return false;
    }
    const createCell = emptyCellFactory(state.schema);
    if (createCell === null) {
      return false;
    }
    const tr = state.tr;
    let rowOffset = 1;
    ctx.table.forEach((row) => {
      let inside = 1;
      for (let index = 0; index < ctx.columnIndex && index < row.childCount; index += 1) {
        inside += row.child(index).nodeSize;
      }
      tr.insert(tr.mapping.map(ctx.tablePos + rowOffset + inside), createCell());
      rowOffset += row.nodeSize;
    });
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 删除当前行（末行时删除整个表格） */
export function tableDeleteRow(): Command {
  return (state, dispatch) => {
    const ctx = tableContext(state);
    if (ctx === null) {
      return false;
    }
    const tr = state.tr;
    if (ctx.table.childCount <= 1) {
      tr.delete(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize);
    } else {
      tr.delete(ctx.rowPos, ctx.rowPos + ctx.row.nodeSize);
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 删除当前列（末列时删除整个表格；自下而上删除保持前方位置有效） */
export function tableDeleteColumn(): Command {
  return (state, dispatch) => {
    const ctx = tableContext(state);
    if (ctx === null) {
      return false;
    }
    if (ctx.row.childCount <= 1) {
      dispatch?.(state.tr.delete(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize).scrollIntoView());
      return true;
    }
    const tr = state.tr;
    const offsets: number[] = [];
    let rowOffset = 1;
    ctx.table.forEach((row) => {
      offsets.push(rowOffset);
      rowOffset += row.nodeSize;
    });
    for (let index = offsets.length - 1; index >= 0; index -= 1) {
      const row = ctx.table.child(index);
      if (ctx.columnIndex >= row.childCount) {
        continue;
      }
      let inside = 1;
      for (let cellIndex = 0; cellIndex < ctx.columnIndex; cellIndex += 1) {
        inside += row.child(cellIndex).nodeSize;
      }
      const cellPos = ctx.tablePos + offsets[index]! + inside;
      tr.delete(cellPos, cellPos + row.child(ctx.columnIndex).nodeSize);
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
