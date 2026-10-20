/**
 * @bibliotype/layout/html 子路径入口
 *
 * HTML 输出工具：IR → HTML 序列化与书册样式表生成，
 * 由导出器（exporter-epub / exporter-pdf）与 SSR / 服务端 HTML 输出场景消费。
 * 与主入口分离：不需要 HTML 输出的场景（测量、分页计算）不引入这部分代码。
 */
export {
  escapeHtml,
  escapeXml,
  serializeNode,
  stripInvalidXmlChars,
} from './html-serializer.js';
export type { SerializeNodeOptions } from './html-serializer.js';
export { buildBookCss, declarationToCss, flattenCssVariables } from './book-css.js';
export type { BuildBookCssOptions } from './book-css.js';
export { serializePageGutter } from './page-gutter.js';
export { serializePageNotes } from './page-notes.js';
export type { SerializePageNotesOptions } from './page-notes.js';
export { buildFacsimileDecorationCss } from './facsimile-frame-css.js';
export type { BuildFacsimileDecorationCssOptions } from './facsimile-frame-css.js';
export {
  resolveFeatureSelector,
  listFeatureSelectors,
  collectFeatureRules,
  buildFeatureCss,
  translateSideDeclarations,
} from './feature-selectors.js';
export type { BuildFeatureCssOptions, FeatureCssRule } from './feature-selectors.js';
