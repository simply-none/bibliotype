/**
 * 块级内容 → Word 段落 / 表格
 *
 * 映射原则：
 * - 结构容器透明化（book / section / condition），章节首块另起页；
 * - 标题走内置 `Heading1..6`（Word 导航窗格与目录域据此生成层级）；
 * - 段落 / 引文 / 图注 / 代码块 / 注文各有固定命名样式，命名样式（`styleId`）优先；
 * - 表格按 `colspan` / `rowspan` → `columnSpan` / `rowSpan`，开头连续表头行加粗 +
 *   底色 + 跨页重复；
 * - 脚注 / 尾注 / 边注块的内容只在被注引用时输出（作为 Word 脚注），
 *   未被引用的注释按普通段落兜底并记录问题。
 */
import { NODE_TYPES, evaluateCondition, isTextNode, type BookNode } from '@bibliotype/core';
import {
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import type { ExportContext } from './context.js';
import { cleanText, inlineChildren, type InlineDeps } from './inline.js';
import { buildImageRun, imageAltText } from './images.js';
import { STYLE_IDS, namedWordStyleId, type Mutable } from './styles.js';

/** Word 内置脚注文本样式（脚注内容段落挂它，Word 才能按注文样式渲染） */
export const FOOTNOTE_TEXT_STYLE = 'FootnoteText';

/** 块级转换选项 */
export interface BlockBuildOptions {
  /** 段落缺省样式（脚注内容用 FootnoteText；未引用注释用 BibliotypeNote） */
  baseStyle?: string;
  /** 强制加粗（表头单元格） */
  bold?: boolean;
  /** 首段前置内容（未引用注释的注码前缀） */
  leadingRuns?: ParagraphChild[];
}

/** 遍历状态 */
interface WalkState {
  options: BlockBuildOptions;
  /** 引文嵌套深度（段落样式回退用） */
  quoteDepth: number;
  /** 列表嵌套深度（缩进用） */
  listDepth: number;
  /** 待生效的分页符（章节首块 / 分页符节点） */
  pendingPageBreak: boolean;
  /** 是否已输出过任何块（首个块不另起页） */
  emitted: boolean;
  /** 尚未消费的首段前置内容 */
  leadingRuns?: ParagraphChild[];
}

/** 标题级别 → docx 常量 */
const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/** 结构容器（透明下钻） */
const TRANSPARENT_CONTAINERS: ReadonlySet<string> = new Set([
  NODE_TYPES.BOOK,
  NODE_TYPES.COVER,
  NODE_TYPES.TITLE_PAGE,
  NODE_TYPES.COPYRIGHT_PAGE,
  NODE_TYPES.BACK_COVER,
  NODE_TYPES.TOC,
  NODE_TYPES.SECTION,
]);

/** 需要另起页的结构容器 */
const PAGE_BREAK_CONTAINERS: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
]);

/**
 * 行内转换依赖：注引 → 脚注内容段落
 *
 * 按 ctx 现算而不缓存：一次导出里同一注释通常只被引用一次，缓存反而要额外维护
 * 生命周期；递归构建也不会出现环（注释内容不再包含注引——见 collectNotes 的约定）。
 */
function inlineDeps(ctx: ExportContext): InlineDeps {
  return {
    noteParagraphs(noteId) {
      const entry = ctx.notesById.get(noteId);
      if (entry === undefined) return undefined;
      const blocks = buildBlocks(
        { type: NODE_TYPES.BOOK, children: entry.node.children ?? [] },
        ctx,
        { baseStyle: FOOTNOTE_TEXT_STYLE },
      );
      const paragraphs = blocks.filter((block): block is Paragraph => block instanceof Paragraph);
      return paragraphs.length > 0 ? paragraphs : [new Paragraph({ style: FOOTNOTE_TEXT_STYLE })];
    },
  };
}

/** 把根节点转换为 Word 块 */
export function buildBlocks(
  root: BookNode,
  ctx: ExportContext,
  options: BlockBuildOptions = {},
): FileChild[] {
  const state: WalkState = {
    options,
    quoteDepth: 0,
    listDepth: 0,
    pendingPageBreak: false,
    emitted: false,
    leadingRuns: options.leadingRuns === undefined ? undefined : [...options.leadingRuns],
  };
  const out: FileChild[] = [];
  walk(root, ctx, state, out);
  return out;
}

