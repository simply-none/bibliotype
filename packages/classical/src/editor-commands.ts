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
import type { Attrs, Node as PmNode } from 'prosemirror-model';
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

/** 扫描现有校勘记编号，返回下一个可用序号（忽略非数字 marker） */
function nextCollationMarker(doc: PmNode): number {
  let maximum = 0;
  doc.descendants((node) => {
    if (node.type.name !== CLASSICAL_NODE_TYPES.COLLATION_NOTE) return true;
    const marker = node.attrs['marker'];
    if (typeof marker === 'number' && Number.isFinite(marker) && marker > maximum) {
      maximum = Math.round(marker);
    }
    return true;
  });
  return maximum + 1;
}

/** 在当前叶块之后插入校勘记（自动取号，编号在文档内唯一递增） */
export function insertCollationNote(): Command {
  return (state, dispatch, view) =>
    insertBlockAfterSelection(state.schema, CLASSICAL_NODE_TYPES.COLLATION_NOTE, {
      marker: nextCollationMarker(state.doc),
    })(state, dispatch, view);
}

/**
 * 按文档顺序重排校勘记编号（1…n）
 *
 * 删除 / 移动校勘记后编号会出现空档，本命令一次性压缩；单事务、可撤销。
 * 已经连续时返回 false（不产生空事务）。
 */
export function renumberCollationNotes(): Command {
  return (state, dispatch) => {
    const targets: Array<{ pos: number; marker: number }> = [];
    let index = 0;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== CLASSICAL_NODE_TYPES.COLLATION_NOTE) return true;
      index += 1;
      if (node.attrs['marker'] !== index) targets.push({ pos, marker: index });
      return true;
    });
    if (targets.length === 0) return false;

    const tr = state.tr;
    for (const target of targets) {
      const node = tr.doc.nodeAt(target.pos);
      if (node === null) continue;
      tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, marker: target.marker });
    }
    dispatch?.(tr);
    return true;
  };
}

/** 在文档中定位带 id 的块 */
function locateBlock(doc: PmNode, id: string): { pos: number; node: PmNode } | undefined {
  let found: { pos: number; node: PmNode } | undefined;
  doc.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (!node.isText && node.attrs['id'] === id) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
}

/** 已用配对 id 集合 */
function collectPairIds(doc: PmNode): Set<string> {
  const used = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === CLASSICAL_NODE_TYPES.COLLATION_MARK) {
      const pairId = node.attrs['pairId'];
      if (typeof pairId === 'string' && pairId !== '') used.add(pairId);
    }
    return true;
  });
  return used;
}

/** 生成确定性配对 id（`pair-1`…，不读时间） */
function nextPairId(doc: PmNode): string {
  const used = collectPairIds(doc);
  let index = used.size + 1;
  while (used.has(`pair-${index}`)) index += 1;
  return `pair-${index}`;
}

/**
 * 绑定底本 / 校本段落
 *
 * 给两个块内的所有 `collation-mark` 写入同一 `pairId`，并分别标 `role`
 * （base / variant）；重复配对时先清除旧配对再写新值。单事务、可撤销。
 *
 * @param baseBlockId 底本段落块 id
 * @param variantBlockId 校本段落块 id
 */
export function pairCollation(baseBlockId: string, variantBlockId: string): Command {
  return (state, dispatch) => {
    if (baseBlockId === variantBlockId) return false;
    const base = locateBlock(state.doc, baseBlockId);
    const variant = locateBlock(state.doc, variantBlockId);
    if (base === undefined || variant === undefined) return false;

    const pairId = nextPairId(state.doc);
    const tr = state.tr;
    let changed = false;

    const assign = (target: { pos: number; node: PmNode }, role: 'base' | 'variant'): void => {
      target.node.descendants((child, offset) => {
        if (child.type.name !== CLASSICAL_NODE_TYPES.COLLATION_MARK) return true;
        tr.setNodeMarkup(target.pos + 1 + offset, undefined, {
          ...child.attrs,
          pairId,
          role,
        });
        changed = true;
        return true;
      });
    };

    assign(base, 'base');
    assign(variant, 'variant');
    if (!changed) return false;
    dispatch?.(tr);
    return true;
  };
}

/** 解除配对（清除该 pairId 上所有标记的配对与角色） */
export function unpairCollation(pairId: string): Command {
  return (state, dispatch) => {
    const trimmed = pairId.trim();
    if (trimmed === '') return false;
    const tr = state.tr;
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== CLASSICAL_NODE_TYPES.COLLATION_MARK) return true;
      if (node.attrs['pairId'] !== trimmed) return true;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, pairId: null, role: null });
      changed = true;
      return true;
    });
    if (!changed) return false;
    dispatch?.(tr);
    return true;
  };
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

