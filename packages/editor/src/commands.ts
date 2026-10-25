/**
 * 书籍编辑命令工厂（无 DOM）
 *
 * 基于 prosemirror-commands / prosemirror-schema-list / prosemirror-history
 * 封装具备 IR 语义的命令：段落与标题、引用、列表、标记切换、块插入、
 * 节点 / 标记属性修改。
 * 所有命令均为纯函数（Command），由视图层或编辑状态机执行；
 * 节点类型名通过 NODE_TYPES 对齐，schema 未注册对应节点时命令返回 false。
 */
import {
  MARK_TYPES,
  NODE_TYPES,
  NOTE_LABEL_STYLES,
  formatNoteLabel,
  isNoteNodeType,
  type NoteLabelStyle,
} from '@bibliotype/core';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { Fragment } from 'prosemirror-model';
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

/**
 * 切换行内标记（attrs 缺省取标记规格默认值）
 *
 * - 选区非空：对区间整体加 / 去该标记；
 * - 空光标：只写 `storedMarks`（不改动已有文字），下一次输入才继承 ——
 *   因此「B / I / U / 高亮 / 注音 / 古籍标记」这类按钮在空光标下也可点；
 * - 需要「必须先选中文字」语义时用 {@link toggleMarkByName} 的 `requireSelection`。
 *
 * @param markType 目标标记类型（由调用方从 schema 取得）
 * @param attrs 标记属性（如 link.href / ruby.text），缺省取 spec 默认值
 */
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

/**
 * 切换索引词标注
 *
 * - 非空选区：以选中文本为缺省 `term`，已有同词条标记时取消、否则写入；
 * - 空选区 / 选中文本为空 / 未指定 term：返回 false（索引词必须可落到非空条目）。
 *
 * `sortKey` 缺省为 null，采集时回退到 `term`；需要拼音 / 笔画序时用
 * `setMarkAttrs(MARK_TYPES.INDEX_TERM, { sortKey })` 手工指定。
 */
export function toggleIndexTerm(term?: string): Command {
  return (state, dispatch) => {
    const type = state.schema.marks[MARK_TYPES.INDEX_TERM];
    if (type === undefined) return false;
    const { from, to, empty } = state.selection;
    if (empty || from === to) return false;

    const selected = state.doc.textBetween(from, to, ' ').trim();
    const value = (term ?? selected).trim();
    if (value === '') return false;

    /* 选区起点可能落在文本前缘（resolve().marks() 为空），故扫描整段文本判断 */
    let hasSameTerm = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return true;
      if (node.marks.some((mark) => mark.type === type && mark.attrs['term'] === value)) {
        hasSameTerm = true;
        return false;
      }
      return true;
    });

    if (dispatch !== undefined) {
      const tr = state.tr.removeMark(from, to, type);
      if (!hasSameTerm) {
        tr.addMark(from, to, type.create({ term: value, sortKey: null }));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/* ---------- 命名样式（Word 式 styleId） ---------- */

/**
 * 可挂命名样式的块类型
 *
 * 只对「承载文本的块」有意义：容器（卷 / 章）与原子块（图片 / 分页符）挂样式
 * 没有实际排版效果，反而让 attrs 变脏。
 */
const STYLEABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'quote',
  'list-item',
  'caption',
  'math-block',
  'double-note',
  'head-note',
  'tail-note',
  'collation-note',
  'imprint',
  'colophon',
  'border-frame',
]);

/**
 * 给光标所在块挂 / 清命名样式
 *
 * `styleId` 写入 `rawAttrs` 兜底容器（不是 schema 正式属性）：
 * - 导入器（docx / epub / markdown）不认识它，写成正式属性会破坏 IR 无损往返；
 * - 序列化器把非白名单属性输出为 `data-style-id`，命名样式的 CSS 规则据此命中。
 *
 * @param styleId 样式 id；传 null 表示移除
 */
export function setBlockStyleId(styleId: string | null): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (!STYLEABLE_BLOCK_TYPES.has(node.type.name)) continue;
      const attrs = mergeAttrsPatch(node.attrs, node.type.spec.attrs, { styleId });
      dispatch?.(state.tr.setNodeMarkup($from.before(depth), undefined, attrs));
      return true;
    }
    return false;
  };
}

