/**
 * 表格单元格合并 / 拆分命令
 *
 * 与 `tableContext`（单列增删 / 表头 / 对齐）同属表格编辑能力，但操作的是单元格的
 * `colspan` / `rowspan`（数据层 `core-node-specs` 已支持，HTML 导入导出已具备）。
 * 本文件只做编辑态的合并 / 拆分，不改变 schema。
 *
 * 实现要点：
 * - 先把表格展开成「网格」（cell → 占据的行列区间），再据此判定选区是否构成矩形；
 * - 非矩形（含单元格跨出选区）或跨表头行冲突 → 返回 false，**不派发事务**，避免
 *   留下「半合并」的中间态；
 * - 合并保留左上格，其余格文本段落按顺序拼接到左上格，空段落跳过；
 * - 拆分按 `colspan` / `rowspan` 还原为独立空单元格（首格保留原内容）。
 */
import { NODE_TYPES } from '@bibliotype/core';
import { Fragment } from 'prosemirror-model';
import type { Attrs, Node as PmNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';

/** 单元格在网格中的占据区间 */
interface CellSpan {
  node: PmNode;
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
}

/** 表格网格展开结果 */
interface TableGrid {
  grid: (PmNode | null)[][];
  meta: Map<PmNode, CellSpan>;
  rowCount: number;
  colCount: number;
}

/** 按 IR 类型名查找节点类型（未注册返回 undefined） */
function findNodeType(schema: Schema, type: string): NodeType | undefined {
  return schema.nodes[type];
}

/** 空单元格工厂（内嵌空段落，每次产出独立实例） */
function emptyCell(schema: Schema): PmNode | null {
  const cell = findNodeType(schema, NODE_TYPES.TABLE_CELL);
  const paragraph = findNodeType(schema, NODE_TYPES.PARAGRAPH);
  if (cell === undefined || paragraph === undefined) return null;
  return cell.create(null, paragraph.create());
}

/** 段落是否为「空」（仅一个空段落） */
function isEmptyParagraph(node: PmNode): boolean {
  if (node.childCount !== 1) return false;
  const child = node.child(0);
  return child.type === findNodeType(node.type.schema, NODE_TYPES.PARAGRAPH) && child.textContent === '';
}

/** 由选区端点定位其所在单元格（cell → row → table 三层校验） */
function cellAt(state: EditorState, $pos: ResolvedPos): PmNode | null {
  const cell = findNodeType(state.schema, NODE_TYPES.TABLE_CELL);
  const row = findNodeType(state.schema, NODE_TYPES.TABLE_ROW);
  const table = findNodeType(state.schema, NODE_TYPES.TABLE);
  if (cell === undefined || row === undefined || table === undefined) return null;
  for (let depth = $pos.depth; depth >= 2; depth -= 1) {
    if (
      $pos.node(depth).type === cell &&
      $pos.node(depth - 1).type === row &&
      $pos.node(depth - 2).type === table
    ) {
      return $pos.node(depth);
    }
  }
  return null;
}

/** 找到包含给定单元格的表格节点与其文档位置 */
function tableOf(state: EditorState, $pos: ResolvedPos): { table: PmNode; tablePos: number } | null {
  const table = findNodeType(state.schema, NODE_TYPES.TABLE);
  if (table === undefined) return null;
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    if ($pos.node(depth).type === table) {
      return { table: $pos.node(depth), tablePos: $pos.before(depth) };
    }
  }
  return null;
}

