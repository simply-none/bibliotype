/**
 * @bibliotype/import-docx 统一导出入口
 *
 * docx 导入：`.docx` → HTML（mammoth）→ BookDocument（复用 @bibliotype/import 的 HTML 通路）。
 * mammoth 为外部重依赖，隔离在本叶子包；使用侧建议按需 `import()` 动态加载以控包体。
 */

/* ---------- docx → HTML（mammoth 边界） ---------- */
export { docxToHtml, normalizeDocxFootnotes } from './docx-html.js';
export type { DocxInput, DocxToHtmlOptions, DocxImageConverter } from './docx-html.js';

/* ---------- docx → BookDocument（组合层） ---------- */
export { docxToBookDocument, docxToBookDocumentWithStyles } from './from-docx.js';
export type { DocxImportResult } from './from-docx.js';

/* ---------- 样式解析 ---------- */
export { DOCX_STYLE_CLASS_PREFIX, DOCX_STYLE_ID_PREFIX, parseDocxStyleInfo } from './docx-styles.js';
export type { DocxStyleInfo } from './docx-styles.js';
