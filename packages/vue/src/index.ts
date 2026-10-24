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

/* ---------- 多形态阅读（P3 D5） ---------- */
export { default as BtSpreadLayout } from './components/BtSpreadLayout.vue';
export { default as BtCompareView } from './components/BtCompareView.vue';
export { usePrefersReducedMotion } from './prefers-reduced-motion.js';
export {
  adjustScrollOffset,
  estimateFlowChunkHeight,
  resolveAnchorChunkIndex,
  resolveMountWindow,
} from './flow-model.js';
export type { FlowMetrics, FlowMountWindow } from './flow-model.js';

/* ---------- 目录增强（D6） ---------- */
export { default as BtSidebarResizer } from './components/BtSidebarResizer.vue';
export { useTocView, TOC_ROW_KEY_ATTRIBUTE } from './use-toc-view.js';
export type { UseTocView, UseTocViewOptions } from './use-toc-view.js';
export { buildTocViewItems, splitTocTitle, toggleTocExpanded } from './toc-model.js';
export type { BuildTocViewOptions, TocTitleSegment, TocViewItem } from './toc-model.js';
export {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_STEP,
  clampSidebarWidth,
  stepSidebarWidth,
} from './sidebar-width.js';
export type { SidebarWidthRange } from './sidebar-width.js';

/* ---------- 注释交互（D9） ---------- */
export { default as BtNotePreview } from './components/BtNotePreview.vue';
export { useNoteInteraction, NOTE_ACTIVE_CLASS } from './use-note-interaction.js';
export type {
  NotePreviewState,
  UseNoteInteraction,
  UseNoteInteractionOptions,
} from './use-note-interaction.js';

/* ---------- 图片放大查看 ---------- */
export { default as BtImageLightbox } from './components/BtImageLightbox.vue';
export { resolveImageTarget, useImageLightbox } from './use-image-lightbox.js';
export type { LightboxImage, UseImageLightbox } from './use-image-lightbox.js';

/* ---------- 主题与外观（D10） ---------- */
export { default as BtThemePanel } from './components/BtThemePanel.vue';
export { default as BtFontFallbackPanel } from './components/BtFontFallbackPanel.vue';
export {
  useThemePresets,
  TYPOGRAPHY_THEME_TOKENS,
  CUSTOM_THEME_PRESET_ID,
  THEME_COLOR_TOKENS,
} from './use-theme-presets.js';
export type { UseThemePresets, UseThemePresetsOptions } from './use-theme-presets.js';
export { createFontCheckProbe, splitFontFamilyList } from './font-probe.js';

/* ---------- 句读 / 专名建议（K3） ---------- */
export { default as BtAnnotationSuggestions } from './components/BtAnnotationSuggestions.vue';
export { useAnnotationSuggestions } from './use-annotation-suggestions.js';
export type {
  SuggestionApplyHandlers,
  SuggestionDecision,
  SuggestionFilter,
  SuggestionOverride,
  UseAnnotationSuggestions,
  UseAnnotationSuggestionsOptions,
} from './use-annotation-suggestions.js';

/* ---------- 缺字审计（K6） ---------- */
export { default as BtGlyphAuditPanel } from './components/BtGlyphAuditPanel.vue';
export { useGlyphAudit } from './use-glyph-audit.js';
export type { UseGlyphAudit, UseGlyphAuditOptions } from './use-glyph-audit.js';

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

/* ---------- H5 UI 改造（D1 断点 / D2 触控 / D5 滚动锁 / C1 抽屉） ---------- */
export {
  BT_BREAKPOINTS,
  BT_TOUCH_TARGET_MIN,
  resolveBreakpointName,
} from './breakpoints.js';
export type { BreakpointName } from './breakpoints.js';
export { useBreakpoint } from './use-breakpoint.js';
export type { BreakpointHost, UseBreakpoint, UseBreakpointOptions } from './use-breakpoint.js';
export { useScrollLock } from './use-scroll-lock.js';
export type { UseScrollLock, UseScrollLockOptions } from './use-scroll-lock.js';
export { default as BtDrawer } from './components/BtDrawer.vue';

/* ---------- 图片 / 长图导出（E7） ---------- */
export {
  DEFAULT_PAGE_IMAGE_OPTIONS,
  canvasToBytes,
  chapterFolderName,
  composeLongImage,
  createDomPageCapture,
  createStoredZip,
  exportChapterImages,
  exportLongImage,
  layoutLongImage,
  pageFileName,
  planChapterImages,
  resolvePageImageOptions,
  resolvePagePixelSize,
  sanitizeImagePathSegment,
  waitForFonts,
} from './image-export.js';
export type {
  CapturedPageImage,
  ChapterImageExportOptions,
  ChapterImageExportResult,
  ChapterImagePlan,
  ChapterPlanOptions,
  DomPageCaptureOptions,
  ImageCaptureSourceOptions,
  ImageExportFormat,
  ImageExportProgress,
  LongImageChapterInput,
  LongImageExportOptions,
  LongImageExportResult,
  LongImageLayout,
  LongImageLayoutOptions,
  LongImageOptions,
  LongImagePageImage,
  LongImagePagePlacement,
  LongImageSeparatorPlacement,
  PageCapture,
  PageImageInfo,
  PageImageOptions,
  ResolvedPageImageOptions,
  ZipFileInput,
} from './image-export.js';