/** 节点分发 */
function walk(node: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  if (isTextNode(node)) {
    emitParagraph({ type: NODE_TYPES.PARAGRAPH, children: [node] }, ctx, state, out);
    return;
  }

  if (TRANSPARENT_CONTAINERS.has(node.type)) {
    walkChildren(node, ctx, state, out);
    return;
  }

  if (PAGE_BREAK_CONTAINERS.has(node.type)) {
    if (state.emitted) state.pendingPageBreak = true;
    walkChildren(node, ctx, state, out);
    return;
  }

  switch (node.type) {
    case NODE_TYPES.CONDITION:
      if (conditionHolds(node, ctx)) walkChildren(node, ctx, state, out);
      return;
    case NODE_TYPES.PAGE_HEADER:
    case NODE_TYPES.PAGE_FOOTER:
      /* 页眉页脚属于 Word 的 section 件，正文流里不输出 */
      return;
    case NODE_TYPES.HEADING:
      emitHeading(node, ctx, state, out);
      return;
    case NODE_TYPES.PARAGRAPH:
      emitParagraph(node, ctx, state, out);
      return;
    case NODE_TYPES.QUOTE:
      state.quoteDepth += 1;
      walkChildren(node, ctx, state, out);
      state.quoteDepth -= 1;
      return;
    case NODE_TYPES.LIST:
      emitList(node, ctx, state, out);
      return;
    case NODE_TYPES.LIST_ITEM:
      emitListItem(node, false, 1, ctx, state, out);
      return;
    case NODE_TYPES.TABLE:
      emitTable(node, ctx, state, out);
      return;
    case NODE_TYPES.TABLE_ROW:
    case NODE_TYPES.TABLE_CELL:
      walkChildren(node, ctx, state, out);
      return;
    case NODE_TYPES.IMAGE:
      emitImage(node, ctx, state, out);
      return;
    case NODE_TYPES.CAPTION:
      emitParagraph(node, ctx, state, out, STYLE_IDS.caption);
      return;
    case NODE_TYPES.CODE_BLOCK:
      emitCodeBlock(node, ctx, state, out);
      return;
    case NODE_TYPES.MATH_BLOCK:
      emitMathBlock(node, ctx, state, out);
      return;
    case NODE_TYPES.BREAK:
      emitBreak(node, ctx, state, out);
      return;
    case NODE_TYPES.FOOTNOTE:
    case NODE_TYPES.ENDNOTE:
    case NODE_TYPES.MARGIN_NOTE:
      emitNoteBlock(node, ctx, state, out);
      return;
    default:
      emitFallback(node, ctx, state, out);
      return;
  }
}

/** 容器子节点：连续的文本 / 行内节点合并为一段 */
function walkChildren(container: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const buffer: BookNode[] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    emitParagraph({ type: NODE_TYPES.PARAGRAPH, children: buffer.splice(0) }, ctx, state, out);
  };

  for (const child of container.children ?? []) {
    if (isTextNode(child) || child.type === NODE_TYPES.MATH_INLINE) {
      buffer.push(child);
      continue;
    }
    flush();
    walk(child, ctx, state, out);
  }
  flush();
}

/** 条件容器：`when` 求值为真才输出（缺省上下文保留全部条件内容） */
function conditionHolds(node: BookNode, ctx: ExportContext): boolean {
  const when = typeof node.attrs?.['when'] === 'string' ? node.attrs.when : '';
  return when === '' ? true : evaluateCondition(when, ctx.options.conditionContext);
}

/** 标题 → 内置标题样式 */
function emitHeading(node: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const rawLevel = node.attrs?.['level'];
  const level = clamp(typeof rawLevel === 'number' ? Math.round(rawLevel) : 1, 1, 6);
  const children = inlineChildren(node, ctx, inlineDeps(ctx));
  pushParagraph(out, state, {
    children: children.length > 0 ? children : undefined,
    heading: HEADING_LEVELS[level - 1],
  });
}

/** 段落 / 引文 / 图注 / 注释段落 */
function emitParagraph(
  node: BookNode,
  ctx: ExportContext,
  state: WalkState,
  out: FileChild[],
  styleOverride?: string,
): void {
  const children = inlineChildren(node, ctx, inlineDeps(ctx));
  if (state.leadingRuns !== undefined && state.leadingRuns.length > 0) {
    children.unshift(...state.leadingRuns);
    state.leadingRuns = undefined;
  }
  pushParagraph(out, state, {
    children: children.length > 0 ? children : undefined,
    style: styleOverride ?? paragraphStyleOf(node, ctx, state),
    run: state.options.bold === true ? { bold: true } : undefined,
  });
}

