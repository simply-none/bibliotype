/**
 * @bibliotype/core 统一导出入口
 *
 * 模块划分（原子化，职责单一）：
 * - ir/      中间表示：类型、节点、标记、元数据、文档
 * - events/  类型化事件总线
 * - node/    节点类型定义与注册表
 * - plugin/  插件接口与注册表
 * - theme/   主题令牌与默认值
 */

/* ---------- 版本 ---------- */
export { VERSION } from './version.js';

/* ---------- 性能探针（I7） ---------- */
export {
  NOOP_PROFILER,
  PERF_PHASES,
  createCollectingProfiler,
  createNoopProfiler,
  profilerOrNoop,
} from './perf/profiler.js';
export type {
  CollectingProfiler,
  PerfLabels,
  PerfPhase,
  PerfReport,
  Profiler,
  ProfilerSpan,
} from './perf/profiler.js';
export type { PerfSpanStats } from './perf/profiler.js';

/* ---------- 统一错误（I8） ---------- */
export {
  BibliotypeError,
  deserializeBibliotypeError,
  isBibliotypeError,
  serializeBibliotypeError,
} from './errors/bibliotype-error.js';
export { BIBLIOTYPE_ERROR_CODES } from './errors/error-codes.js';
export type {
  BibliotypeErrorOptions,
  SerializedBibliotypeError,
} from './errors/bibliotype-error.js';
export type { BibliotypeErrorCode } from './errors/error-codes.js';

/* ---------- IR ---------- */
export type { NodeId, Timestamp, AttrValue, Attrs, TextRange } from './ir/types.js';
export { NODE_TYPES, MARK_TYPES } from './ir/node-types.js';
export type { CoreNodeType, CoreMarkType } from './ir/node-types.js';
export type { BookNode, BookMark } from './ir/nodes.js';
export { isTextNode, readAttr } from './ir/nodes.js';
export {
  CLASSICAL_DIVISIONS,
  EDITION_TYPES,
} from './ir/metadata.js';
export type {
  BookMetadata,
  ClassicalCategory,
  ClassicalDivision,
  Contributor,
  EditionInfo,
  EditionType,
  Identifier,
  PublicationInfo,
} from './ir/metadata.js';
export {
  validateMetadata,
  isClassicalDivision,
  isEditionType,
} from './metadata-validation.js';
export type { MetadataIssue } from './metadata-validation.js';
export {
  toDublinCore,
  serializeDublinCore,
  toCnmarc,
} from './metadata-mapping.js';
export type { DublinCoreRecord } from './metadata-mapping.js';
export { migrateLegacyMetadata } from './metadata-migration.js';
export type { BookDocument } from './ir/document.js';
export { IR_SCHEMA_VERSION, createEmptyDocument, isBookDocument } from './ir/document.js';
export {
  buildIndexAppendix,
  buildIndexEntries,
  collectIndexTerms,
  formatIndexRanges,
} from './ir/index-terms.js';
export type {
  BuildIndexAppendixOptions,
  BuildIndexEntriesOptions,
  IndexEntry,
  IndexTermOccurrence,
} from './ir/index-terms.js';

/* ---------- 锚点（跨能力的位置契约） ---------- */
export { ANCHOR_TYPES, ANCHOR_PREFIX } from './ir/anchor.js';
export type {
  AnchorType,
  BlockAnchor,
  TextAnchor,
  Anchor,
  ResolvedAnchor,
} from './ir/anchor.js';
export {
  createBlockAnchor,
  createTextAnchor,
  isAnchor,
  serializeAnchor,
  parseAnchor,
  nodePlainText,
  locateNode,
  clampAnchor,
  resolveAnchor,
} from './ir/anchor.js';
export type { ExportComment } from './ir/export-comment.js';
export { evaluateCondition, isValidConditionExpression } from './ir/condition.js';
export type { ConditionContext } from './ir/condition.js';

/* ---------- IR 校验与版本迁移 ---------- */
export { DOCUMENT_ISSUE_CODES, validateDocument } from './ir/validate.js';
export type {
  DocumentIssue,
  DocumentIssueCode,
  DocumentIssueSeverity,
  ValidateOptions,
  ValidationResult,
} from './ir/validate.js';
export {
  LEGACY_SCHEMA_VERSION,
  BUILTIN_MIGRATIONS,
  MigrationPathError,
  readSchemaVersion,
  migrateDocument,
} from './ir/migrate.js';
export type { MigrationStep, MigrateOptions, MigrateResult, RawBookDocument } from './ir/migrate.js';

