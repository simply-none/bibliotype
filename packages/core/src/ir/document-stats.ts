/**
 * 文档统计与词表检查
 *
 * 统计口径（与出版习惯对齐，全部为**纯函数**，不依赖 DOM / 编辑器）：
 * - `characters`：正文字符数（去空白；默认去标点，`countPunctuation` 可含标点）；
 * - `words`：词数（CJK 逐字计、拉丁 / 数字连续串计 1 词，标点与公式不计）；
 * - `readingMinutes`：按 `charsPerMinute`（默认 400 字/分）向上取整；
 * - 注释（`footnote` / `endnote` / `margin-note`）字数按 `notes` 选项单独 / 计入 / 忽略。
 *
 * 词表检查（`checkWordList`）返回可直接消费的**文本锚点**（见 `ir/anchor.ts`），
 * 供批注 / 高亮 / 定位复用；词表由调用方提供（敏感词、错别字、术语表均可）。
 */
import { isTextNode } from './nodes.js';
import type { BookNode } from './nodes.js';
import { isNoteNodeType } from './notes.js';
import { NODE_TYPES } from './node-types.js';
import { createTextAnchor } from './anchor.js';
import type { TextAnchor } from './anchor.js';
import type { BookDocument } from './document.js';

/** 缺省阅读速度（字 / 分钟） */
export const DEFAULT_READING_CHARS_PER_MINUTE = 400;

/** 结构节点层级（数值越小层级越高；未列出的按叶级结构处理） */
const STRUCTURE_LEVELS: Readonly<Record<string, number>> = {
  [NODE_TYPES.VOLUME]: 1,
  [NODE_TYPES.CHAPTER]: 2,
  [NODE_TYPES.SECTION]: 3,
};

/** 结构节点集合（卷 / 章 / 节 / 附录 / 前言 / 后记） */
const STRUCTURE_NODE_TYPES: ReadonlySet<string> = new Set([
  NODE_TYPES.VOLUME,
  NODE_TYPES.CHAPTER,
  NODE_TYPES.SECTION,
  NODE_TYPES.APPENDIX,
  NODE_TYPES.PREFACE,
  NODE_TYPES.POSTSCRIPT,
]);

/** 注释字数口径 */
export type NoteCountingMode = 'separate' | 'include' | 'exclude';

/** 统计选项 */
export interface DocumentStatsOptions {
  /** 注释口径（默认 `separate`） */
  notes?: NoteCountingMode;
  /** 阅读速度（字 / 分钟，默认 400；<= 0 时阅读时长为 0） */
  charsPerMinute?: number;
  /** 字数是否包含标点（默认 false） */
  countPunctuation?: boolean;
}

/** 注释数量 */
export interface NoteCounts {
  footnote: number;
  endnote: number;
  marginNote: number;
}

/** 结构节点字数分布 */
export interface StructureStats {
  /** 结构节点 id（容器可能缺 id） */
  nodeId?: string;
  /** 结构节点类型（volume / chapter / section ...） */
  type: string;
  /** 标题（attrs.title，缺省空串） */
  title: string;
  /** 层级（卷 1 / 章 2 / 节 3；附录等按 1） */
  level: number;
  /** 该子树正文字符数（遵循 `notes` 口径） */
  characters: number;
}

/** 文档统计结果 */
export interface DocumentStats {
  /** 正文字符数（遵循 `notes` 口径） */
  characters: number;
  /** 注释字符数（`notes: 'exclude'` 时为 0） */
  noteCharacters: number;
  /** 正文 + 注释（去重后的总字数） */
  totalCharacters: number;
  /** 词数（CJK 逐字 + 拉丁词） */
  words: number;
  /** 估算阅读时长（分钟，向上取整） */
  readingMinutes: number;
  /** 叶级块数量（段落 / 标题 / 题注 / 代码块 / 原子块 / 注释块） */
  blocks: number;
  /** 注释数量 */
  notes: NoteCounts;
  /** 结构节点字数分布（卷 / 章 / 节 / 附录 / 前言 / 后记，先序） */
  structures: StructureStats[];
}

/** 标点 / 符号（统计字数时默认剔除） */
const PUNCTUATION_PATTERN = /[\p{P}\p{S}]/u;

/** CJK 字符（含扩展 A、兼容区、日文假名、谚文） */
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

/** 拉丁 / 数字字符（词边界判定） */
const WORD_CHAR_PATTERN = /[A-Za-z0-9]/;

function plainTextOf(node: BookNode): string {
  if (isTextNode(node)) {
    return node.text ?? '';
  }
  let text = '';
  for (const child of node.children ?? []) {
    text += plainTextOf(child);
  }
  return text;
}