/* ---------- 行款规则（直排 v2 批 3：低格 / 抬头 / 提行） ---------- */

/** 行款命令的目标块类型（正文段落与引文；标题 / 版式块不参与连排行款） */
const LINE_RULE_TARGET_TYPES: ReadonlySet<string> = new Set(['paragraph', 'quote']);

/**
 * 从选区向上找最近的行款目标块
 *
 * @returns 块前置位置与节点；未命中返回 null
 */
function findLineRuleTarget(state: { selection: { $from: { depth: number; node(depth: number): PmNode; before(depth: number): number } } }): {
  pos: number;
  node: PmNode;
} | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!LINE_RULE_TARGET_TYPES.has(node.type.name)) continue;
    return { pos: $from.before(depth), node };
  }
  return null;
}

/**
 * 设置低格（直排 = 列首空 N 字位起写，横排 = 首行缩进 N 字）
 *
 * @param n 字位数（0~4；传 null / 0 清除）
 */
export function setLineIndent(n: number | null): Command {
  return (state, dispatch) => {
    const target = findLineRuleTarget(state);
    if (target === null) return false;
    const value = typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.min(4, Math.round(n)) : null;
    const attrs = mergeAttrsPatch(target.node.attrs, target.node.type.spec.attrs, { indent: value });
    dispatch?.(state.tr.setNodeMarkup(target.pos, undefined, attrs));
    return true;
  };
}

/**
 * 设置抬头形式（古籍敬语格式）
 *
 * @param lift `'space'` 空抬 / 挪抬（行内空一字）、`'newline'` 平抬（提行顶格）、
 *   `'none'` 清除
 * @param level 单 / 双 / 三 / 四抬（提行高出 N 字，1~4；仅 newline 生效，缺省 1）
 */
export function setLift(lift: 'none' | 'space' | 'newline', level = 1): Command {
  return (state, dispatch) => {
    const target = findLineRuleTarget(state);
    if (target === null) return false;
    const levelValue = lift === 'newline' ? Math.min(4, Math.max(1, Math.round(level))) : null;
    const attrs = mergeAttrsPatch(target.node.attrs, target.node.type.spec.attrs, {
      lift: lift === 'none' ? null : lift,
      liftLevel: levelValue,
    });
    dispatch?.(state.tr.setNodeMarkup(target.pos, undefined, attrs));
    return true;
  };
}

/** 切换提行另起（本段另起一列，区别于另起页的分页符） */
export function toggleBreakLine(): Command {
  return (state, dispatch) => {
    const target = findLineRuleTarget(state);
    if (target === null) return false;
    const next = target.node.attrs['breakLine'] === true ? null : true;
    const attrs = mergeAttrsPatch(target.node.attrs, target.node.type.spec.attrs, {
      breakLine: next,
    });
    dispatch?.(state.tr.setNodeMarkup(target.pos, undefined, attrs));
    return true;
  };
}

/**
 * 批量套用命名样式
 *
 * 行为：
 * - 空选区 → 只作用于光标所在的可样式块；
 * - 非空选区 → 作用于选区内所有可样式文本块（段落 / 标题 / 引文等）；
 * - 单事务、可撤销；全部目标已是该样式时返回 false（不产生空事务）。
 *
 * `styleId` 仍写入 `rawAttrs`，不写 schema 正式属性（保持导入无损往返）。
 */
export function applyNamedStyle(styleId: string): Command {
  return (state, dispatch) => {
    const id = styleId.trim();
    if (id === '') return false;

    const { from, to, empty, $from } = state.selection;
    const targets: { pos: number; node: PmNode }[] = [];
    if (empty) {
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (!STYLEABLE_BLOCK_TYPES.has(node.type.name)) continue;
        targets.push({ pos: $from.before(depth), node });
        break;
      }
    } else {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        if (STYLEABLE_BLOCK_TYPES.has(node.type.name)) targets.push({ pos, node });
        return false;
      });
    }
    if (targets.length === 0) return false;

    const tr = state.tr;
    let changed = false;
    for (const { pos, node } of targets) {
      const raw = node.attrs[RAW_ATTRS_ATTR];
      const current =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>).styleId
          : undefined;
      if (current === id) continue;
      tr.setNodeMarkup(
        pos,
        undefined,
        mergeAttrsPatch(node.attrs, node.type.spec.attrs, { styleId: id }),
      );
      changed = true;
    }
    if (!changed) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * 清除选区格式
 *
 * 同时移除：
 * - 行内 marks（强调 / 链接 / 注音 / 高亮等）；
 * - 可样式块的命名样式 `styleId`。
 *
 * 保留块结构、节点 id 与块级 attrs（对齐 / 角色等），单事务、可撤销；
 * 空选区或无任何可清除内容时返回 false。
 */
