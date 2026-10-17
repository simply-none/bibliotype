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
