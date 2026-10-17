/**
 * @bibliotype/layout 统一导出入口
 */

/* ---------- 书写方向 ---------- */
export { WRITING_MODES, TEXT_ORIENTATIONS, isVerticalMode } from './writing-mode.js';
export type { WritingMode, TextOrientation } from './writing-mode.js';

/* ---------- 页面尺寸 ---------- */
export { PAGE_SIZES, createPageSize, resolveContentBox } from './page-size.js';
export type { PageSize, ContentBoxSize } from './page-size.js';

/* ---------- 直排数字/英文合并（D3 补充） ---------- */
export {
  SEGMENT_KINDS,
  DEFAULT_COMBINE_OPTIONS,
  segmentForVertical,
  combineUprightCss,
  needsCombineUpright,
} from './combine-upright.js';
export type {
  SegmentKind,
  CombineUprightOptions,
  TextSegment,
} from './combine-upright.js';

/* ---------- 布局配置 ---------- */
export {
  PAGE_NUMBER_STYLES,
  DEFAULT_LAYOUT_OPTIONS,
  CLASSICAL_LAYOUT_OPTIONS,
  mergeLayoutOptions,
} from './layout-options.js';
export type { PageNumberStyle, LayoutOptions } from './layout-options.js';

/* ---------- 样式构建 ---------- */
export {
  buildRootStyle,
  buildPageStyle,
  buildCssVariables,
  resolvePageMainSize,
  resolvePageMargins,
  resolvePageBorderWidth,
} from './style-builder.js';
export type { StyleDeclaration, BuildRootStyleInput } from './style-builder.js';

/* ---------- 行级切片（纸书跨页片段渲染契约） ---------- */
export { sliceNodeByCharRange } from './node-slice.js';

/* ---------- 分页 ---------- */
export { paginate } from './paginator.js';
export type {
  MeasurableBlock,
  PageItem,
  PaginatedPage,
  PaginateOptions,
  PaginateResume,
  PaginationResult,
  WidowControl,
} from './paginator.js';