export function clearFormat(): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;

    const targets: { pos: number; node: PmNode }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (STYLEABLE_BLOCK_TYPES.has(node.type.name)) targets.push({ pos, node });
      return false;
    });

    const tr = state.tr.removeMark(from, to);
    let changed = tr.docChanged;
    for (const { pos, node } of targets) {
      const raw = node.attrs[RAW_ATTRS_ATTR];
      const styleId =
        typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>).styleId
          : undefined;
      if (typeof styleId !== 'string' || styleId === '') continue;
      tr.setNodeMarkup(
        pos,
        undefined,
        mergeAttrsPatch(node.attrs, node.type.spec.attrs, { styleId: null }),
      );
      changed = true;
    }
    if (!changed) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 读光标所在块的命名样式 id（无则 null） */
export function getBlockStyleId(state: EditorState): string | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!STYLEABLE_BLOCK_TYPES.has(node.type.name)) continue;
    const raw = node.attrs[RAW_ATTRS_ATTR];
    if (typeof raw === 'object' && raw !== null) {
      const value = (raw as Record<string, unknown>).styleId;
      return typeof value === 'string' ? value : null;
    }
    return null;
  }
  return null;
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

/**
 * 在当前叶块之后插入块容器（取当前状态 schema，免调用方传参）
 *
 * 是 {@link insertBlockAfterSelection} 的 `Command` 形态封装，行为完全一致：
 * - `embedParagraph` 保持默认 true 时给容器内嵌空段落，光标随即进入其内；
 * - **无内容原子块**（如鱼尾 `fish-tail`）必须传 false，否则 `createChecked`
 *   会因「多出段落子节点」而不满足 content 表达式 —— 表现为点了没反应。
 */
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

/**
 * 在光标 / 选区处插入原子节点（图片 / 印章等，内容全部由 attrs 承载）
 *
 * - 与 {@link insertBlockAfterSelection} 的区别：本函数**就地替换选区**，
 *   不把光标移入新块，适合行内或零尺寸的原位原子；
 * - 节点无子节点（印章的印文在 `seal.text`、图片地址在 `image.src`），
 *   因此「看得见」完全依赖样式表（如 `book-css.ts` 的 `.bt-seal::after`）；
 * - schema 未注册该节点、或 `createChecked` 校验失败（属性非法）时返回 false。
 */
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

/** 图片占位地址（1×1 透明 GIF，避免空 src 导出死链） */
export const PLACEHOLDER_IMAGE_SRC =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * 在光标 / 选区处插入图片
 *
 * - `src` 缺省为 1×1 透明 GIF 的 data URI 占位，避免空 src 在导出时产出死链；
 * - `alt` 缺省空串（无障碍 / 导出 alt），插入后由属性栏补；
 * - 不打包媒体：外链地址在 EPUB 导出中原样输出，本地文件需由导入侧内联。
 */
export function insertImage(attrs: { src?: string; alt?: string } = {}): Command {
  return insertAtomicNode(NODE_TYPES.IMAGE, {
    src: attrs.src ?? PLACEHOLDER_IMAGE_SRC,
    alt: attrs.alt ?? '',
  });
}

/** 插入公式块（KaTeX / MathML 源码存于 `attrs.tex`，渲染由上层决定） */
export function insertMathBlock(tex = ''): Command {
  return insertBlockOfType(NODE_TYPES.MATH_BLOCK, { tex }, false);
}

/** 在光标 / 选区处插入行内公式（`attrs.tex`） */
export function insertMathInline(tex = ''): Command {
  return insertAtomicNode(NODE_TYPES.MATH_INLINE, { tex });
}