/* ---------- 注释节点（脚注 / 尾注 / 边注） ---------- */
export {
  NOTE_ROLES,
  NOTE_NODE_TYPES,
  NOTE_LABEL_STYLES,
  isNoteNodeType,
  isNoteNode,
  noteRoleOf,
  formatNoteLabel,
  collectNotes,
  nextNoteIndex,
} from './ir/notes.js';
export type { NoteRole, NoteLabelStyle, NoteEntry, CollectNotesOptions } from './ir/notes.js';

/* ---------- 术语一致性 ---------- */
export { checkGlossary, validateGlossary } from './ir/glossary.js';
export type {
  GlossaryTerm,
  GlossaryTermUsage,
  GlossaryVariantUsage,
  GlossaryCheckOptions,
  GlossaryReport,
} from './ir/glossary.js';

/* ---------- 文档统计与词表检查 ---------- */
export {
  DEFAULT_READING_CHARS_PER_MINUTE,
  countDocumentStats,
  checkWordList,
  isStructureNode,
  structureLevelOf,
} from './ir/document-stats.js';
export type {
  DocumentStats,
  DocumentStatsOptions,
  NoteCountingMode,
  NoteCounts,
  StructureStats,
  WordListEntry,
  WordListMatch,
  WordListCheckOptions,
} from './ir/document-stats.js';

/* ---------- 事件 ---------- */
export type { BibliotypeEventMap, BibliotypeEventName } from './events/event-map.js';
export type { EventHandler, Unsubscribe } from './events/event-bus.js';
export { EventBus, createEventBus } from './events/event-bus.js';

/* ---------- 节点注册 ---------- */
export type { NodeKind, NodeTypeDefinition } from './node/node-type.js';
export { NAMESPACES } from './node/node-type.js';
export { NodeTypeRegistry, NodeTypeConflictError } from './node/node-registry.js';
export { CORE_NODE_DEFINITIONS, CORE_MARK_TYPE_NAMES } from './node/core-definitions.js';

/* ---------- 插件 ---------- */
export type { BibliotypePlugin, BibliotypeContext, ThemeAccessor } from './plugin/types.js';
export { definePlugin } from './plugin/types.js';
export { PluginRegistry, PluginConflictError } from './plugin/registry.js';

/* ---------- 主题 ---------- */
export {
  FONT_TOKENS,
  FONT_SIZE_TOKENS,
  LAYOUT_TOKENS,
  COLOR_TOKENS,
} from './theme/tokens.js';
export type { ThemeToken } from './theme/tokens.js';
export { DEFAULT_THEME } from './theme/default-theme.js';
export { createThemeAccessor } from './theme/theme-accessor.js';
export {
  THEME_TOKEN_KEYS,
  isThemeToken,
  validateThemeTokenValue,
  validateThemeTokens,
} from './theme/theme-token-validation.js';
export type {
  ThemeTokenIssue,
  ThemeTokenValidationResult,
} from './theme/theme-token-validation.js';
export {
  THEME_PRESET_KIND,
  THEME_PRESET_SCHEMA_VERSION,
  ThemePresetError,
  serializeThemePreset,
  parseThemePreset,
  validateThemePreset,
  applyThemePreset,
} from './theme/theme-preset.js';
export type {
  ThemePreset,
  ThemePresetIssue,
  ThemePresetParseResult,
} from './theme/theme-preset.js';
export {
  BUILTIN_THEME_PRESETS,
  NIGHT_THEME_PRESET,
  EYE_CARE_THEME_PRESET,
  PARCHMENT_THEME_PRESET,
  createThemePresetCatalog,
} from './theme/theme-preset-catalog.js';
export type { ThemePresetCatalog } from './theme/theme-preset-catalog.js';

/* ---------- 字体回退链覆盖分析 ---------- */
export {
  formatCodePoint,
  isPrivateUseCodePoint,
  analyzeGlyphCoverage,
} from './font-coverage.js';
export type {
  GlyphProbe,
  GlyphCoverageEntry,
  GlyphCoverageReport,
} from './font-coverage.js';

/* ---------- IDS 解析 / 字形回退 / 缺字报告（K6） ---------- */
export {
  IDS_OPERATORS,
  isIdsOperator,
  idsOperatorArity,
  parseIds,
  formatIds,
  countIdsLeaves,
} from './ids.js';
export type { IdsTreeNode, IdsIssue, IdsParseResult, IdsParseOptions } from './ids.js';
export { resolveGlyphFallback, describeGlyphFallback } from './glyph-fallback.js';
export type {
  GlyphFallbackOptions,
  GlyphFallbackResolution,
  GlyphFallbackStage,
} from './glyph-fallback.js';
export { collectGlyphIssues, summarizeGlyphIssues } from './glyph-issues.js';
export type { GlyphIssue, CollectGlyphIssuesOptions } from './glyph-issues.js';

