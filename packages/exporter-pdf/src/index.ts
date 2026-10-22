/**
 * @bibliotype/exporter-pdf 统一导出入口
 */
export { findNodeById } from '@bibliotype/reader';
export { buildPrintCss, resolveBleedPx } from './print-styles.js';
export type { PrintCssOptions, PrintFacingOptions, PrintMode } from './print-styles.js';
export { renderPrintHtml } from './print-document.js';
export type { PrintDocumentOptions } from './print-document.js';
export { printBook, printHtml } from './print.js';
export type { PrintHtmlOptions } from './print.js';
export {
  createImageBlobRewriter,
  downloadPdf,
  exportPdfBytes,
} from './pdf-export.js';
export type {
  ExportPdfOptions,
  ImageBlobRewriter,
  PdfAdapterOptions,
  PdfExportAdapter,
} from './pdf-export.js';
export { collectPdfGlyphProblems, summarizePdfGlyphProblems } from './glyph-report.js';
export type { PdfGlyphCheckOptions } from './glyph-report.js';
export {
  collectPdfImageProblems,
  decodeImageDataUri,
  readImagePixelSize,
  summarizePdfImageProblems,
} from './print-image.js';
export type {
  ImagePixelSize,
  PdfImageCheckOptions,
  PrintImageFormat,
  PrintImageIssue,
  PrintImageIssueCode,
} from './print-image.js';
export { collectPrintColorAdvice, summarizePrintColorAdvice } from './print-color.js';
export type {
  PrintColorAdvice,
  PrintColorAdviceCode,
  PrintColorCheckOptions,
} from './print-color.js';
