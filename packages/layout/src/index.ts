/**
 * @bibliotype/layout 统一导出入口
 */

/* ---------- 书写方向 ---------- */
export { WRITING_MODES, TEXT_ORIENTATIONS, isVerticalMode } from './writing-mode.js';
export type { WritingMode, TextOrientation } from './writing-mode.js';

/* ---------- 页面尺寸 ---------- */
export { PAGE_SIZES, createPageSize, resolveContentBox } from './page-size.js';
export type { PageSize, ContentBoxSize, PageMarginBox } from './page-size.js';

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

/* ---------- 竖排文字细节（B7） ---------- */
export {
  VERTICAL_PUNCTUATION_FORMS,
  VERTICAL_DIGIT_STYLES,
  verticalPunctuationOf,
  toVerticalPunctuation,
  toKanjiDigits,
  toFullwidthDigits,
  transformVerticalText,
  needsVerticalTextTransform,
} from './vertical-text.js';
export type { VerticalDigitStyle, VerticalTextOptions } from './vertical-text.js';

/* ---------- 布局配置 ---------- */
export {
  PAGE_NUMBER_STYLES,
  PAGE_CHROME_FIELDS,
  DEFAULT_PAGE_CHROME,
  DEFAULT_BOTTOM_SLACK,
  DEFAULT_LAYOUT_OPTIONS,
  CLASSICAL_LAYOUT_OPTIONS,
  FACSIMILE_BASE_LAYOUT,
  mergeLayoutOptions,
} from './layout-options.js';
export type {
  PageNumberStyle,
  PageChromeField,
  PageChromeOptions,
  BottomSlackOptions,
  LayoutOptions,
} from './layout-options.js';

/* ---------- 古籍仿真版式（与「古籍直排」并列，缺省不启用） ---------- */
export {
  FACSIMILE_FRAMES,
  FACSIMILE_RULES,
  GUTTER_SIDES,
  GUTTER_MOUTHS,
  GUTTER_FISH_TAILS,
  FACSIMILE_FONT_TOKENS,
  DEFAULT_GUTTER_FIELDS,
  DEFAULT_FACSIMILE_OPTIONS,
  isFacsimileEnabled,
} from './facsimile.js';
export type {
  FacsimileFrame,
  FacsimileRule,
  FacsimileOptions,
  FacsimileGutterOptions,
  FacsimileFontToken,
  GutterSide,
  GutterMouth,
  GutterFishTail,
  PageGutterTexts,
} from './facsimile.js';

/* ---------- 古籍仿真几何与行款 ---------- */
export {
  resolveFacsimileFrameThickness,
  resolveFacsimileGutterSize,
  resolveLinePitch,
  resolveFacsimileGrid,
  resolveFrameInsets,
  resolveRuleInsets,
  resolveFacsimileCssVariables,
} from './facsimile-geometry.js';
export type { FacsimileFrameThickness, FacsimileGrid } from './facsimile-geometry.js';

/* ---------- 古籍仿真版式模板 ---------- */
export {
  FACSIMILE_PRESETS,
  DEFAULT_FACSIMILE_PRESET_ID,
  resolveFacsimilePreset,
  applyFacsimilePreset,
} from './facsimile-presets.js';
export type { FacsimilePreset } from './facsimile-presets.js';

/* ---------- 印章印谱 SVG（K5） ---------- */
export { renderSealSvg } from './svg/seal.js';
export type { SealBorder, SealLayout, SealStyle, SealSvgOptions } from './svg/seal.js';

/* ---------- IDS 缺字合成 SVG（K6） ---------- */
export { renderIdsSvg, renderIdsGlyphHtml } from './svg/ids-glyph.js';
export type { IdsGlyphOptions } from './svg/ids-glyph.js';

/* ---------- 排版度量签名（决定是否需要重新分页） ---------- */
export { computeMetricsSignature } from './metrics-signature.js';
export type { MetricsSignatureInput } from './metrics-signature.js';

/* ---------- 样式构建 ---------- */
export {
  buildRootStyle,
  buildPageStyle,
  buildCssVariables,
  resolvePageMainSize,
  resolvePageCrossSize,
  resolveBottomSlack,
  resolvePageMarginBox,
  resolvePageMargins,
  resolvePageBorderWidth,
} from './style-builder.js';
export type { StyleDeclaration, BuildRootStyleInput } from './style-builder.js';

/* ---------- 行级切片（纸书跨页片段渲染契约） ---------- */
export { sliceNodeByCharRange } from './node-slice.js';

/* ---------- 分页 ---------- */
export {
  paginate,
  blockAxisOf,
  lineCountOfBlock,
  lineMainSizeAt,
  lineRangeMainSize,
} from './paginator.js';
export type {
  BlockAxis,
  MeasurableBlock,
  NoteAreaOptions,
  PageItem,
  PaginatedPage,
  PaginateOptions,
  PaginateResume,
  PaginationResult,
  WidowControl,
} from './paginator.js';