/** 把表格展开为网格（含跨行 / 跨列覆盖的坐标映射） */
function buildTableGrid(table: PmNode): TableGrid {
  const rows = table.children;
  const rowCount = rows.length;
  let colCount = 0;
  for (const row of rows) {
    let inline = 0;
    for (const cell of row.children) {
      inline += Math.max(1, (cell.attrs?.colspan as number) ?? 1);
    }
    colCount = Math.max(colCount, inline);
  }

  const meta = new Map<PmNode, CellSpan>();
  const rowSpans: number[] = new Array(colCount).fill(0);
  for (let r = 0; r < rowCount; r += 1) {
    const row = rows[r]!;
    let c = 0;
    const nextRowSpans = rowSpans.slice();
    for (const cell of row.children) {
      while (c < colCount && rowSpans[c] > 0) {
        rowSpans[c] -= 1;
        nextRowSpans[c] = Math.max(0, nextRowSpans[c] - 1);
        c += 1;
      }
      const colspan = Math.max(1, (cell.attrs?.colspan as number) ?? 1);
      const rowspan = Math.max(1, (cell.attrs?.rowspan as number) ?? 1);
      meta.set(cell, { node: cell, row: r, col: c, colspan, rowspan });
      for (let cc = 0; cc < colspan; cc += 1) {
        nextRowSpans[c] = Math.max(0, nextRowSpans[c]) + (rowspan - 1);
        c += 1;
      }
    }
    rowSpans.splice(0, colCount, ...nextRowSpans);
  }

  const grid: (PmNode | null)[][] = Array.from({ length: rowCount }, () =>
    new Array<PmNode | null>(colCount).fill(null),
  );
  for (const span of meta.values()) {
    for (let dr = 0; dr < span.rowspan; dr += 1) {
      for (let dc = 0; dc < span.colspan; dc += 1) {
        const rr = span.row + dr;
        const cc = span.col + dc;
        if (rr < rowCount && cc < colCount) grid[rr]![cc] = span.node;
      }
    }
  }
  return { grid, meta, rowCount, colCount };
}

/**
 * 由网格重建表格节点
 *
 * `transform(r, c, original)` 对每个网格位置返回放置的节点，或 `null`（该位置删除）。
 * 重建时按「左上角唯一」规则去重：同一单元格跨列 / 跨行覆盖的其余位置会被自动跳过，
 * 只在跨度的起点发出一次，避免跨列 / 跨行单元格被重复写入。
 */
function rebuildFromGrid(
  table: PmNode,
  transform: (row: number, col: number, original: PmNode) => PmNode | null,
): PmNode | null {
  const rowType = findNodeType(table.type.schema, NODE_TYPES.TABLE_ROW);
  if (rowType === undefined) return null;
  const { grid } = buildTableGrid(table);
  const newRows: PmNode[] = [];
  for (let r = 0; r < table.childCount; r += 1) {
    const row = table.child(r)!;
    const cells: PmNode[] = [];
    for (let c = 0; c < (grid[r]?.length ?? 0); c += 1) {
      const original = grid[r]![c];
      if (original === null) continue;
      const replaced = transform(r, c, original);
      if (replaced === null) continue;
      // 仅当本格是跨度的起点（左 / 上邻居不是同一节点）才落库，避免重复
      const left = c > 0 ? grid[r]![c - 1] : null;
      const top = r > 0 ? grid[r - 1]![c] : null;
      if (left === replaced || top === replaced) continue;
      cells.push(replaced);
    }
    newRows.push(rowType.create(row.attrs, cells));
  }
  return table.type.create(table.attrs, newRows);
}

/** 取选区两个端点的单元格与所在表格；不同表 / 缺表格返回 null */
function resolveMergeEnds(
  state: EditorState,
): { from: PmNode; to: PmNode; table: PmNode; tablePos: number } | null {
  const { $from, $to } = state.selection;
  if ($from.pos === $to.pos) return null;
  const fromCell = cellAt(state, $from);
  const toCell = cellAt(state, $to);
  if (fromCell === null || toCell === null) return null;
  const fromTable = tableOf(state, $from);
  const toTable = tableOf(state, $to);
  if (fromTable === null || toTable === null || fromTable.table !== toTable.table) return null;
  return { from: fromCell, to: toCell, table: fromTable.table, tablePos: fromTable.tablePos };
}

/**
 * 合并选区覆盖的矩形单元格
 *
 * 选区端点须位于同一表格、至少覆盖两个单元格；矩形校验失败或跨表头行冲突时返回
 * false，不改动文档。
 */
