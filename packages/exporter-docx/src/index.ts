/**
 * @bibliotype/exporter-docx 统一导出入口
 *
 * 用法：
 * ```ts
 * import { exportDocx } from '@bibliotype/exporter-docx';
 * const bytes = await exportDocx(book, { bodyFontFamily: '宋体' });
 * ```
 */
export { buildDocxDocument, exportDocx } from './document.js';
export {
  DEFAULT_BODY_FONT,
  DEFAULT_BODY_FONT_SIZE_PT,
  DEFAULT_FIRST_LINE_INDENT_CHARS,
  DEFAULT_HEADING_FONT,
  DEFAULT_MARGINS_MM,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_PAGE_SIZE_MM,
  contentWidthMm,
  resolveOptions,
} from './options.js';
export {
  CODE_FONT,
  STYLE_IDS,
  buildDocxStyles,
  declarationsToProps,
  namedWordStyleId,
  ptToTwips,
  readStyleId,
  toWordStyleId,
} from './styles.js';
export { decodeImageSrc, displaySize, imageAltText, sniffImage, sniffImageType } from './images.js';
export type { DecodedImage, ImageDecodeResult, ImageDisplaySize, ImageProblemCode, SupportedImageType } from './images.js';
export { cleanText } from './inline.js';
export { buildBlocks, FOOTNOTE_TEXT_STYLE } from './blocks.js';
export type { BlockBuildOptions } from './blocks.js';
export { collectReferencedNoteIds, createExportContext } from './context.js';
export type { ExportContext } from './context.js';
export type {
  BuiltDocxDocument,
  DocxExportOptions,
  DocxProblem,
  DocxProblemCode,
  DocxRevisionView,
  PageMarginsMm,
  PageSizeMm,
  ResolvedDocxOptions,
} from './types.js';