/**
 * 注音（ruby）：给选中文字加注音，或插入带注音的新文字
 *
 * - 选区非空且未给 `text`：对选区加 `ruby` 标记（注文存 `mark.attrs.text`）；
 * - 给定 `text`：用 `text` 替换选区（空选区即插入）并带上 ruby 标记；
 * - 空选区且未给 `text`：无内容可注音，返回 false。
 */
export function insertRuby(reading: string, text?: string): Command {
  return (state, dispatch) => {
    const rubyType = state.schema.marks[MARK_TYPES.RUBY];
    if (rubyType === undefined) {
      return false;
    }
    const mark = rubyType.create({ text: reading });
    const { from, to, empty } = state.selection;
    if (text === undefined && empty) {
      return false;
    }
    const tr = state.tr;
    if (text === undefined) {
      tr.addMark(from, to, mark);
    } else {
      tr.replaceWith(from, to, state.schema.text(text, [mark]));
      tr.setSelection(TextSelection.create(tr.doc, from + text.length));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 图组插入选项 */
export interface FigureOptions {
  /** 图片地址（缺省透明占位） */
  src?: string;
  /** 替代文本 */
  alt?: string;
  /** 图注文字（缺省空图注，光标进入图注等待输入） */
  caption?: string;
}

/**
 * 在当前叶块之后插入「图片 + 图注」块组
 *
 * 图注是独立的 `caption` 块（便于导出时生成 `<figcaption>`），光标落入图注内。
 */
export function insertFigure(options: FigureOptions = {}): Command {
  return (state, dispatch) => {
    const imageType = findNodeType(state.schema, NODE_TYPES.IMAGE);
    const captionType = findNodeType(state.schema, NODE_TYPES.CAPTION);
    if (imageType === undefined || captionType === undefined) {
      return false;
    }
    const { $to } = state.selection;
    if ($to.depth === 0) {
      return false;
    }
    const image = imageType.create({
      src: options.src ?? PLACEHOLDER_IMAGE_SRC,
      alt: options.alt ?? '',
    });
    const captionText = options.caption ?? '';
    const caption = captionType.create(
      null,
      captionText === '' ? null : state.schema.text(captionText),
    );
    const insertPos = $to.after($to.depth);
    const tr = state.tr.insert(insertPos, Fragment.fromArray([image, caption]));
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + image.nodeSize + 1)));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 分隔线变体值：`break(variant='hr')` */
export const HORIZONTAL_RULE_VARIANT = 'hr';

/**
 * 在当前叶块之后插入分隔线（`break(variant='hr')`）
 *
 * 分隔线是独立块；位于末块时补一个空段落承接光标，否则光标落到后继块首。
 */
export function insertHorizontalRule(): Command {
  return (state, dispatch) => {
    const breakType = findNodeType(state.schema, NODE_TYPES.BREAK);
    const paragraphType = findNodeType(state.schema, NODE_TYPES.PARAGRAPH);
    if (breakType === undefined || paragraphType === undefined) {
      return false;
    }
    const { $to } = state.selection;
    if ($to.depth === 0) {
      return false;
    }
    const hr = breakType.create({ variant: HORIZONTAL_RULE_VARIANT });
    const insertPos = $to.after($to.depth);
    const tr = state.tr.insert(insertPos, hr);
    if (tr.doc.resolve(insertPos + hr.nodeSize).nodeAfter === null) {
      tr.insert(insertPos + hr.nodeSize, paragraphType.create());
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + hr.nodeSize + 1), 1));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
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

/* ---------- 注释（脚注 / 尾注 / 边注） ---------- */

/** 插入注释选项 */
export interface InsertNoteOptions {
  /** 注文（缺省空段落，光标进入注文内等待输入） */
  text?: string;
  /** 显示注码（缺省按文档内同类注释数量自动编号） */
  marker?: string;
  /** 自动编号的注码样式（`arabic` / `circled` / `chinese`，缺省阿拉伯数字） */
  labelStyle?: NoteLabelStyle;
  /**
   * 是否同时在正文插入上标注引用（缺省 `true`）
   *
   * 引用与注释块靠 `targetId` / `refId` 成对关联，导出为
   * `<a epub:type="noteref" href="#note-…">` 与注文末的回跳链接。
   * 光标不在文本块内（如选中图片块）时自动跳过引用，只插注释块。
   */
  withRef?: boolean;
}

/** 收集文档内已用的节点 id（生成注释 / 引用锚点前查重） */
function collectUsedIds(doc: PmNode): Set<string> {
  const used = new Set<string>();
  doc.descendants((node) => {
    const id = node.attrs['id'];
    if (typeof id === 'string' && id !== '') used.add(id);
    return true;
  });
  return used;
}

/** 取一个未被占用的 id（冲突时追加 `-2`、`-3`…） */
function uniqueId(used: Set<string>, base: string): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  const id = `${base}-${suffix}`;
  used.add(id);
  return id;
}

/** 统计文档内指定类型的注释块数量（自动编号用） */
function countNoteBlocks(doc: PmNode, typeName: string): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name !== typeName) return true;
    count += 1;
    return false; // 注释内不再嵌套注释
  });
  return count;
}

