/**
 * @bibliotype/xref 统一导出入口
 *
 * 两遍排版的两块拼图：
 * - 第一遍 `buildPageIndex`：分页结果 → 「节点 id → 页码」；
 * - 第二遍 `resolveReferences`：正文占位 `{{page:id}}` / `{{ref:label}}` → 真实页码。
 *
 * 依赖方向：core（NodeId 类型）→ xref → 导出器 / UX 层。
 */

/* ---------- 类型 ---------- */
export type {
  PageSource,
  PageIndex,
  BuildPageIndexOptions,
  CrossReference,
  PageReferenceMatch,
  PageReferenceOptions,
  LabelReferenceMatch,
} from './types.js';

/* ---------- 第一遍：索引 ---------- */
export {
  buildPageIndex,
  lookupPage,
  serializePageIndex,
  deserializePageIndex,
} from './build.js';

/* ---------- 登记表 ---------- */
export { XREF_SCHEMA_VERSION, CrossReferenceRegistry } from './registry.js';
export type { CrossReferenceSet } from './registry.js';

/* ---------- 第二遍：替换 ---------- */
export {
  PAGE_REFERENCE_PATTERN,
  LABEL_REFERENCE_PATTERN,
  findPageReferences,
  findLabelReferences,
  replacePageReferences,
  replaceLabelReferences,
  resolveReferences,
  hasReferences,
} from './resolve.js';