/** 是否文本块（叶子块：子节点全是行内文本） */
function isTextBlock(node: BookNode): boolean {
  if (isTextNode(node)) {
    return false;
  }
  const children = node.children ?? [];
  if (children.length === 0) {
    return false;
  }
  return children.every(
    (child) => isTextNode(child) || child.type === NODE_TYPES.MATH_INLINE,
  );
}

/** 是否结构节点 */
export function isStructureNode(node: BookNode): boolean {
  return STRUCTURE_NODE_TYPES.has(node.type);
}

/** 结构层级（卷 1 / 章 2 / 节 3 / 其余结构 1） */
export function structureLevelOf(node: BookNode): number {
  return STRUCTURE_LEVELS[node.type] ?? 1;
}

/** 统计字符数（按选项去空白 / 标点） */
function countCharacters(text: string, countPunctuation: boolean): number {
  let count = 0;
  for (const char of text) {
    if (/\s/u.test(char)) {
      continue;
    }
    if (!countPunctuation && PUNCTUATION_PATTERN.test(char)) {
      continue;
    }
    count += 1;
  }
  return count;
}

/** 统计词数（CJK 逐字、拉丁 / 数字连续串计 1 词） */
function countWords(text: string): number {
  let words = 0;
  let inLatinRun = false;
  for (const char of text) {
    if (WORD_CHAR_PATTERN.test(char)) {
      if (!inLatinRun) {
        words += 1;
        inLatinRun = true;
      }
      continue;
    }
    inLatinRun = false;
    if (CJK_PATTERN.test(char)) {
      words += 1;
    }
  }
  return words;
}

/** 递归统计正文字符数（跳过注释子树，注释单独计） */
function collectCharacters(
  node: BookNode,
  mode: NoteCountingMode,
  countPunctuation: boolean,
): { body: number; note: number } {
  if (isTextNode(node)) {
    const text = node.text ?? '';
    return { body: countCharacters(text, countPunctuation), note: 0 };
  }
  if (isNoteNodeType(node.type)) {
    const noteChars = countCharacters(plainTextOf(node), countPunctuation);
    return { body: mode === 'include' ? noteChars : 0, note: noteChars };
  }
  let body = 0;
  let note = 0;
  for (const child of node.children ?? []) {
    const part = collectCharacters(child, mode, countPunctuation);
    body += part.body;
    note += part.note;
  }
  return { body, note };
}

/** 统计叶级块与注释数量 */
function collectBlocksAndNotes(
  node: BookNode,
  counts: NoteCounts,
): number {
  if (isTextNode(node)) {
    return 0;
  }
  if (node.type === NODE_TYPES.FOOTNOTE) {
    counts.footnote += 1;
  } else if (node.type === NODE_TYPES.ENDNOTE) {
    counts.endnote += 1;
  } else if (node.type === NODE_TYPES.MARGIN_NOTE) {
    counts.marginNote += 1;
  }
  const children = node.children ?? [];
  const isLeaf = children.length === 0 && !isStructureNode(node) && node.type !== NODE_TYPES.BOOK;
  let blocks = isTextBlock(node) || isLeaf ? 1 : 0;
  for (const child of node.children ?? []) {
    blocks += collectBlocksAndNotes(child, counts);
  }
  return blocks;
}

/** 收集结构节点字数分布（先序） */
function collectStructures(
  node: BookNode,
  mode: NoteCountingMode,
  countPunctuation: boolean,
  out: StructureStats[],
): void {
  if (isTextNode(node)) {
    return;
  }
  if (isStructureNode(node)) {
    const title = typeof node.attrs?.['title'] === 'string' ? node.attrs['title'] : '';
    const entry: StructureStats = {
      type: node.type,
      title,
      level: structureLevelOf(node),
      characters: collectCharacters(node, mode, countPunctuation).body,
    };
    if (node.id !== undefined) {
      entry.nodeId = node.id;
    }
    out.push(entry);
  }
  for (const child of node.children ?? []) {
    collectStructures(child, mode, countPunctuation, out);
  }
}

/**
 * 统计文档字数 / 阅读时长 / 结构分布
 *
 * 纯函数：不修改入参，结果确定（不受时间 / 语言环境影响）。
 */
