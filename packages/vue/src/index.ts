/**
 * @bibliotype/vue 统一导出入口
 */
export { useReader, useReaderBinding } from './use-reader.js';
export type { ReaderBinding, UseReaderReturn } from './use-reader.js';

export { useEditorBinding } from './use-editor.js';
export type { EditorBinding, EditorBindingOptions } from './use-editor.js';

export { measureBlockSizes, measurePagination, disposeMeasureSheet } from './pagination-measure.js';
export type { MeasureBlockSizesInput, MeasurePaginationResult } from './pagination-measure.js';

export {
  buildPagedLayout,
  usePagedLayout,
  collectPmLeafPositions,
} from './paged-editor/use-paged-layout.js';
export type {
  PagedFragment,
  PagedPage,
  BuildPagedInput,
  BuildPagedResult,
  UsePagedLayoutOptions,
  UsePagedLayoutReturn,
} from './paged-editor/use-paged-layout.js';

export {
  buildPagedIndex,
  charOfLine,
  blockCharToPm,
  pmToBlockChar,
  fragmentCharToBlockChar,
  resolveFragmentRange,
  resolveFragmentPoint,
  locatePmPosition,
} from './paged-editor/selection-bridge.js';
export type { PagedBlockLoc, PagedIndex } from './paged-editor/selection-bridge.js';

export {
  applyFragmentEdit,
  applyFragmentSplit,
  applyFragmentSelection,
} from './paged-editor/edit-applier.js';

export {
  fragStartChar,
  blockFragments,
  resolveCaretTarget,
  fragTextNodes,
  fragPlainText,
  charOffsetInFrag,
  domPosInFrag,
  diffTextReplace,
  fragSelection,
} from './paged-editor/input-router.js';
export type { FragSel, CaretTarget } from './paged-editor/input-router.js';

export { default as BtBookView } from './components/BtBookView.vue';
export { default as BtPager } from './components/BtPager.vue';
export { default as BtToc } from './components/BtToc.vue';
export { default as BtTocItem } from './components/BtTocItem.vue';
export { default as BtEditor } from './components/BtEditor.vue';
export { default as PagedCanvas } from './paged-editor/PagedCanvas.vue';

export { createBibliotype } from './plugin.js';
