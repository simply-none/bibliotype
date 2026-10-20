/**
 * 纯文本（TXT）→ BookDocument
 *
 * 面向公版书 / 文本稿的最常见形态：无标记、空行分段、`第X章` / `卷X` 起章。
 * 规则保持**可预期且可覆盖**：
 * - 空行分段，段内硬换行合并（中文不加分隔，西文补一个空格）；
 * - 行首命中章节模式（默认 `第X章/回/节/卷/部/篇` 与 `卷X`）即起新章；
 * - 首个章节标记之前的内容自成无标题章（不丢内容）；
 * - id 由 `idPrefix` + 序号确定生成（同一输入两次导入结果一致，便于 diff / 测试）。
 */
import { NODE_TYPES, type BookDocument, type BookMetadata } from '@bibliotype/core';
import type { Node as PmNode, Schema } from 'prosemirror-model';
import { nodesToBookDocument } from './book-document.js';

/** 缺省章节标题模式：第X章 / 第X回 / 第X节 / 第X卷 / 第X部 / 第X篇 / 卷X */
export const DEFAULT_TXT_CHAPTER_PATTERN =
  /^(?:第[〇零一二三四五六七八九十百千两0-9]+[章节回卷部篇]|卷[〇零一二三四五六七八九十百千两0-9]+)/;

/** TXT 导入选项 */
export interface TxtImportOptions {
  /** 章节标题匹配（行首匹配，默认 {@link DEFAULT_TXT_CHAPTER_PATTERN}） */
  chapterPattern?: RegExp;
  /** 章节容器节点类型（默认 `chapter`；可传 `volume` 做卷级拆分） */
  chapterType?: string;
  /** id 前缀（默认 `txt`；输出形如 `txt-chapter-1` / `txt-p-1`） */
  idPrefix?: string;
}

/** 解析出的章节分组 */
interface ChapterGroup {
  title: string;
  paragraphs: string[];
}

/** 合并段内硬换行（中西文分别处理，避免中文句子被空格割裂） */
function joinLines(lines: readonly string[]): string {
  let text = '';
  for (const line of lines) {
    if (text === '') {
      text = line;
      continue;
    }
    const prev = text[text.length - 1] ?? '';
    const next = line[0] ?? '';
    const latinBreak = /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next);
    text += latinBreak ? ` ${line}` : line;
  }
  return text;
}

/**
 * 把纯文本解析为章节分组
 *
 * 空文本返回空数组；无章节标记时全部段落归入一个无标题分组。
 */
function parseChapters(
  text: string,
  pattern: RegExp,
): ChapterGroup[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const groups: ChapterGroup[] = [];
  let current: ChapterGroup = { title: '', paragraphs: [] };
  let buffer: string[] = [];

  const flushParagraph = (): void => {
    if (buffer.length === 0) {
      return;
    }
    const paragraph = joinLines(buffer).trim();
    if (paragraph !== '') {
      current.paragraphs.push(paragraph);
    }
    buffer = [];
  };

  const flushChapter = (): void => {
    flushParagraph();
    if (current.paragraphs.length > 0) {
      groups.push(current);
    }
    current = { title: '', paragraphs: [] };
  };

  for (const line of normalized.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    pattern.lastIndex = 0;
    if (pattern.test(trimmed)) {
      flushChapter();
      current.title = trimmed;
      continue;
    }
    buffer.push(trimmed);
  }
  flushChapter();
  return groups;
}

/**
 * 纯文本 → BookDocument
 *
 * @param text 纯文本内容（UTF-8 解码后的字符串）
 * @param schema 编辑器 schema（须含 `book` / `paragraph` 与所选章节节点）
 * @param metadata 书目元数据（由调用方注入，保证确定性）
 * @param options 章节模式 / 容器类型 / id 前缀
 * @throws schema 缺少所需节点类型时抛 `RangeError`
 */
export function txtToBookDocument(
  text: string,
  schema: Schema,
  metadata: BookMetadata,
  options: TxtImportOptions = {},
): BookDocument {
  const paragraphType = schema.nodes[NODE_TYPES.PARAGRAPH];
  const bookType = schema.nodes[NODE_TYPES.BOOK];
  if (paragraphType === undefined || bookType === undefined) {
    throw new RangeError('schema 缺少 paragraph / book 节点，无法导入纯文本。');
  }
  const chapterTypeName = options.chapterType ?? NODE_TYPES.CHAPTER;
  const chapterType = schema.nodes[chapterTypeName];
  if (chapterType === undefined) {
    throw new RangeError(`schema 未定义章节节点类型 "${chapterTypeName}"，无法导入纯文本。`);
  }
  const prefix = options.idPrefix ?? 'txt';
  const pattern = options.chapterPattern ?? DEFAULT_TXT_CHAPTER_PATTERN;
  const groups = parseChapters(text, pattern);

  let blockIndex = 0;
  const createParagraph = (value: string): PmNode => {
    blockIndex += 1;
    return paragraphType.create({ id: `${prefix}-p-${blockIndex}` }, schema.text(value));
  };

  // 无任何章节标记：段落直接挂在书根（不虚构章节点）
  if (groups.length === 1 && groups[0]?.title === '') {
    const paragraphs = groups[0].paragraphs.map(createParagraph);
    return nodesToBookDocument(paragraphs, schema, metadata);
  }

  let chapterIndex = 0;
  const nodes: PmNode[] = groups.map((group) => {
    chapterIndex += 1;
    const paragraphs = group.paragraphs.map(createParagraph);
    const attrs: Record<string, unknown> = { id: `${prefix}-chapter-${chapterIndex}` };
    if (group.title !== '') {
      attrs['title'] = group.title;
    }
    return chapterType.create(attrs, paragraphs);
  });
  return nodesToBookDocument(nodes, schema, metadata);
}