/** 段落样式优先级：命名样式 > 指定样式 > 脚注样式 > 引文 > 正文 */
function paragraphStyleOf(node: BookNode, ctx: ExportContext, state: WalkState): string {
  const named = namedWordStyleId(node, ctx.options.namedStyles);
  if (named !== undefined) return named;
  if (state.options.baseStyle !== undefined) return state.options.baseStyle;
  if (state.quoteDepth > 0) return STYLE_IDS.quote;
  return STYLE_IDS.body;
}

/** 追加段落（消费待生效分页符） */
function pushParagraph(out: FileChild[], state: WalkState, options: IParagraphOptions): void {
  const next: Mutable<IParagraphOptions> = { ...options };
  if (state.pendingPageBreak) {
    next.pageBreakBefore = true;
    state.pendingPageBreak = false;
  }
  out.push(new Paragraph(next));
  state.emitted = true;
}

/** 列表：逐项输出段落，嵌套列表按深度缩进 */
function emitList(list: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const ordered = list.attrs?.['ordered'] === true;
  let index = 0;
  const buffer: BookNode[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    index += 1;
    emitListItem(
      { type: NODE_TYPES.LIST_ITEM, children: buffer.splice(0) },
      ordered,
      index,
      ctx,
      state,
      out,
    );
  };

  for (const child of list.children ?? []) {
    if (isTextNode(child) || child.type === NODE_TYPES.MATH_INLINE) {
      buffer.push(child);
      continue;
    }
    flush();
    if (child.type === NODE_TYPES.LIST_ITEM) {
      index += 1;
      emitListItem(child, ordered, index, ctx, state, out);
      continue;
    }
    if (child.type === NODE_TYPES.LIST) {
      state.listDepth += 1;
      emitList(child, ctx, state, out);
      state.listDepth -= 1;
      continue;
    }
    walk(child, ctx, state, out);
  }
  flush();
}

/** 列表项：序号 / 项目符号前缀 + 行内内容，嵌套列表递归 */
function emitListItem(
  item: BookNode,
  ordered: boolean,
  index: number,
  ctx: ExportContext,
  state: WalkState,
  out: FileChild[],
): void {
  const prefix = ordered ? `${index}. ` : '• ';
  const inlineNodes = collectListItemInline(item);
  const children: ParagraphChild[] = [
    new TextRun({ text: prefix }),
    ...inlineChildren({ type: NODE_TYPES.LIST_ITEM, children: inlineNodes }, ctx, inlineDeps(ctx)),
  ];

  pushParagraph(out, state, {
    children,
    style: paragraphStyleOf(item, ctx, state),
    indent: { left: 420 * (state.listDepth + 1), firstLine: 0 },
  });

  for (const child of item.children ?? []) {
    if (isTextNode(child)) continue;
    if (child.type === NODE_TYPES.PARAGRAPH || child.type === NODE_TYPES.LIST_ITEM) continue;
    if (child.type === NODE_TYPES.LIST) {
      state.listDepth += 1;
      emitList(child, ctx, state, out);
      state.listDepth -= 1;
      continue;
    }
    walk(child, ctx, state, out);
  }
}

/** 列表项的行内内容：直接文本 + 段落子节点的内容 */
function collectListItemInline(item: BookNode): BookNode[] {
  const nodes: BookNode[] = [];
  for (const child of item.children ?? []) {
    if (isTextNode(child) || child.type === NODE_TYPES.MATH_INLINE) {
      nodes.push(child);
      continue;
    }
    if (child.type === NODE_TYPES.PARAGRAPH) nodes.push(...(child.children ?? []));
  }
  return nodes;
}

/** 表格：表头行加粗 + 底色 + 跨页重复，跨行跨列走 Word 合并 */
function emitTable(table: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const rows = elementChildren(table).filter((child) => child.type === NODE_TYPES.TABLE_ROW);
  if (rows.length === 0) return;

  let headerCount = 0;
  while (headerCount < rows.length && rows[headerCount]?.attrs?.['header'] === true) {
    headerCount += 1;
  }

  const tableRows = rows.map((row, rowIndex) => {
    const header = rowIndex < headerCount || row.attrs?.['header'] === true;
    const cells = elementChildren(row)
      .filter((child) => child.type === NODE_TYPES.TABLE_CELL)
      .map((cell) => buildCell(cell, header, ctx, state));

    return new TableRow({
      children: cells,
      tableHeader: header || undefined,
      cantSplit: true,
    });
  });

  if (state.pendingPageBreak) {
    out.push(new Paragraph({ pageBreakBefore: true }));
    state.pendingPageBreak = false;
  }
  out.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  state.emitted = true;
}