export function countDocumentStats(
  document: BookDocument,
  options: DocumentStatsOptions = {},
): DocumentStats {
  const mode = options.notes ?? 'separate';
  const countPunctuation = options.countPunctuation === true;
  const perMinute = options.charsPerMinute ?? DEFAULT_READING_CHARS_PER_MINUTE;

  const { body, note } = collectCharacters(document.root, mode, countPunctuation);
  const noteCounts: NoteCounts = { footnote: 0, endnote: 0, marginNote: 0 };
  const blocks = collectBlocksAndNotes(document.root, noteCounts);
  const structures: StructureStats[] = [];
  collectStructures(document.root, mode, countPunctuation, structures);

  const noteCharacters = mode === 'exclude' ? 0 : note;
  const totalCharacters =
    mode === 'separate'
      ? body + noteCharacters
      : body;
  const readingMinutes =
    perMinute > 0 && body > 0 ? Math.ceil(body / perMinute) : 0;

  return {
    characters: body,
    noteCharacters,
    totalCharacters,
    words: countWords(plainTextOf(document.root)),
    readingMinutes,
    blocks,
    notes: noteCounts,
    structures,
  };
}

/* ---------- 词表检查（敏感词 / 错别字 / 术语可插拔） ---------- */

/** 词表条目 */
export interface WordListEntry {
  /** 检索词（字面匹配，不做分词） */
  term: string;
  /** 建议替换（可选，UI 提示用） */
  suggestion?: string;
  /** 类别（如 `typo` / `sensitive` / `term`，原样回传） */
  kind?: string;
}

/** 词表命中 */
export interface WordListMatch {
  /** 命中块 id（块缺 id 时不返回该字段） */
  nodeId?: string;
  /** 命中的词表条目 */
  term: string;
  /** 建议替换 */
  suggestion?: string;
  /** 类别 */
  kind?: string;
  /** 命中位置锚点（块内纯文本偏移，可直接用于批注 / 高亮 / 定位） */
  anchor?: TextAnchor;
  /** 块内纯文本偏移（与 `anchor.offset` 同值，便于直接切片） */
  offset: number;
  /** 命中上下文摘录（默认前后各 10 字，越界以省略号标记） */
  excerpt: string;
}

/** 词表检查选项 */
export interface WordListCheckOptions {
  /** 大小写敏感（默认 false） */
  caseSensitive?: boolean;
  /** 摘录上下文半径（默认 10） */
  contextLength?: number;
  /** 是否检查注释节点（默认 true） */
  notes?: boolean;
}

/** 构造摘录（命中词前后各取 contextLength 个字符） */
function buildExcerpt(text: string, offset: number, length: number, contextLength: number): string {
  const start = Math.max(0, offset - contextLength);
  const end = Math.min(text.length, offset + length + contextLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/** 在文本块内查找词表命中 */
function collectWordListMatches(
  node: BookNode,
  entries: readonly WordListEntry[],
  options: Required<WordListCheckOptions>,
  out: WordListMatch[],
): void {
  const text = plainTextOf(node);
  if (text.length === 0) {
    return;
  }
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  for (const entry of entries) {
    if (!entry.term) {
      continue;
    }
    const needle = options.caseSensitive ? entry.term : entry.term.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      const match: WordListMatch = {
        term: entry.term,
        offset: index,
        excerpt: buildExcerpt(text, index, entry.term.length, options.contextLength),
      };
      if (node.id !== undefined) {
        match.nodeId = node.id;
        match.anchor = createTextAnchor(node.id, index, entry.term.length);
      }
      if (entry.suggestion !== undefined) {
        match.suggestion = entry.suggestion;
      }
      if (entry.kind !== undefined) {
        match.kind = entry.kind;
      }
      out.push(match);
      index = haystack.indexOf(needle, index + Math.max(1, needle.length));
    }
  }
}

/** 递归收集词表命中（文本块内检索，不跨块） */
function walkWordList(
  node: BookNode,
  entries: readonly WordListEntry[],
  options: Required<WordListCheckOptions>,
  out: WordListMatch[],
): void {
  if (isTextNode(node)) {
    return;
  }
  if (!options.notes && isNoteNodeType(node.type)) {
    return;
  }
  if (isTextBlock(node)) {
    collectWordListMatches(node, entries, options, out);
    return;
  }
  for (const child of node.children ?? []) {
    walkWordList(child, entries, options, out);
  }
}

/**
 * 按词表检查文档（错别字 / 敏感词 / 术语表均可复用）
 *
 * - 只在**文本块内部**做字面匹配（不跨块、不跨行内节点）；
 * - 命中结果按文档先序返回，并附带块内偏移与文本锚点；
 * - 空词表 / 空 term 直接跳过，不报错。
 */
export function checkWordList(
  document: BookDocument,
  entries: readonly WordListEntry[],
  options: WordListCheckOptions = {},
): WordListMatch[] {
  const resolved: Required<WordListCheckOptions> = {
    caseSensitive: options.caseSensitive === true,
    contextLength: options.contextLength ?? 10,
    notes: options.notes !== false,
  };
  const matches: WordListMatch[] = [];
  walkWordList(document.root, entries, resolved, matches);
  return matches;
}