/** 统计正文中已有的注引用数量 */
function countNoteRefs(doc: PmNode, markName: string): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) count += 1;
    return true;
  });
  return count;
}

/** 目标注释块的显示注码（找不到返回 undefined） */
function markerOfNote(doc: PmNode, noteId: string): string | undefined {
  let marker: string | undefined;
  doc.descendants((node) => {
    if (marker !== undefined) return false;
    if (node.attrs['id'] !== noteId) return true;
    const raw = node.attrs['marker'];
    if (typeof raw === 'string' && raw !== '') marker = raw;
    return false;
  });
  return marker;
}

/**
 * 在当前叶块之后插入注释块（脚注 / 尾注 / 边注通用）
 *
 * - 位置：紧随光标所在块之后，读者一眼能看到注文，导出侧再按 `epub:type`
 *   把它区分为页底注 / 尾注 / 旁栏；
 * - 编号：按文档内**同类现存注释数量**自动递增（脚注与尾注各自独立编号），
 *   显式传 `marker` 则尊重作者手写注码；
 * - 引用：缺省在光标处写入上标注引用（`noteref` 标记），正文与注文靠
 *   `targetId` / `refId` 双向跳转；`withRef: false` 可只插注文；
 * - 光标落入注文段落内，插入后可直接输入；
 * - `typeName` 不是注释节点、schema 未注册该节点或段落节点时返回 false。
 */
