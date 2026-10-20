/**
 * @bibliotype/classical 统一导出入口
 */

/* ---------- 节点与标记类型 ---------- */
export { CLASSICAL_NODE_TYPES } from './node-types.js';
export type { ClassicalNodeType } from './node-types.js';
export { CLASSICAL_MARK_TYPES } from './mark-types.js';
export type { ClassicalMarkType } from './mark-types.js';

/* ---------- 注册定义 ---------- */
export { CLASSICAL_NODE_DEFINITIONS } from './node-definitions.js';

/* ---------- 主题 ---------- */
export {
  CLASSICAL_THEME_TOKENS,
  CLASSICAL_THEME_OVERRIDES,
} from './theme.js';
export type { ClassicalThemeToken } from './theme.js';

/* ---------- 校勘汇总表（K2） ---------- */
export {
  buildCollationSummary,
  collectCollationEntries,
} from './collation-summary.js';
export type {
  CollationSummaryEntry,
  CollationSummaryOptions,
} from './collation-summary.js';

/* ---------- 插件 ---------- */
export { createClassicalPlugin, CLASSICAL_PLUGIN_NAME } from './plugin.js';