/* ---------- 句读 / 专名建议（K3） ---------- */

/** 句读建议的落点（由 `annotation-suggestions` 产出后映射而来） */
export interface JudouSuggestionInput {
  /** 块节点 id */
  blockId: string;
  /** 段内起始偏移（含） */
  start: number;
  /** 段内结束偏移（不含） */
  end: number;
  /** 候选标点 */
  symbol: string;
  /** 建议 id（写入标记，供拒绝 / 逐条落地） */
  suggestionId?: string;
  /** 命中规则 id */
  rule?: string;
  /** 置信度 */
  confidence?: number;
}

/** 专名建议的落点 */
export interface ProperNameSuggestionInput {
  /** 块节点 id */
  blockId: string;
  /** 段内起始偏移（含） */
  start: number;
  /** 段内结束偏移（不含） */
  end: number;
  /** 建议 id */
  suggestionId?: string;
  /** 专名类别（person / place / book …） */
  nameKind?: string;
  /** 置信度 */
  confidence?: number;
}

/** 移除自动建议标记的选项 */
export interface RemoveSuggestionMarksOptions {
  /** 只移除这些建议 id；省略表示全部自动建议 */
  suggestionIds?: readonly string[];
  /** 只移除这些标记类型（缺省句读 + 专名） */
  markTypes?: readonly string[];
}

/** 句读标记落成字符的选项 */
export interface CommitJudouOptions {
  /** 只落地这些建议 id；省略表示全部自动句读标记 */
  suggestionIds?: readonly string[];
}

/**
 * 段内文本偏移 → PM 位置
 *
 * 文本节点按 `node.text.length` 累计；行内原子 / 容器的内部结构不切分，
 * 偏移落在其内部时取该节点之后（避免把标记切进 ruby、注码等结构）。
 *
 * @returns 偏移越界（负数 / 超过块内容长度）时为 `undefined`
 */
function textOffsetToPos(node: PmNode, blockPos: number, offset: number): number | undefined {
  if (!Number.isInteger(offset) || offset < 0) return undefined;
  if (offset === 0) return blockPos + 1;

  let consumed = 0;
  let pos = blockPos + 1;
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    const length = child.isText ? (child.text ?? '').length : child.textContent.length;
    if (offset <= consumed + length) {
      if (child.isText) return pos + (offset - consumed);
      return pos + child.nodeSize;
    }
    consumed += length;
    pos += child.nodeSize;
  }
  return offset === consumed ? blockPos + 1 + node.content.size : undefined;
}

/** 同一条建议的 mark 属性（句读 / 专名共用 source=auto 口径） */
function suggestionMarkAttrs(input: {
  suggestionId?: string;
  confidence?: number;
  extra?: Record<string, string>;
}): Attrs {
  return {
    source: 'auto',
    suggestionId: input.suggestionId ?? null,
    confidence: input.confidence ?? null,
    ...(input.extra ?? {}),
  };
}

/**
 * 批量接受句读建议（单事务，可一次撤销）
 *
 * 标记包裹「候选标点前的字」，渲染层用 `.bt-mark-judou::after` 显示候选符号；
 * 正文字符不变，拒绝时只需移除标记。
 *
 * @returns 有任一建议落点有效时为 `true`
 */
export function applyJudouSuggestions(
  suggestions: readonly JudouSuggestionInput[],
): Command {
  return (state, dispatch) => {
    if (suggestions.length === 0) return false;
    const markType = state.schema.marks[CLASSICAL_MARK_TYPES.JUDOU];
    if (markType === undefined) return false;

    const tr = state.tr;
    let applied = false;
    for (const item of suggestions) {
      const target = locateBlock(state.doc, item.blockId);
      if (target === undefined) continue;
      const from = textOffsetToPos(target.node, target.pos, item.start);
      const to = textOffsetToPos(target.node, target.pos, item.end);
      if (from === undefined || to === undefined || to <= from) continue;
      tr.addMark(
        from,
        to,
        markType.create(
          suggestionMarkAttrs({
            ...(item.suggestionId === undefined ? {} : { suggestionId: item.suggestionId }),
            ...(item.confidence === undefined ? {} : { confidence: item.confidence }),
            extra: {
              symbol: item.symbol,
              ...(item.rule === undefined ? {} : { rule: item.rule }),
            },
          }),
        ),
      );
      applied = true;
    }
    if (!applied) return false;
    dispatch?.(tr);
    return true;
  };
}

