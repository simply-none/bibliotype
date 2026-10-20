/**
 * @bibliotype/import 统一导出入口
 *
 * 基础文档导入：Markdown / HTML → BookDocument（零外部重依赖，复用 editor 转换层）。
 * 二进制格式（docx / epub）由 @bibliotype/import-docx / @bibliotype/import-epub 提供。
 */

/* ---------- 文档组装（块节点 → BookDocument） ---------- */
export { nodesToBookDocument } from './book-document.js';

/* ---------- 文本格式转换 ---------- */
export { markdownToBookDocument } from './from-markdown.js';
export { htmlToBookDocument } from './from-html.js';
export { DEFAULT_TXT_CHAPTER_PATTERN, txtToBookDocument } from './from-text.js';
export type { TxtImportOptions } from './from-text.js';

/* ---------- 格式检测与分发 ---------- */
export { detectImportFormat, importFromText } from './format.js';
export type { ImportFormat } from './format.js';

/* ---------- 元数据卫生 ---------- */
export { sanitizeBookTitle, titleFromFilename } from './title.js';
