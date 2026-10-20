/**
 * Markdown 复合块解析（列表 / 表格）
 *
 * 从 `markdown.ts` 抽出的块级纯函数，避免主解析器继续膨胀。只负责「识别边界 +
 * 组装 PM 节点」，行内解析与段落构造由调用方通过 `MarkdownBlockContext` 注入，
 * 从而复用同一份脚注上下文（引用编号保持连续）。
 *
 * 设计约束：
 * - 纯函数、无 DOM、确定性；
 * - 列表递归深度上限 8，超限降级为普通段落，避免恶意缩进导致栈溢出；
 * - 表格列数取表头列数，数据行缺列补空、多列截断，保证 PM 严格树可创建。
 */
import { NODE_TYPES } from '@bibliotype/core';
import type { Node as PmNode, Schema } from 'prosemirror-model';

/** 块解析依赖：行内解析与段落构造（由 markdown.ts 绑定脚注上下文） */
export interface MarkdownBlockContext {
  /** 编辑器 schema */
  schema: Schema;
  /** 造一个段落（空串也返回空段落，保证 list-item / table-cell 有合法内容） */
  paragraph(text: string): PmNode | undefined;
  /** 行内解析（表格单元格 / 图注） */
  inline(text: string): readonly PmNode[];
}

/** 列表项行：前导缩进 + 标记 + 内容 */
const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d+\.)[ \t]+(.*)$/;

/** 列表最大递归深度 */
const MAX_LIST_DEPTH = 8;

/** tab 视作 4 个空格（缩进宽度计算） */
const TAB_WIDTH = 4;

/** 缩进宽度（tab 展开为 4） */
function indentWidth(prefix: string): number {
  let width = 0;
  for (const ch of prefix) {
    width += ch === '\t' ? TAB_WIDTH : 1;
  }
  return width;
}

/** 是否有序标记（`1.`） */
function isOrderedMarker(marker: string): boolean {
  return /^\d+\.$/.test(marker);
}

/** 去掉指定宽度的前导缩进（不足则全去） */
function stripIndent(line: string, width: number): string {
  let remaining = width;
  let index = 0;
  while (index < line.length && remaining > 0) {
    const ch = line[index]!;
    if (ch === ' ') {
      remaining -= 1;
      index += 1;
      continue;
    }
    if (ch === '\t') {
      remaining -= TAB_WIDTH;
      index += 1;
      continue;
    }
    break;
  }
  return line.slice(index);
}

/** 行的前导空白宽度 */
function leadingIndent(line: string): number {
  return indentWidth(/^[ \t]*/.exec(line)?.[0] ?? '');
}

interface ListParse {
  node?: PmNode;
  next: number;
}

/**
 * 解析一个列表块（含嵌套）
 *
 * 返回 `next` 为列表结束后的行号；无法识别时返回 `undefined`。
 */
export function parseListBlock(
  lines: readonly string[],
  start: number,
  ctx: MarkdownBlockContext,
): { node: PmNode; next: number } | undefined {
  const first = LIST_ITEM_RE.exec(lines[start] ?? '');
  if (first === null) return undefined;
  const baseIndent = indentWidth(first[1] ?? '');
  const ordered = isOrderedMarker(first[2] ?? '');
  const parsed = parseListAt(lines, start, baseIndent, ordered, ctx, 0);
  if (parsed.node === undefined) return undefined;
  return { node: parsed.node, next: parsed.next };
}

