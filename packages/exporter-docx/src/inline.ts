/**
 * 行内内容 → ParagraphChild[]
 *
 * 覆盖 core 全部行内标记的 Word 映射；无法等价表达的语义一律降级并记录问题：
 * - `ruby`（注音）→「汉字（注音）」纯文本；
 * - `noteref`（注引）→ Word 脚注引用（注文随引用自包含，Word 侧可跳转）；
 * - `index-term` / `format-change` 无视觉，仅保留文字；
 * - `deletion` / `insertion` 按修订视图取舍。
 *
 * 链接用 `ExternalHyperlink`：Word 的锚点链接需要书签，`#` 目标暂不包装
 * （避免导出后出现「失效超链接」，正文文字不受影响）。
 */
import { MARK_TYPES, NODE_TYPES, isTextNode, type BookMark, type BookNode } from '@bibliotype/core';
import {
  ExternalHyperlink,
  FootnoteReferenceRun,
  HighlightColor,
  TextRun,
  UnderlineType,
  type IRunStylePropertiesOptions,
  type Paragraph,
  type ParagraphChild,
} from 'docx';
import type { ExportContext } from './context.js';
import { buildImageRun, imageAltText } from './images.js';
import { CODE_FONT, type Mutable } from './styles.js';

/** 行内转换依赖（脚注内容由 blocks 层注入，避免模块循环依赖） */
export interface InlineDeps {
  /** 按注释 id 取脚注内容段落；返回 `undefined` 表示没有该注释 */
  noteParagraphs(noteId: string): Paragraph[] | undefined;
}

/** 节点 → 行内内容（文本、行内公式、行内图片按序拼接） */
export function inlineChildren(node: BookNode, ctx: ExportContext, deps: InlineDeps): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  collectInline(node, ctx, deps, out);
  return out;
}

/** 剥离 XML 1.0 非法控制字符（Word 会因此拒开文档） */
export function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
}

function collectInline(
  node: BookNode,
  ctx: ExportContext,
  deps: InlineDeps,
  out: ParagraphChild[],
): void {
  if (isTextNode(node)) {
    out.push(...textRuns(node, ctx, deps));
    return;
  }

  if (node.type === NODE_TYPES.IMAGE) {
    const run = buildImageRun(node, ctx);
    out.push(run ?? new TextRun({ text: imageAltText(node), italics: true }));
    return;
  }

  if (node.type === NODE_TYPES.MATH_INLINE) {
    const tex = mathSource(node);
    ctx.reportOnce(`math-inline:${node.id ?? tex}`, 'math-degraded', 'Word 公式（OMML）暂不支持，已降级为 TeX 源码', node.id);
    out.push(new TextRun({ text: cleanText(tex), font: CODE_FONT }));
    return;
  }

  for (const child of node.children ?? []) collectInline(child, ctx, deps, out);
}

/** 公式源码（`attrs.tex` 优先，缺省取纯文本） */
function mathSource(node: BookNode): string {
  const tex = node.attrs?.['tex'];
  return typeof tex === 'string' ? tex : plainText(node);
}

/** 纯文本（行内容器兜底） */
function plainText(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).map(plainText).join('');
}

/** 单个文本节点 → runs（注引替换、标记映射、换行拆分） */
function textRuns(node: BookNode, ctx: ExportContext, deps: InlineDeps): ParagraphChild[] {
  const marks = node.marks ?? [];
  const text = cleanText(node.text ?? '');
  const view = ctx.options.revisionView;

  if (findMark(marks, MARK_TYPES.DELETION) !== undefined && view === 'final') return [];
  if (findMark(marks, MARK_TYPES.INSERTION) !== undefined && view === 'original') return [];

  const noteRef = findMark(marks, MARK_TYPES.NOTE_REF);
  if (noteRef !== undefined) return noteRefRuns(noteRef, text, ctx, deps, node);

  const ruby = findMark(marks, MARK_TYPES.RUBY);
  let content = text;
  if (ruby !== undefined) {
    const rt = ruby.attrs?.['text'];
    if (typeof rt === 'string' && rt !== '') {
      content = `${text}（${cleanText(rt)}）`;
      ctx.reportOnce(
        `ruby:${node.id ?? rt}`,
        'ruby-degraded',
        'Word 无注音（ruby）支持，已降级为「汉字（注音）」',
        node.id,
      );
    }
  }

  if (content === '') return [];

  const options = runOptionsFromMarks(marks, view);
  const segments = content.split(/\r\n|\r|\n/);
  const runs: ParagraphChild[] = segments.map(
    (segment, index) =>
      new TextRun({ text: segment, ...(index === 0 ? {} : { break: 1 }), ...options }),
  );

  const link = findMark(marks, MARK_TYPES.LINK);
  const href = typeof link?.attrs?.['href'] === 'string' ? link.attrs.href.trim() : '';
  if (href === '' || href.startsWith('#')) return runs;
  return [new ExternalHyperlink({ children: runs, link: href })];
}

/** 注引 → Word 脚注引用（Word 自己编号，无需手写注码） */
function noteRefRuns(
  mark: BookMark,
  text: string,
  ctx: ExportContext,
  deps: InlineDeps,
  node: BookNode,
): ParagraphChild[] {
  const targetId = typeof mark.attrs?.['targetId'] === 'string' ? mark.attrs.targetId : '';
  const entry = targetId === '' ? undefined : ctx.notesById.get(targetId);
  const paragraphs = entry === undefined ? undefined : deps.noteParagraphs(entry.id);

  if (entry === undefined || paragraphs === undefined) {
    ctx.reportOnce(
      `note-orphan:${targetId}`,
      'note-orphan',
      `注引用找不到注释块：${targetId === '' ? '(空 targetId)' : targetId}`,
      node.id,
    );
    return [new TextRun({ text, superScript: true })];
  }
  return [new FootnoteReferenceRun({ children: paragraphs })];
}

/** 取第一种指定类型的标记 */
function findMark(marks: readonly BookMark[], type: string): BookMark | undefined {
  return marks.find((mark) => mark.type === type);
}

/** 标记 → Word 字符属性 */
function runOptionsFromMarks(
  marks: readonly BookMark[],
  view: ExportContext['options']['revisionView'],
): IRunStylePropertiesOptions {
  const run: Mutable<IRunStylePropertiesOptions> = {};

  for (const mark of marks) {
    switch (mark.type) {
      case MARK_TYPES.STRONG:
        run.bold = true;
        break;
      case MARK_TYPES.EMPHASIS:
        run.italics = true;
        break;
      case MARK_TYPES.UNDERLINE:
        run.underline = { type: UnderlineType.SINGLE };
        break;
      case MARK_TYPES.STRIKETHROUGH:
        run.strike = true;
        break;
      case MARK_TYPES.HIGHLIGHT:
        run.highlight = HighlightColor.YELLOW;
        break;
      case MARK_TYPES.CODE:
        run.font = CODE_FONT;
        run.shading = { fill: 'F2F2F2' };
        break;
      case MARK_TYPES.DELETION:
        if (view === 'marked') run.strike = true;
        break;
      case MARK_TYPES.INSERTION:
        if (view === 'marked') run.underline = { type: UnderlineType.SINGLE };
        break;
      default:
        /* link / ruby / noteref / index-term / format-change 已在别处处理 */
        break;
    }
  }
  return run;
}
