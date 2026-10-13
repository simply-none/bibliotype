/**
 * 导入格式检测与文本格式分发
 *
 * 定位：面向使用侧的「按格式路由」入口——从文件名 / MIME 判定格式，
 * 并把**文本类**格式（markdown / html）路由到本包对应转换；
 * **二进制**格式（docx / epub）不在本包实现，给出明确指向（重依赖隔离在对应叶子包）。
 */
import type { BookDocument, BookMetadata } from '@bibliotype/core';
import type { Schema } from 'prosemirror-model';
import { htmlToBookDocument } from './from-html.js';
import { markdownToBookDocument } from './from-markdown.js';

/** 可识别的导入格式 */
export type ImportFormat = 'markdown' | 'html' | 'docx' | 'epub' | 'unknown';

/** 扩展名 → 格式（小写、不含点） */
const EXT_FORMATS: Record<string, ImportFormat> = {
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mdwn: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  docx: 'docx',
  epub: 'epub',
};

/** MIME 主类型 → 格式（小写） */
const MIME_FORMATS: Record<string, ImportFormat> = {
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/**
 * 依据文件名或 MIME 判定导入格式
 *
 * @param nameOrMime 文件名（含扩展名）或 MIME 类型（可带 `;` 参数）
 * @returns 识别到的格式；无法识别返回 `'unknown'`
 */
export function detectImportFormat(nameOrMime: string): ImportFormat {
  const raw = nameOrMime.trim().toLowerCase();
  if (raw === '') {
    return 'unknown';
  }
  // 含 '/' 视为 MIME：取主类型（丢弃参数）后查表
  if (raw.includes('/')) {
    const mime = raw.split(';')[0]?.trim() ?? '';
    return MIME_FORMATS[mime] ?? 'unknown';
  }
  // 否则按扩展名（无扩展名时整体当作扩展尝试）
  const dot = raw.lastIndexOf('.');
  const ext = dot >= 0 ? raw.slice(dot + 1) : raw;
  return EXT_FORMATS[ext] ?? 'unknown';
}

/**
 * 从文本内容导入为 BookDocument（仅 markdown / html）
 *
 * @param text 文本内容
 * @param format 目标格式（由 `detectImportFormat` 或调用方给出）
 * @param schema 编辑器 schema
 * @param metadata 书目元数据（由调用方注入）
 * @throws docx / epub 走二进制入口，指向对应包；`unknown` 无法处理
 */
export function importFromText(
  text: string,
  format: ImportFormat,
  schema: Schema,
  metadata: BookMetadata,
): BookDocument {
  switch (format) {
    case 'markdown':
      return markdownToBookDocument(text, schema, metadata);
    case 'html':
      return htmlToBookDocument(text, schema, metadata);
    case 'docx':
      throw new RangeError('docx 为二进制格式，请使用 @bibliotype/import-docx 的 docxToBookDocument。');
    case 'epub':
      throw new RangeError('epub 为二进制格式，请使用 @bibliotype/import-epub 的 epubToBookDocument。');
    default:
      throw new RangeError('无法识别的导入格式（unknown），请检查文件扩展名或 MIME 类型。');
  }
}