export function insertNote(typeName: string, options: InsertNoteOptions = {}): Command {
  return (state, dispatch) => {
    if (!isNoteNodeType(typeName)) return false;
    const type = findNodeType(state.schema, typeName);
    const paragraph = findNodeType(state.schema, NODE_TYPES.PARAGRAPH);
    if (type === undefined || paragraph === undefined) return false;

    const { $to } = state.selection;
    if ($to.depth === 0) return false;

    const index = countNoteBlocks(state.doc, typeName) + 1;
    const marker =
      options.marker ?? formatNoteLabel(index, options.labelStyle ?? NOTE_LABEL_STYLES.ARABIC);
    const used = collectUsedIds(state.doc);
    const noteId = uniqueId(used, `note-${typeName}-${index}`);
    const refId = uniqueId(used, `ref-${typeName}-${index}`);

    const refMarkType = state.schema.marks[MARK_TYPES.NOTE_REF];
    /* 引用只在「光标位于文本块内且标记已注册」时成立；否则注文不写 refId，
       避免导出时出现指向不存在锚点的回跳链接 */
    const withRef =
      options.withRef !== false && refMarkType !== undefined && $to.parent.isTextblock;

    const text = options.text ?? '';
    const content = paragraph.create(null, text === '' ? null : state.schema.text(text));
    const note = type.createChecked(
      withRef ? { marker, id: noteId, refId } : { marker, id: noteId },
      content,
    );

    /* 光标正在注文内时，新注释插在该注释之后：注释不嵌套，否则注文里出现注文 */
    let blockPos = $to.after($to.depth);
    for (let depth = $to.depth; depth > 0; depth -= 1) {
      if (isNoteNodeType($to.node(depth).type.name)) {
        blockPos = $to.after(depth);
        break;
      }
    }

    const tr = state.tr;
    if (withRef) {
      const refText = state.schema.text(
        marker,
        [refMarkType!.create({ targetId: noteId, refId })],
      );
      /* 用 insert 而非 replaceSelectionWith：后者在空选区会按光标处 marks 重写
         文本的 marks，把刚建的 noteref 标记冲掉（实测） */
      tr.insert(state.selection.empty ? state.selection.from : $to.pos, refText);
    }

    const insertPos = tr.mapping.map(blockPos);
    tr.insert(insertPos, note);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 单独插入注引用（正文上标 → 已有注释块）选项 */
export interface InsertNoteRefOptions {
  /** 目标注释块 id（`attrs.id`） */
  targetId: string;
  /** 显示注码（缺省取目标注释块的 `attrs.marker`，再缺省按已有引用数推导） */
  marker?: string;
  /** 回跳锚点 id（缺省按已有引用数生成 `ref-<n>`） */
  refId?: string;
}

/**
 * 在光标处插入指向已有注释块的上标注引用
 *
 * 适用于「注文已存在、正文后来才补引用」的修订场景（{@link insertNote} 是
 * 注释与引用一起插入）。选区非空时插在选区末尾，不替换已选文字；
 * 光标不在文本块内、schema 未注册 `noteref` 标记时返回 false。
 */
export function insertNoteRef(options: InsertNoteRefOptions): Command {
  return (state, dispatch) => {
    const markType = state.schema.marks[MARK_TYPES.NOTE_REF];
    if (markType === undefined) return false;
    const { $to } = state.selection;
    if (!$to.parent.isTextblock) return false;

    const used = collectUsedIds(state.doc);
    const marker =
      options.marker ??
      markerOfNote(state.doc, options.targetId) ??
      formatNoteLabel(countNoteRefs(state.doc, MARK_TYPES.NOTE_REF) + 1);
    const refId =
      options.refId ?? uniqueId(used, `ref-${countNoteRefs(state.doc, MARK_TYPES.NOTE_REF) + 1}`);

    const refText = state.schema.text(
      marker,
      [markType.create({ targetId: options.targetId, refId })],
    );
    const tr = state.tr;
    tr.insert(state.selection.empty ? state.selection.from : $to.pos, refText);
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** 插入脚注（页底注语义，导出为 `epub:type="footnote"`） */
export function insertFootnote(options: InsertNoteOptions = {}): Command {
  return insertNote(NODE_TYPES.FOOTNOTE, options);
}

/** 插入尾注（篇末 / 书末注语义，导出为 `epub:type="endnote"`） */
export function insertEndnote(options: InsertNoteOptions = {}): Command {
  return insertNote(NODE_TYPES.ENDNOTE, options);
}

/** 插入边注（版心外侧旁注语义，导出为 `epub:type="sidebar"`） */
export function insertMarginNote(options: InsertNoteOptions = {}): Command {
  return insertNote(NODE_TYPES.MARGIN_NOTE, options);
}

/* ---------- 分页符（「下一页」） ---------- */

/** 分页符变体值：`break(variant='page')`，reader.extractBlocks 据此给本块置 breakAfter */
export const PAGE_BREAK_VARIANT = 'page';

/**
 * 在光标处插入分页符并另起一页（「下一页」）
 *
 * 断页能力由文档模型承载：插入 `break(variant='page')`，reader.extractBlocks 给该
 * 叶块置 `breakAfter`，layout.paginate 于是强使其后的块从新页页首起排——页是
 * 固定框、正文如水流动，本命令只在流上打一个「此处断页」的标记。
 *
 * 落点三种（光标始终落到新页的第一个可编辑位置）：
 * - **段中 / 段尾**：按光标把所在块一分为二（与回车同逻辑），前半留本页、后半起
 *   新页，光标落在后半段段首（Word「下一页」同语义，不额外产生空块）；
 * - **段首**：分页符插在该块之前，整块移到新页，光标仍在该块段首（不留空块）；
 * - **不在文本块内**（选中原子块 / 块层空位）：退化为「当前块之后插分页符 + 空段落」，
 *   光标进入该空段落。
 *
 * 横排 / 直排行为一致：主轴方向与页边界由分页内核按书写方向处理，本命令不感知
 * 方向。分页符自身按实测 / 估算照常入账（编辑器里渲染为分隔标记，见样式表
 * `.bt-break[data-variant='page']`），不强制零尺寸，保证量尺与渲染同源。
 * schema 未注册 break / paragraph，或光标位于文档根（depth=0）时返回 false。
 */
export function insertPageBreak(): Command {
  return insertBreakOfVariant(PAGE_BREAK_VARIANT);
}

/** 分栏符变体值：`break(variant='column')`，渲染侧据此 `break-before: column` */
export const COLUMN_BREAK_VARIANT = 'column';

/** 插入指定变体的 break 节点（分页 / 分栏共用同一套切分逻辑） */
function insertBreakOfVariant(variant: string): Command {
  return (state, dispatch) => {
    const breakType = findNodeType(state.schema, NODE_TYPES.BREAK);
    const paragraph = findNodeType(state.schema, NODE_TYPES.PARAGRAPH);
    if (breakType === undefined || paragraph === undefined) {
      return false;
    }
    const { $from, $to } = state.selection;
    if ($from.depth === 0) {
      return false;
    }
    const brk = breakType.createChecked({ variant });
    if (brk === null) {
      return false;
    }
    const tr = state.tr;
    // split 默认 depth=1：只断开光标所在的文本块，祖先容器（卷 / 章 / 节）原样保留
    const blockStart = $from.before($from.depth);
    const cursor = $from.pos;
    if ($from.parent.isTextblock && cursor > blockStart + 1) {
      // 段中 / 段尾：[前半][分页符][后半]，光标进后半段首（后半为空段 = 光标在原段尾）
      tr.split(cursor);
      const gap = cursor + 1;
      tr.insert(gap, brk);
      tr.setSelection(TextSelection.near(tr.doc.resolve(gap + brk.nodeSize + 1), 1));
    } else if ($from.parent.isTextblock) {
      // 段首：[分页符][整块]，整块换页，光标留在块首（不产生多余空块）
      tr.insert(blockStart, brk);
      tr.setSelection(TextSelection.near(tr.doc.resolve(blockStart + brk.nodeSize + 1), 1));
    } else {
      // 光标不在文本块内（原子块选区 / 块层空位）：段后插「分页符 + 空段落」承接光标
      const para = paragraph.createChecked();
      if (para === null) {
        return false;
      }
      const insertPos = $to.after($to.depth);
      tr.insert(insertPos, Fragment.fromArray([brk, para]));
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + brk.nodeSize + 1), 1));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * 插入分栏符
 *
 * 单栏文档降级为普通分隔标记：渲染侧只有多栏正文流才把它解释为
 * `break-before: column`（见 book-css 的 `.bt-break[data-variant='column']`）。
 */
export function insertColumnBreak(): Command {
  return insertBreakOfVariant(COLUMN_BREAK_VARIANT);
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

/**
 * 在当前叶块之后插入表格（默认 3×3）
 *
 * - 简化模型：无跨行 / 跨列 / 表头属性，每个单元格内嵌一个空段落；
 * - 行 / 列数经 `Math.max(1, Math.round(n))` 兜底，非法值不会产出空表；
 * - 光标位于文档根层（`$to.depth === 0`）时无处安放，返回 false。
 */
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

/**
 * 在当前行之后追加同列数的新行
 *
 * 前提：光标必须位于表格单元格内（`tableContext` 逐层校验 cell → row → table），
 * 否则返回 false —— 表格外的按钮点击不会有任何反应。
 */
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

/**
 * 在当前列之后追加同位的新列（逐行插入，经事务映射保持位置正确）
 *
 * 前提同 {@link tableAddRow}：光标须位于单元格内，否则返回 false。
 * 逐行插入时每行位置按 `tr.mapping` 前推，故列数不一致的畸形表格也不会错位。
 */
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

/**
 * 删除当前行（末行时删除整个表格）
 *
 * 前提：光标位于单元格内，否则返回 false。删到只剩一行时删除整表，
 * 避免留下 content 不合法的空表格。
 */
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

/** 单元格对齐取值（null = 清除，回到样式表默认） */
export type TableCellAlign = 'left' | 'center' | 'right';

/**
 * 切换当前行的表头语义
 *
 * 表头是**行级**属性（`table-row.header`）：置位后导出为 `<thead>` + `<th>`，
 * 阅读态加粗 / 底色，并在 HTML 导入时被识别。光标须位于单元格内。
 */
export function toggleTableHeaderRow(): Command {
  return (state, dispatch) => {
    const ctx = tableContext(state);
    if (ctx === null) {
      return false;
    }
    const header = ctx.row.attrs['header'] === true;
    dispatch?.(
      state.tr
        .setNodeMarkup(ctx.rowPos, undefined, { ...ctx.row.attrs, header: !header })
        .scrollIntoView(),
    );
    return true;
  };
}

/**
 * 设置单元格对齐（`table-cell.align`）
 *
 * 作用对象为选区端点所在的单元格（光标即所在格；跨格选区取首尾两格）。
 * 导出为 `data-align`，样式表按 `.bt-table-cell[data-align=...]` 渲染；
 * 传 null 清除对齐回到样式表默认。不在表格内返回 false。
 */
export function setTableCellAlign(align: TableCellAlign | null): Command {
  return (state, dispatch) => {
    const cellType = findNodeType(state.schema, NODE_TYPES.TABLE_CELL);
    if (cellType === undefined) {
      return false;
    }
    const cells = new Map<number, PmNode>();
    const collect = ($pos: EditorState['selection']['$from']): void => {
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if ($pos.node(depth).type === cellType) {
          cells.set($pos.before(depth), $pos.node(depth));
          return;
        }
      }
    };
    collect(state.selection.$from);
    if (!state.selection.empty) {
      collect(state.selection.$to);
    }
    if (cells.size === 0) {
      return false;
    }
    const tr = state.tr;
    for (const [pos, cell] of cells) {
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * 删除当前列（末列时删除整个表格；自下而上删除保持前方位置有效）
 *
 * 前提：光标位于单元格内，否则返回 false。
 * 若某些行的列数少于当前列索引，该行直接跳过（畸形表格容错）。
 */
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

/* ---------- A6：页眉 / 页脚 / 条件内容 ---------- */

/**
 * 在书根写入唯一的页眉 / 页脚（已存在则把光标移入，不重复插入）
 *
 * 页眉页脚必须是 book 的直接子节点，故不走 `insertBlockOfType`（会在当前块后插入，
 * 可能落进章内而触发结构校验错误）。页眉插到书首、页脚追加到书末。
 */
function ensureBookChrome(typeName: string, atStart: boolean): Command {
  return (state, dispatch) => {
    const type = findNodeType(state.schema, typeName);
    const paragraph = findNodeType(state.schema, NODE_TYPES.PARAGRAPH);
    if (type === undefined || paragraph === undefined) {
      return false;
    }

    let existingPos = -1;
    state.doc.forEach((child, offset) => {
      if (child.type === type) existingPos = offset;
    });
    if (existingPos >= 0) {
      if (dispatch !== undefined) {
        dispatch(
          state.tr
            .setSelection(TextSelection.near(state.tr.doc.resolve(existingPos + 1), 1))
            .scrollIntoView(),
        );
      }
      return true;
    }

    const node = type.createChecked(null, paragraph.createChecked());
    if (dispatch !== undefined) {
      const pos = atStart ? 0 : state.doc.content.size;
      dispatch(state.tr.insert(pos, node).scrollIntoView());
    }
    return true;
  };
}

/** 插入（或定位到）书级页眉 */
export function insertPageHeader(): Command {
  return ensureBookChrome(NODE_TYPES.PAGE_HEADER, true);
}

/** 插入（或定位到）书级页脚 */
export function insertPageFooter(): Command {
  return ensureBookChrome(NODE_TYPES.PAGE_FOOTER, false);
}

/**
 * 用条件容器包裹当前选区 / 所在块
 *
 * @param when 条件表达式（缺省空串 = 无条件，便于先插入再改属性）
 */
export function insertCondition(when = ''): Command {
  return (state, dispatch, view) => {
    const type = findNodeType(state.schema, NODE_TYPES.CONDITION);
    if (type === undefined) {
      return false;
    }
    return wrapIn(type, { when })(state, dispatch, view);
  };
}
