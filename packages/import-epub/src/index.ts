/**
 * @bibliotype/import-epub 统一导出入口
 *
 * epub 导入：`.epub`（zip + OPF + XHTML）→ BookDocument（复用 @bibliotype/import 的 HTML 通路）。
 * 解包与 XML 结构读取（fflate + @xmldom/xmldom）浏览器与 Node 同构；XHTML → IR 复用 import。
 */

/* ---------- epub → 正文 HTML（DOM 无关，同构） ---------- */
export {
  epubToHtml,
  extractBodiesHtml,
  findOpfPath,
  readContentPaths,
  readMediaTypes,
  unzipEpub,
} from './epub-package.js';
export type {
  EpubFiles,
  EpubToHtmlOptions,
  ExtractBodiesOptions,
} from './epub-package.js';

/* ---------- 目录源（nav.xhtml / toc.ncx → 层级目录树） ---------- */
export { readToc } from './toc-read.js';
export type { EpubImportReport, TocEntry, TocPlan } from './toc-types.js';

/* ---------- epub → BookDocument（组合层） ---------- */
export { epubToBookDocument } from './from-epub.js';
export type { EpubInput } from './epub-package.js';