/** 递归解析同层列表（子列表由更深缩进触发） */
function parseListAt(
  lines: readonly string[],
  start: number,
  baseIndent: number,
  ordered: boolean,
  ctx: MarkdownBlockContext,
  depth: number,
): ListParse {
  const listType = ctx.schema.nodes[NODE_TYPES.LIST];
  const itemType = ctx.schema.nodes[NODE_TYPES.LIST_ITEM];
  if (listType === undefined || itemType === undefined || depth > MAX_LIST_DEPTH) {
    return { next: start };
  }

  const items: PmNode[] = [];
  let idx = start;

  while (idx < lines.length) {
    const match = LIST_ITEM_RE.exec(lines[idx] ?? '');
    if (match === null) break;
    const indent = indentWidth(match[1] ?? '');
    if (indent !== baseIndent) break;
    if (isOrderedMarker(match[2] ?? '') !== ordered) break;

    const itemBlocks: PmNode[] = [];
    let paragraphBuffer: string[] = [match[3] ?? ''];
    let blankSeen = false;

    /** 把当前段落缓冲落到 itemBlocks */
    const flushParagraph = (): void => {
      const text = paragraphBuffer.join(' ').trim();
      paragraphBuffer = [];
      if (text === '') return;
      const paragraph = ctx.paragraph(text);
      if (paragraph !== undefined) itemBlocks.push(paragraph);
    };

    idx += 1;
    while (idx < lines.length) {
      const raw = lines[idx] ?? '';
      if (raw.trim() === '') {
        blankSeen = true;
        idx += 1;
        continue;
      }

      const nested = LIST_ITEM_RE.exec(raw);
      if (nested !== null) {
        const nestedIndent = indentWidth(nested[1] ?? '');
        /* 回到外层或同级下一项：结束当前项 */
        if (nestedIndent <= baseIndent) break;
        flushParagraph();
        blankSeen = false;
        const child = parseListAt(
          lines,
          idx,
          nestedIndent,
          isOrderedMarker(nested[2] ?? ''),
          ctx,
          depth + 1,
        );
        if (child.node !== undefined) {
          itemBlocks.push(child.node);
          idx = child.next;
        } else {
          /* 超深降级：把子项文本并入当前段落 */
          paragraphBuffer.push((nested[3] ?? '').trim());
          idx += 1;
        }
        continue;
      }

      /* 顶格内容结束列表；更深缩进是项内续行 */
      if (leadingIndent(raw) <= baseIndent) break;
      if (blankSeen) {
        flushParagraph();
        blankSeen = false;
      }
      paragraphBuffer.push(stripIndent(raw, baseIndent + 2).trim());
      idx += 1;
    }

    flushParagraph();
    if (itemBlocks.length === 0) {
      const empty = ctx.paragraph('');
      if (empty !== undefined) itemBlocks.push(empty);
    }
    items.push(itemType.createChecked(null, itemBlocks.length > 0 ? itemBlocks : undefined));
  }

  if (items.length === 0) return { next: start };
  return { node: listType.createChecked({ ordered }, items), next: idx };
}

/** 表格分隔行单元格（`:---:` / `---:` / `:---` / `---`） */
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;

/** 切分管道行（处理 `\|` 转义，去掉首尾空单元格） */
function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let buffer = '';
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (ch === '\\' && text[index + 1] === '|') {
      buffer += '|';
      index += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  cells.push(buffer.trim());
  return cells;
}

/** 分隔行单元格 → 对齐方式 */
function tableAlignment(cell: string): 'left' | 'center' | 'right' | null {
  const text = cell.trim();
  if (!text.includes('-')) return null;
  if (text.startsWith(':') && text.endsWith(':')) return 'center';
  if (text.endsWith(':')) return 'right';
  if (text.startsWith(':')) return 'left';
  return null;
}

/**
 * 解析 GFM 管道表格
 *
 * 识别条件：当前行含 `|`，下一行是合法分隔行且列数与表头一致。
 * 返回 `next` 为表格结束后的行号；无法识别时返回 `undefined`。
 */
export function parseTableBlock(
  lines: readonly string[],
  start: number,
  ctx: MarkdownBlockContext,
): { node: PmNode; next: number } | undefined {
  const headerLine = lines[start] ?? '';
  if (!headerLine.includes('|')) return undefined;
  const headerCells = splitTableRow(headerLine);
  const separatorCells = splitTableRow(lines[start + 1] ?? '');
  if (headerCells.length === 0 || separatorCells.length !== headerCells.length) {
    return undefined;
  }
  if (!separatorCells.every((cell) => TABLE_SEPARATOR_CELL.test(cell.trim()))) {
    return undefined;
  }

  const tableType = ctx.schema.nodes[NODE_TYPES.TABLE];
  const rowType = ctx.schema.nodes[NODE_TYPES.TABLE_ROW];
  const cellType = ctx.schema.nodes[NODE_TYPES.TABLE_CELL];
  if (tableType === undefined || rowType === undefined || cellType === undefined) {
    return undefined;
  }

  const columnCount = headerCells.length;
  const alignments = separatorCells.map(tableAlignment);

  const buildRow = (cells: readonly string[], header: boolean): PmNode => {
    const cellNodes: PmNode[] = [];
    for (let index = 0; index < columnCount; index += 1) {
      const paragraph = ctx.paragraph(cells[index] ?? '');
      cellNodes.push(
        cellType.create(
          { align: alignments[index] ?? null },
          paragraph !== undefined ? [paragraph] : undefined,
        ),
      );
    }
    return rowType.create({ header }, cellNodes);
  };

  const rows: PmNode[] = [buildRow(headerCells, true)];
  let idx = start + 2;
  while (idx < lines.length) {
    const line = lines[idx] ?? '';
    if (line.trim() === '' || !line.includes('|')) break;
    rows.push(buildRow(splitTableRow(line), false));
    idx += 1;
  }

  return { node: tableType.create(null, rows), next: idx };
}
