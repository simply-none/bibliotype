/**
 * 字体内嵌与子集化（E3）
 *
 * 按用字统计把字体子集化，并生成 `@font-face` / 许可声明，供 EPUB 与站点
 * 导出共用。子集化本身由宿主注入后端（`subset-font` / `fonttools`），本包
 * 不含字体解析二进制。
 */
export { collectDocumentChars, collectNodeChars } from './collect.js';
export { buildFontFaceCss, buildFontFaceRule } from './css.js';
export type { FontFaceCssOptions } from './css.js';
export {
  buildFontFileName,
  createPreparedFace,
  fontFileExtension,
  fontFormatKeyword,
  fontMediaType,
  normalizeFontDirectory,
  sanitizeFontSlug,
  sniffFontFormat,
} from './format.js';
export {
  coverageIncompleteWarning,
  isFallbackCovered,
  resolveFallbackChain,
  splitFontFamilyStack,
} from './fallback.js';
export { FONT_LICENSE_FILE, buildFontLicenseText, buildFontRightsLine } from './license.js';
export { prepareFontBundle } from './subset.js';
export type {
  CharUsage,
  FontAssetInput,
  FontBundle,
  FontCoverageReport,
  FontFamilyReport,
  FontFormat,
  FontLicense,
  FontSubsetBackend,
  FontSubsetRequest,
  FontSubsetResult,
  PrepareFontBundleOptions,
  PreparedFontFace,
} from './types.js';
