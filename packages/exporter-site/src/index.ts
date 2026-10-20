/**
 * @bibliotype/exporter-site 统一导出入口
 *
 * IR → 静态站点（多页 HTML + 目录 + 样式 + 搜索索引），纯函数、无 IO。
 * 依赖方向：core + layout（序列化与书册样式）→ exporter-site。
 */

/* ---------- 类型 ---------- */
export type {
  SiteFile,
  SiteSection,
  SiteSearchEntry,
  SiteExportOptions,
  SiteExportResult,
} from './types.js';

/* ---------- 编排 ---------- */
export { exportSite, DEFAULT_SITE_CONTAINER, DEFAULT_MAX_SECTIONS } from './export.js';

/* ---------- 分节规划 ---------- */
export { SITE_STRUCTURE_TYPES, isStructureNode, resolveSectionTitle, planSections } from './plan.js';
export type { PlannedSection, SectionPlan } from './plan.js';

/* ---------- 渲染 ---------- */
export { renderSectionPage, renderIndexPage, buildSiteCss } from './render.js';
export type { NavTarget, SectionPageInput, IndexPageInput, SiteCssInput } from './render.js';

/* ---------- 搜索索引 ---------- */
export {
  SITE_SEARCH_INDEX_VERSION,
  normalizeSearchText,
  buildSearchEntry,
  serializeSearchIndex,
} from './search.js';
export type { SiteSearchIndex } from './search.js';
