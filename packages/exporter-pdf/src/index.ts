/**
 * @bibliotype/exporter-pdf 统一导出入口
 */
export { findNodeById } from '@bibliotype/reader';
export { buildPrintCss, resolveBleedPx } from './print-styles.js';
export type { PrintCssOptions, PrintFacingOptions, PrintMode } from './print-styles.js';
export { renderPrintHtml, createPrintPager } from './print-document.js';
export type { PrintDocumentOptions, PrintPager } from './print-document.js';
export { exportRasterPdf } from './raster-pdf.js';
export type { RasterPdfOptions } from './raster-pdf.js';
export {
  dedupeInlineImages,
  rehydrateInlineImages,
  INLINE_IMAGE_TOKEN_PREFIX,
} from './image-dedup.js';
export type {
  DedupeInlineImagesOptions,
  DedupeInlineImagesResult,
  InlineImageAsset,
} from './image-dedup.js';
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