/**
 * 批量接受专名建议（写入 `proper-name` 标记）
 *
 * @returns 有任一建议落点有效时为 `true`
 */
export function applyProperNameSuggestions(
  suggestions: readonly ProperNameSuggestionInput[],
): Command {
  return (state, dispatch) => {
    if (suggestions.length === 0) return false;
    const markType = state.schema.marks[CLASSICAL_MARK_TYPES.PROPER_NAME];
    if (markType === undefined) return false;

    const tr = state.tr;
    let applied = false;
    for (const item of suggestions) {
      const target = locateBlock(state.doc, item.blockId);
      if (target === undefined) continue;
      const from = textOffsetToPos(target.node, target.pos, item.start);
      const to = textOffsetToPos(target.node, target.pos, item.end);
      if (from === undefined || to === undefined || to <= from) continue;
      tr.addMark(
        from,
        to,
        markType.create(
          suggestionMarkAttrs({
            ...(item.suggestionId === undefined ? {} : { suggestionId: item.suggestionId }),
            ...(item.confidence === undefined ? {} : { confidence: item.confidence }),
            extra: item.nameKind === undefined ? {} : { nameKind: item.nameKind },
          }),
        ),
      );
      applied = true;
    }
    if (!applied) return false;
    dispatch?.(tr);
    return true;
  };
}

/**
 * 拒绝自动建议：移除 `source=auto` 的句读 / 专名标记
 *
 * 未接受的建议本来就不在文档里，因此「拒绝」是空操作；本命令用于
 * 接受后又反悔，或一次性清空全部自动标记。
 *
 * @returns 实际移除了标记时为 `true`
 */
export function removeSuggestionMarks(
  options: RemoveSuggestionMarksOptions = {},
): Command {
  return (state, dispatch) => {
    const types = new Set(
      options.markTypes ?? [CLASSICAL_MARK_TYPES.JUDOU, CLASSICAL_MARK_TYPES.PROPER_NAME],
    );
    const wanted = options.suggestionIds;
    const tr = state.tr;
    let applied = false;

    state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      for (const mark of node.marks) {
        if (!types.has(mark.type.name)) continue;
        if (mark.attrs['source'] !== 'auto') continue;
        const suggestionId = mark.attrs['suggestionId'];
        if (
          wanted !== undefined &&
          (typeof suggestionId !== 'string' || !wanted.includes(suggestionId))
        ) {
          continue;
        }
        tr.removeMark(pos, pos + node.nodeSize, mark);
        applied = true;
      }
      return true;
    });

    if (!applied) return false;
    dispatch?.(tr);
    return true;
  };
}

/**
 * 采纳为标点：把句读标记落成真实字符
 *
 * 在标记区间之后插入候选标点，并移除标记；从后往前处理，保证多段同时
 * 落地时位置不互相影响。整批在单事务内完成，一次撤销即可回退。
 *
 * @returns 实际插入了字符时为 `true`
 */
export function commitJudouAsText(options: CommitJudouOptions = {}): Command {
  return (state, dispatch) => {
    const markType = state.schema.marks[CLASSICAL_MARK_TYPES.JUDOU];
    if (markType === undefined) return false;
    const wanted = options.suggestionIds;

    const targets: Array<{ from: number; to: number; symbol: string }> = [];
    state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      for (const mark of node.marks) {
        if (mark.type.name !== CLASSICAL_MARK_TYPES.JUDOU) continue;
        if (mark.attrs['source'] !== 'auto') continue;
        const suggestionId = mark.attrs['suggestionId'];
        if (
          wanted !== undefined &&
          (typeof suggestionId !== 'string' || !wanted.includes(suggestionId))
        ) {
          continue;
        }
        const symbol = mark.attrs['symbol'];
        if (typeof symbol !== 'string' || symbol === '') continue;
        targets.push({ from: pos, to: pos + node.nodeSize, symbol });
      }
      return true;
    });
    if (targets.length === 0) return false;

    const tr = state.tr;
    // 从后往前插入：前面的位置不受后续插入影响
    targets.sort((a, b) => b.to - a.to);
    for (const target of targets) {
      tr.removeMark(target.from, target.to, markType);
      tr.insertText(target.symbol, target.to);
      tr.removeMark(target.to, target.to + target.symbol.length, markType);
    }
    dispatch?.(tr);
    return true;
  };
}