/* ---------- 功能样式表（按功能粒度的样式覆盖） ---------- */
export {
  FEATURE_STYLE_IDS,
  FEATURE_STYLE_GROUPS,
  FEATURE_STYLE_META,
  METRIC_PROPERTIES,
  mergeFeatureStyleSheets,
  declarationsImpactMetrics,
  featureSheetImpactsMetrics,
  computeFeatureMetricsSignature,
  createEmptyNamedStyleSet,
  findNamedStyle,
  createNamedStyleId,
} from './theme/feature-style.js';
export type {
  FeatureStyleId,
  FeatureStyleGroupId,
  FeatureStyleMeta,
  FeatureDeclarations,
  FeatureStyleSheet,
  NamedStyle,
  NamedStyleSet,
} from './theme/feature-style.js';

/* ---------- 命名样式继承链 ---------- */
export {
  NAMED_STYLE_ISSUE_CODES,
  resolveNamedStyleChain,
  resolveNamedStyleDeclarations,
  validateNamedStyleSet,
} from './theme/named-style-resolve.js';
export type {
  NamedStyleIssue,
  NamedStyleIssueCode,
} from './theme/named-style-resolve.js';

/* ---------- 样式设置快照与存储契约 ---------- */
export {
  PAGE_CHROME_FIELDS,
  DEFAULT_EDITING_SETTINGS,
  STYLE_SCOPE,
  bookStyleScope,
  createEmptyStyleSettingsBody,
  createDefaultStyleSnapshot,
  normalizeStyleSnapshot,
  migrateLegacyStyleSnapshot,
} from './settings/style-settings.js';
export type {
  PageChromeField,
  EditingSettings,
  StyleSettingsBody,
  StyleSettingsSnapshot,
  StylePreset,
  StyleSettingsStore,
} from './settings/style-settings.js';

/* ---------- 核心实例 ---------- */
export type { BibliotypeInstance, CoreInstanceOptions } from './instance.js';
export { createBibliotype } from './instance.js';

/* ---------- 存储契约（Port） ---------- */
export type {
  StorageAdapter,
  StoredDocument,
  DocumentSummary,
  DocumentSummaryPatch,
  SaveOptions,
} from './storage/types.js';

/* ---------- 分片存储内核（骨架 + 片；各适配器共用） ---------- */
export {
  CHUNK_BUDGET_BYTES,
  buildChunkedSnapshot,
  fromSkeleton,
} from './storage/chunking.js';
export type {
  ChunkNodeMap,
  ChunkSlice,
  ChunkWrite,
  ChunkedSnapshot,
  SkeletonNode,
} from './storage/chunking.js';

/* ---------- 书架摘要与查询（纯函数 + 可选端口） ---------- */
export type { BuildDocumentSummaryInput } from './storage/library.js';
export {
  buildDocumentSummary,
  carryOverSummaryFields,
  clampProgress,
  mergeDocumentSummary,
  normalizeTags,
  summaryAuthor,
  summaryIsbn,
  summaryTagsFromMetadata,
  isDocumentSummary,
} from './storage/library.js';
export {
  DOCUMENT_GROUP_KEYS,
  DOCUMENT_SORT_KEYS,
  SORT_DIRECTIONS,
  defaultDirection,
  groupDocumentSummaries,
  isBookLibraryStore,
  isBookSummaryStore,
  matchesDocumentQuery,
  queryDocumentSummaries,
  sortDocumentSummaries,
  splitQueryTokens,
} from './storage/query.js';
export type {
  BookLibraryStore,
  BookQueryResult,
  BookSummaryStore,
  DocumentGroupKey,
  DocumentQuery,
  DocumentSortKey,
  DocumentSummaryGroup,
  SortDirection,
} from './storage/query.js';

/* ---------- 资产存储端口 ---------- */
export type {
  AssetKind,
  AssetPayload,
  AssetRef,
  AssetStore,
  PutAssetOptions,
} from './storage/asset.js';
export {
  ASSET_KINDS,
  resolveAssetKind,
  hashAssetBytes,
  toAssetRef,
  isAssetStore,
} from './storage/asset.js';

/* ---------- `.btbook` 单书档 ---------- */
export {
  BTBOOK_FILES,
  BTBOOK_FORMAT,
  BTBOOK_FORMAT_VERSION,
  BOOK_PACK_ERROR_CODES,
  BookPackError,
  assetIdFromPath,
  assetPackPath,
  buildBookPackFiles,
  isBookPackCodec,
  packBookArchive,
  parseBookPackFiles,
  parseBookPackManifest,
  unpackBookArchive,
} from './storage/btbook.js';
export type {
  BookPackAsset,
  BookPackAssetMeta,
  BookPackCodec,
  BookPackErrorCode,
  BookPackFile,
  BookPackManifest,
  BuildBookPackInput,
  UnpackedBookPack,
} from './storage/btbook.js';