export function mergeCells(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const ends = resolveMergeEnds(state);
  if (ends === null) return false;
  const { table, tablePos } = ends;
  const grid = buildTableGrid(table);
  const fromSpan = grid.meta.get(ends.from);
  const toSpan = grid.meta.get(ends.to);
  if (fromSpan === undefined || toSpan === undefined) return false;

  const minR = Math.min(fromSpan.row, toSpan.row);
  const maxR = Math.max(fromSpan.row + fromSpan.rowspan - 1, toSpan.row + toSpan.rowspan - 1);
  const minC = Math.min(fromSpan.col, toSpan.col);
  const maxC = Math.max(fromSpan.col + fromSpan.colspan - 1, toSpan.col + toSpan.colspan - 1);

  // 收集矩形内单元格，并校验每个单元格都完全落在矩形内（否则非矩形）
  const inBox: PmNode[] = [];
  for (const span of grid.meta.values()) {
    const r0 = span.row;
    const c0 = span.col;
    const r1 = span.row + span.rowspan - 1;
    const c1 = span.col + span.colspan - 1;
    const overlaps = r0 <= maxR && r1 >= minR && c0 <= maxC && c1 >= minC;
    if (!overlaps) continue;
    if (r0 < minR || r1 > maxR || c0 < minC || c1 > maxC) return false;
    inBox.push(span.node);
  }
  if (inBox.length <= 1) return false;

  // 跨表头行冲突：盒内行有的为表头、有的不是 → 拒绝
  const headerFlags = new Set<boolean>();
  for (let r = minR; r <= maxR && r < grid.rowCount; r += 1) {
    headerFlags.add(table.child(r)!.attrs?.header === true);
  }
  if (headerFlags.size > 1) return false;

  // 左上格：盒内 row/col 最小者
  let keptSpan = grid.meta.get(inBox[0]!)!;
  for (const cell of inBox) {
    const s = grid.meta.get(cell)!;
    if (s.row < keptSpan.row || (s.row === keptSpan.row && s.col < keptSpan.col)) keptSpan = s;
  }
  const keptCell = keptSpan.node;

  // 合并内容：盒内单元格按行优先拼接，跳过空段落
  let content = Fragment.empty;
  const ordered = [...inBox].sort((a, b) => {
    const sa = grid.meta.get(a)!;
    const sb = grid.meta.get(b)!;
    return sa.row - sb.row || sa.col - sb.col;
  });
  for (const cell of ordered) {
    if (isEmptyParagraph(cell)) continue;
    content = content.append(cell.content);
  }
  if (content.childCount === 0) {
    const empty = emptyCell(state.schema);
    if (empty !== null) content = Fragment.from(empty.child(0));
  }

  const newTable = rebuildFromGrid(table, (r, c, original) => {
    if (original === keptCell) {
      return original.type.create(
        { ...(original.attrs as Attrs), colspan: maxC - minC + 1, rowspan: maxR - minR + 1 },
        content,
      );
    }
    return inBox.includes(original) ? null : original;
  });
  if (newTable === null) return false;

  if (dispatch !== undefined) {
    dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable).scrollIntoView());
  }
  return true;
}

/**
 * 拆分当前光标所在单元格
 *
 * 仅对带 `colspan` / `rowspan` 的合并单元格生效；普通单元格（跨度为 1×1）无法拆分，
 * 返回 false。
 */
export function splitCell(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from } = state.selection;
  const cell = cellAt(state, $from);
  if (cell === null) return false;
  const located = tableOf(state, $from);
  if (located === null) return false;
  const { table, tablePos } = located;
  const grid = buildTableGrid(table);
  const span = grid.meta.get(cell);
  if (span === undefined) return false;
  if (span.colspan <= 1 && span.rowspan <= 1) return false;

  const factory = emptyCell(state.schema);
  if (factory === null) return false;

  const newTable = rebuildFromGrid(table, (r, c, original) => {
    if (original !== cell) return original;
    if (r === span.row && c === span.col) {
      return original.type.create(
        { ...(original.attrs as Attrs), colspan: 1, rowspan: 1 },
        original.content,
      );
    }
    return factory;
  });
  if (newTable === null) return false;

  if (dispatch !== undefined) {
    dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable).scrollIntoView());
  }
  return true;
}