/** 单元格：内容为块级数组（空单元格补空段落） */
function buildCell(cell: BookNode, header: boolean, ctx: ExportContext, state: WalkState): TableCell {
  const blocks = buildBlocks(cell, ctx, { ...state.options, bold: header });
  const { columnSpan, rowSpan } = spanOf(cell);
  return new TableCell({
    children: blocks.length > 0 ? (blocks as Array<Paragraph | Table>) : [new Paragraph({})],
    columnSpan,
    rowSpan,
    shading: header ? { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
  });
}

/** 单元格 colspan / rowspan（> 1 才生效） */
function spanOf(cell: BookNode): { columnSpan?: number; rowSpan?: number } {
  const read = (key: 'colspan' | 'rowspan'): number | undefined => {
    const raw = cell.attrs?.[key];
    const value = typeof raw === 'number' ? Math.round(raw) : Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(value) && value > 1 ? value : undefined;
  };
  return { columnSpan: read('colspan'), rowSpan: read('rowspan') };
}

/** 块级图片：居中，解码失败时以斜体替代文字兜底 */
function emitImage(node: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const run = buildImageRun(node, ctx);
  if (run === undefined) {
    pushParagraph(out, state, {
      children: [new TextRun({ text: imageAltText(node), italics: true })],
      alignment: AlignmentType.CENTER,
    });
    return;
  }
  pushParagraph(out, state, { children: [run], alignment: AlignmentType.CENTER });
}

/** 代码块：保留换行，等宽字体 + 浅底 */
function emitCodeBlock(node: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const lines = cleanText(plainText(node)).split(/\r\n|\r|\n/);
  const children = lines.map(
    (line, index) => new TextRun({ text: line, ...(index === 0 ? {} : { break: 1 }) }),
  );
  pushParagraph(out, state, { style: STYLE_IDS.code, children });
}

/** 块级公式：Word 无 OMML 生成能力，降级为 TeX 源码 */
function emitMathBlock(node: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const tex = typeof node.attrs?.['tex'] === 'string' ? node.attrs.tex : plainText(node);
  ctx.reportOnce(
    `math-block:${node.id ?? tex}`,
    'math-degraded',
    'Word 公式（OMML）暂不支持，已降级为 TeX 源码',
    node.id,
  );
  pushParagraph(out, state, {
    style: STYLE_IDS.code,
    children: [new TextRun({ text: cleanText(tex) })],
  });
}

/** 分隔线 / 分页符（`attrs.variant` = page / column 时分页） */
function emitBreak(node: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const variant = node.attrs?.['variant'];
  if (variant === 'page' || variant === 'column') {
    state.pendingPageBreak = true;
    return;
  }
  pushParagraph(out, state, {
    children: [new TextRun('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
  });
}

/** 未被引用的注释：按普通段落输出并记录问题 */
function emitNoteBlock(note: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  const entry = ctx.noteByNode.get(note);
  if (entry !== undefined && ctx.referencedNotes.has(entry.id)) return;

  const marker = note.attrs?.['marker'];
  const label = entry?.label ?? (typeof marker === 'string' ? marker : '');
  ctx.report(
    'note-unreferenced',
    `注释未被正文引用，已按普通段落输出：${entry?.id ?? '(无 id)'}`,
    note.id,
  );

  const blocks = buildBlocks(
    { type: NODE_TYPES.BOOK, children: note.children ?? [] },
    ctx,
    {
      baseStyle: STYLE_IDS.note,
      leadingRuns: label === '' ? undefined : [new TextRun({ text: `${label} `, superScript: true })],
    },
  );
  out.push(...blocks);
  state.emitted = state.emitted || blocks.length > 0;
}

/** 未知节点：有子节点则透明下钻，否则按文本段落兜底 */
function emitFallback(node: BookNode, ctx: ExportContext, state: WalkState, out: FileChild[]): void {
  ctx.reportOnce(
    `unsupported-node:${node.type}`,
    'unsupported-node',
    `未知节点类型按段落降级：${node.type}`,
    node.id,
  );
  if ((node.children ?? []).length > 0) {
    walkChildren(node, ctx, state, out);
    return;
  }
  const text = cleanText(plainText(node));
  if (text !== '') pushParagraph(out, state, { children: [new TextRun({ text })] });
}

/** 元素子节点（剔除文本叶子） */
function elementChildren(node: BookNode): BookNode[] {
  return (node.children ?? []).filter((child) => !isTextNode(child));
}

/** 纯文本（代码块 / 公式兜底） */
function plainText(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).map(plainText).join('');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