/* ---------- 整库备份 / 迁移 ---------- */
export {
  BACKUP_CONFLICT_STRATEGIES,
  LIBRARY_BACKUP_FILES,
  LIBRARY_BACKUP_FORMAT,
  LIBRARY_BACKUP_VERSION,
  backupBookIdFromPath,
  backupBookPath,
  buildLibraryBackupFiles,
  nextCopyId,
  packLibraryArchive,
  parseLibraryBackupManifest,
  resolveConflictTarget,
  restoreLibrary,
  unpackLibraryArchive,
} from './storage/backup.js';
export type {
  BackupConflictStrategy,
  BuildLibraryBackupInput,
  LibraryBackupBookEntry,
  LibraryBackupManifest,
  LibraryRestoreBookHook,
  LibraryRestoreFailure,
  LibraryRestoreProgress,
  LibraryRestoreResult,
  RestoreLibraryOptions,
} from './storage/backup.js';

/* ---------- 恢复链路校验（备份 / 历史回滚共用） ---------- */
export {
  RESTORE_VALIDATE_DEFAULTS,
  validateRestoredDocument,
} from './storage/restore-validation.js';
export type { RestoreValidationOptions } from './storage/restore-validation.js';

/* ---------- 加密与脱敏 ---------- */
export {
  CRYPTO_ERROR_CODES,
  CryptoError,
  isCryptoError,
} from './crypto/errors.js';
export type { CryptoErrorCode } from './crypto/errors.js';
export {
  DEFAULT_PBKDF2_ITERATIONS,
  KDF_SALT_BYTES,
  createPbkdf2Derivation,
  deriveKeyPbkdf2,
  randomBytes,
  resolveSubtle,
} from './crypto/kdf.js';
export type { KeyDerivation, Pbkdf2Options } from './crypto/kdf.js';
export {
  DEFAULT_IV_BYTES,
  ENCRYPTED_ENVELOPE_VERSION,
  base64ToBytes,
  bytesToBase64,
  createByteCipher,
  createStringCipher,
  decodeEnvelope,
  encodeEnvelope,
  isEncryptedEnvelope,
} from './crypto/aes-gcm.js';
export type {
  AesGcmOptions,
  ByteCipher,
  EncryptedEnvelope,
  StringCipher,
} from './crypto/aes-gcm.js';
export {
  SEALED_ASSET_MEDIA_TYPE,
  SEALED_DOCUMENT_KEY,
  SEALED_DOCUMENT_SCHEMA,
  SEALED_DOCUMENT_TITLE,
  createEncryptedAssetStore,
  createEncryptedStorageAdapter,
  isSealedDocument,
  readSealedEnvelope,
} from './crypto/adapters.js';
export type {
  EncryptedAssetStoreOptions,
  EncryptedStorageAdapterOptions,
} from './crypto/adapters.js';
export {
  READING_PROGRESS_KEYS,
  needsRedaction,
  redactAnnotations,
  redactDocument,
} from './privacy/redact.js';
export type { RedactOptions, RedactableAnnotation } from './privacy/redact.js';

/* ---------- 修订模式（C5） ---------- */
export {
  REVISION_MARK_TYPES,
  REVISION_VIEWS,
  buildChangeId,
  collectRevisions,
  isRevisionMark,
  parsePreviousMarks,
  resolveMarksForView,
  revisionTypeLabel,
  revisionTypeOf,
  serializeMarks,
} from './revision/revision-marks.js';
export type {
  ResolvedRevisionMarks,
  RevisionAttrs,
  RevisionEntry,
  RevisionMarkType,
  RevisionView,
} from './revision/revision-marks.js';
export {
  acceptRevisions,
  acceptRevisionsInRoot,
  hasRevisions,
  projectRevisionView,
  rejectRevisions,
  rejectRevisionsInRoot,
} from './revision/accept-reject.js';

/* ---------- 历史版本（C7） ---------- */
export {
  DOCUMENT_SNAPSHOT_VERSION,
  assertRetentionPolicy,
  createSnapshot,
  isDocumentVersionStore,
  nextSnapshotVersion,
  restoreSnapshot,
  selectExpiredSnapshots,
  snapshotChecksum,
} from './history/snapshot.js';
export type {
  DocumentSnapshot,
  DocumentSnapshotMeta,
  DocumentVersionStore,
  SnapshotRetentionPolicy,
  SnapshotRestoreResult,
} from './history/snapshot.js';
export {
  DOCUMENT_CHANGE_KINDS,
  diffDocuments,
  inlineTextDiff,
} from './history/diff.js';
export type {
  DocumentChange,
  DocumentChangeKind,
  DocumentDiff,
  TextDiffSegment,
} from './history/diff.js';
