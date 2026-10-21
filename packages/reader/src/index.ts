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

/* ---------- 目录定位（P3 D6） ---------- */
export {
  outlineKeyOf,
  flattenOutline,
  collectOutlineKeys,
  buildOutlineAnchors,
  findOutlineAnchorAtPage,
} from './outline-query.js';
export type { OutlineKey, OutlineAnchor } from './outline-query.js';


/* ---------- 注释页索引（P3 D9） ---------- */
export { buildNoteAnchors, findNoteAnchor, neighborNoteAnchor } from './note-index.js';
export type { NotePageAnchor, NoteIndexPage } from './note-index.js';

/* ---------- 块提取 ---------- */
export {
  DEFAULT_MEASURE_CONTEXT,
  defaultEstimator,
  collectNodeText,
  extractBlocks,
  extractBlocksIndexed,
  isLeafBlock,
  isLeafBlockTypeName,
} from './document-blocks.js';
export type {
  BlockMeasureContext,
  BlockSizeEstimator,
  ExtractBlocksOptions,
  ExtractedBlocks,
} from './document-blocks.js';

/* ---------- 块解析 ---------- */
export { findNodeById, findNodeTrail } from './find-node.js';

/* ---------- 页眉 / 页脚 ---------- */
export {
  isPageChromeEnabled,
  resolvePageChromeFields,
  resolvePageChromeTexts,
  resolveChapterTitleForNode,
  buildPageChromeIndex,
  isNodeInCover,
} from './page-chrome.js';
export type {
  PageChromeTexts,
  PageChromeIndex,
  ResolvedPageChromeFields,
  ResolvePageChromeInput,
  resolveVolumeTitleForNode,
} from './page-chrome.js';

/* ---------- 版心（书口） ---------- */
export { resolvePageGutterTexts } from './page-gutter.js';
export type { ResolvePageGutterInput } from './page-gutter.js';

/* ---------- 页码 ---------- */
export {
  toChineseNumeral,
  toRomanNumeral,
  formatPageNumber,
} from './page-numbering.js';
export type { PageNumberStyle } from './page-numbering.js';

/* ---------- 阅读位置快照 ---------- */
export {
  READING_POSITION_SCHEMA_VERSION,
  createReadingPosition,
  serializeReadingPosition,
  parseReadingPosition,
  positionAnchorKey,
} from './position.js';
export type { ReadingPosition } from './position.js';

/* ---------- 搜索内核（纯函数，可独立复用） ---------- */
export {
  escapeRegExp,
  buildSearchPattern,
  findMatchRanges,
  buildMatchExcerpt,
  collectSubtreeNodes,
} from './search.js';
export type {
  ReaderSearchOptions,
  ReaderSearchResult,
  TextMatchRange,
  MatchScanResult,
} from './search.js';

/* ---------- 阅读器 ---------- */
export { Reader } from './reader.js';
export type { ReaderOptions, RepaginateOptions } from './reader.js';
