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
  PERF_LAYOUT,
  PERF_MEASURE,
  PERF_AUTOSAVE,
  setPerfProbeEnabled,
  isPerfProbeEnabled,
  perfNow,
  perfRecord,
} from './perf.js';

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
export type {
  PagedBlockLoc,
  PagedIndex,
  PmLeafPos,
  PmLeafInput,
} from './paged-editor/selection-bridge.js';

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
export { default as BtCollationCompare } from './components/BtCollationCompare.vue';
export { default as BtPager } from './components/BtPager.vue';
export { default as BtToc } from './components/BtToc.vue';
export { default as BtTocItem } from './components/BtTocItem.vue';
export { default as BtEditor } from './components/BtEditor.vue';
export { default as BtSelectionReplaceMenu } from './components/BtSelectionReplaceMenu.vue';
export { default as BtTableSizePicker } from './components/BtTableSizePicker.vue';
export { default as PagedCanvas } from './paged-editor/PagedCanvas.vue';
export { default as BtAnnotationSidebar } from './components/BtAnnotationSidebar.vue';
export { useAnnotations } from './use-annotations.js';
export type { UseAnnotations, UseAnnotationsOptions } from './use-annotations.js';
export { buildAnnotationSidebarModel } from './annotation-model.js';
export type { SidebarAnnotation, SidebarChapter } from './annotation-model.js';
export { default as BtDocumentStats } from './components/BtDocumentStats.vue';
export { useDocumentStats } from './use-document-stats.js';
export type { UseDocumentStats, UseDocumentStatsOptions } from './use-document-stats.js';

/* ---------- 书架 / 备份 / 加密（H3–H5） ---------- */
export { default as BtBookShelf } from './components/BtBookShelf.vue';
export { default as BtBackupPanel } from './components/BtBackupPanel.vue';
export { default as BtEncryptionPanel } from './components/BtEncryptionPanel.vue';
export { useBookLibrary, SHELF_VIEW_MODES } from './use-book-library.js';
export type {
  ShelfExportResult,
  ShelfImportResult,
  ShelfViewMode,
  UseBookLibraryOptions,
  UseBookLibraryReturn,
} from './use-book-library.js';
export {
  buildShelfCard,
  buildShelfCards,
  buildTagFacets,
  emptyShelfHint,
  formatRelativeTime,
  formatWordCount,
  normalizeProgress,
  titleGlyph,
} from './book-shelf-model.js';
export type { ShelfCard, TagFacet } from './book-shelf-model.js';

/* ---------- 修订模式（C5） ---------- */
export { default as BtRevisionSidebar } from './components/BtRevisionSidebar.vue';
export { buildRevisionModel, excerptText, revisionCountsText } from './revision-model.js';
export type {
  RevisionCounts,
  RevisionItem,
  RevisionSidebarModel,
} from './revision-model.js';

/* ---------- 历史版本（C7） ---------- */
export { default as BtVersionHistory } from './components/BtVersionHistory.vue';
export {
  VERSION_GROUP_KEYS,
  buildDiffRows,
  buildVersionHistoryModel,
  diffSummaryText,
  versionGroupOf,
  versionTimeText,
} from './version-model.js';
export type {
  DiffRow,
  VersionGroup,
  VersionGroupKey,
  VersionHistoryModel,
  VersionItem,
} from './version-model.js';

export { placeFloating } from './floating-position.js';
export type { FloatingPlacement, FloatingRect, FloatingSize } from './floating-position.js';
export { useSelectionReplace } from './use-selection-replace.js';
export type {
  ReplaceTargetGroup,
  ReplaceTargetItem,
  SelectionReplaceState,
  UseSelectionReplaceOptions,
} from './use-selection-replace.js';

export { createBibliotype } from './plugin.js';
