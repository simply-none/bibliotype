/**
 * @bibliotype/reader 统一导出入口
 */

/* ---------- 目录 ---------- */
export {
  OUTLINE_STRUCTURE_TYPES,
  OUTLINE_HEADING_TYPE,
  extractOutline,
  resolveNodeTitle,
  countOutlineItems,
} from './outline.js';
export type { OutlineItem, ExtractOutlineOptions } from './outline.js';

/* ---------- 块提取 ---------- */
export {
  DEFAULT_MEASURE_CONTEXT,
  defaultEstimator,
  collectNodeText,
  extractBlocks,
} from './document-blocks.js';
export type {
  BlockMeasureContext,
  BlockSizeEstimator,
  ExtractBlocksOptions,
} from './document-blocks.js';

/* ---------- 页码 ---------- */
export {
  toChineseNumeral,
  toRomanNumeral,
  formatPageNumber,
} from './page-numbering.js';
export type { PageNumberStyle } from './page-numbering.js';

/* ---------- 阅读器 ---------- */
export { Reader } from './reader.js';
export type { ReaderOptions, RepaginateOptions } from './reader.js';
