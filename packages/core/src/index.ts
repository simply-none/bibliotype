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

/* ---------- IR ---------- */
export type { NodeId, Timestamp, AttrValue, Attrs, TextRange } from './ir/types.js';
export { NODE_TYPES, MARK_TYPES } from './ir/node-types.js';
export type { CoreNodeType, CoreMarkType } from './ir/node-types.js';
export type { BookNode, BookMark } from './ir/nodes.js';
export { isTextNode, readAttr } from './ir/nodes.js';
export type {
  BookMetadata,
  Contributor,
  EditionInfo,
  Identifier,
  PublicationInfo,
} from './ir/metadata.js';
export type { BookDocument } from './ir/document.js';
export { IR_SCHEMA_VERSION, createEmptyDocument, isBookDocument } from './ir/document.js';

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
  SaveOptions,
} from './storage/types.js';

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
