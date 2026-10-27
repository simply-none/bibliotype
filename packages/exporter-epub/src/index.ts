/**
 * @bibliotype/exporter-epub 统一导出入口
 */
export { EPUB_MIMETYPE, buildContainerXml, exportEpub } from './epub.js';
export type { EpubExportOptions } from './epub.js';
export { exportEpubVolumes } from './volumes.js';
export type { EpubVolumeOutput } from './volumes.js';
export { buildDefaultIdentifier, fnv1a, isIsbn, normalizeIdentifier, resolveIdentifier } from './identifier.js';
export { groupEndnotes } from './endnotes.js';
export type { EndnoteGrouping, EndnoteGroupingOptions } from './endnotes.js';
export {
  DEFAULT_MAX_SECTION_BYTES,
  FRONT_MATTER_TYPES,
  MAX_NAV_HEADING_LEVEL,
  MAX_SPLIT_HEADING_LEVEL,
  SECTION_TYPES,
  buildNavItems,
  frontMatterEpubType,
  planDocument,
  splitSections,
} from './sections.js';
export type {
  DocumentPlan,
  NavItem,
  SectionPlan,
  SerializeOptions,
  SplitResult,
  SplitSectionsOptions,
} from './sections.js';
export { buildNavXhtml } from './nav.js';
export type { NavLandmark, NavXhtmlInput } from './nav.js';
export { buildOpf, contributorRoleCode, normalizeModified } from './opf.js';
export type { OpfGuideReference, OpfInput, OpfManifestItem } from './opf.js';
export { buildNcx } from './ncx.js';
export type { NcxInput } from './ncx.js';
export { renderXhtmlDocument } from './xhtml.js';
export type { XhtmlDocumentInput } from './xhtml.js';
export {
  MAX_MEDIA_BYTES,
  MediaCollector,
  mediaManifestItem,
  parseDataImageUri,
  sniffImageMediaType,
} from './media.js';
export type { MediaItem, MediaProblem, ParsedDataUri } from './media.js';
export { checkWellFormedXml, validateEpub } from './validate.js';
export type { ProblemSeverity, ValidateEpubInput, ValidationProblem } from './validate.js';
export { VALIDATE_CLI_USAGE, runValidateCli } from './cli.js';
export type { ValidateCliIo, ValidateCliResult } from './cli.js';
export { collectEpubGlyphProblems } from './glyph-report.js';
export type { EpubGlyphCheckOptions } from './glyph-report.js';
