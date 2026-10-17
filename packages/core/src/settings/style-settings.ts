/**
 * 样式设置快照与存储契约
 *
 * 对应改造清单 §五「持久化设计」：
 * - 三级作用域：`global`（跨书默认）/ `book:<id>`（本书样式）/ `preset:<id>`（命名快照）；
 * - 存储中立：core 只定义端口（同 `StorageAdapter` 的做法），
 *   IndexedDB / localStorage / Electron SQLite / 远端 HTTP 各自实现；
 * - 版本化：快照带 `version`，读到不认识的高版本时降级读取已知字段而非报错；
 *   未知的 features 键与声明原样保留（与 IR `rawAttrs` 同思路），避免降级后丢配置。
 */
import type { FeatureStyleSheet, NamedStyleSet } from '../theme/feature-style.js';

/* -------------------------------------------------------------------------- */
/* 编辑行为设置                                                                */
/* -------------------------------------------------------------------------- */

/** 书页页眉 / 页脚内容字段 */
export const PAGE_CHROME_FIELDS = {
  NONE: 'none',
  BOOK_TITLE: 'bookTitle',
  CHAPTER_TITLE: 'chapterTitle',
  PAGE_NUMBER: 'pageNumber',
} as const;

/** 页眉 / 页脚字段 */
export type PageChromeField = (typeof PAGE_CHROME_FIELDS)[keyof typeof PAGE_CHROME_FIELDS];

/** 编辑行为设置（E 组：非样式，但同属「下次打开还是这样」的范畴） */
export interface EditingSettings {
  /** 只读模式（true = 只读） */
  readonly: boolean;
  /** 书页分页（false = 连续画布） */
  pagination: boolean;
  /** 分页参考线 */
  paginationGuides: boolean;
  /** 画布缩放（1 = 100%） */
  zoom: number;
  /** 自动保存间隔（ms） */
  autosaveDelay: number;
  /** 撤销合并粒度（prosemirror newGroupDelay，ms） */
  historyGroupDelay: number;
  /** 粘贴策略 */
  pasteMode: 'rich' | 'plain' | 'structure';
  /** 回车后继承当前块类型（false = 总回正文） */
  inheritBlockType: boolean;
}

/** 默认编辑行为（与改造前的实际行为一致） */
export const DEFAULT_EDITING_SETTINGS: EditingSettings = {
  readonly: false,
  pagination: true,
  paginationGuides: true,
  zoom: 1,
  autosaveDelay: 2500,
  historyGroupDelay: 500,
  pasteMode: 'rich',
  inheritBlockType: false,
};

/* -------------------------------------------------------------------------- */
/* 快照                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 快照主体（作用域与时间戳之外的「可复制的样式配置」）
 *
 * `layout` 用宽松类型承载，避免 core 反向依赖 @bibliotype/layout
 * （LayoutOptions 的字段由消费方按自身类型断言）；语义上等价于 `Partial<LayoutOptions>`。
 */
export interface StyleSettingsBody {
  /** 布局补丁（页面尺寸 / 书写方向 / 分栏 / 页码样式 …） */
  layout: Record<string, unknown>;
  /** 令牌补丁（覆盖主题基准的令牌值） */
  tokens: Record<string, string>;
  /** 功能样式表（按功能粒度覆盖 CSS 声明） */
  features: FeatureStyleSheet;
  /** 命名样式集合（Word 式具名样式） */
  namedStyles: NamedStyleSet;
  /** 编辑行为 */
  editing: EditingSettings;
}

/** 落盘快照 */
export interface StyleSettingsSnapshot extends StyleSettingsBody {
  version: 1;
  /** 作用域键（`global` / `book:<id>`） */
  scope: string;
  /** 最后更新时间（epoch ms） */
  updatedAt: number;
}

/** 命名预设（可套用 / 导入导出） */
export interface StylePreset {
  id: string;
  name: string;
  /** 基准主题（决定套用时是否附带切换主题） */
  basedOn: 'modern' | 'classical';
  body: StyleSettingsBody;
  createdAt: number;
}

/** 空主体 */
export function createEmptyStyleSettingsBody(): StyleSettingsBody {
  return {
    layout: {},
    tokens: {},
    features: {},
    namedStyles: { version: 1, styles: [] },
    editing: { ...DEFAULT_EDITING_SETTINGS },
  };
}

/** 默认快照（指定作用域） */
export function createDefaultStyleSnapshot(scope: string): StyleSettingsSnapshot {
  return {
    version: 1,
    scope,
    ...createEmptyStyleSettingsBody(),
    updatedAt: Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* 规范化与迁移                                                                */
/* -------------------------------------------------------------------------- */

/** 安全对象断言 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 字符串值表的清洗（丢弃非字符串值，避免脏数据进 CSS） */
function asStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(asRecord(value))) {
    if (typeof raw === 'string') result[key] = raw;
  }
  return result;
}

/**
 * 规范化任意来源的样式表
 *
 * - 非对象 → 忽略；
 * - 声明值统一字符串化（数字 / 布尔都合法，CSS 允许无单位数字）；
 * - 空声明组视为未覆盖（删键，保持稀疏语义）；
 * - **不校验功能 id 白名单**：未知 id 原样保留，供降级/升级互通。
 */
function normalizeFeatureSheet(value: unknown): FeatureStyleSheet {
  const result: FeatureStyleSheet = {};
  for (const [id, declarations] of Object.entries(asRecord(value))) {
    const record = asRecord(declarations);
    const cleaned: Record<string, string> = {};
    for (const [property, raw] of Object.entries(record)) {
      if (raw === null || raw === undefined || raw === '') continue;
      if (typeof raw === 'string') cleaned[property] = raw;
      else if (typeof raw === 'number' || typeof raw === 'boolean') {
        cleaned[property] = String(raw);
      }
    }
    if (Object.keys(cleaned).length > 0) {
      result[id as keyof FeatureStyleSheet] = cleaned;
    }
  }
  return result;
}

/** 规范化命名样式集合 */
function normalizeNamedStyles(value: unknown): NamedStyleSet {
  const styles: NamedStyleSet['styles'] = [];
  const raw = asRecord(value);
  const list = Array.isArray(raw.styles) ? raw.styles : [];
  for (const item of list) {
    const record = asRecord(item);
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    const featureId = typeof record.featureId === 'string' ? record.featureId : '';
    if (id === '' || name === '' || featureId === '') continue;
    const declarations = normalizeFeatureSheet({ [featureId]: record.declarations })[
      featureId as keyof FeatureStyleSheet
    ];
    styles.push({
      id,
      name,
      featureId: featureId as NamedStyleSet['styles'][number]['featureId'],
      declarations: declarations ?? {},
    });
  }
  return { version: 1, styles };
}

/** 规范化编辑行为（逐字段兜底，类型不符则取默认） */
function normalizeEditing(value: unknown): EditingSettings {
  const raw = asRecord(value);
  const bool = (key: keyof EditingSettings, fallback: boolean): boolean =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback;
  const num = (key: keyof EditingSettings, fallback: number): number => {
    const parsed = typeof raw[key] === 'number' ? (raw[key] as number) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const paste = raw.pasteMode;
  return {
    readonly: bool('readonly', DEFAULT_EDITING_SETTINGS.readonly),
    pagination: bool('pagination', DEFAULT_EDITING_SETTINGS.pagination),
    paginationGuides: bool('paginationGuides', DEFAULT_EDITING_SETTINGS.paginationGuides),
    zoom: num('zoom', DEFAULT_EDITING_SETTINGS.zoom),
    autosaveDelay: num('autosaveDelay', DEFAULT_EDITING_SETTINGS.autosaveDelay),
    historyGroupDelay: num('historyGroupDelay', DEFAULT_EDITING_SETTINGS.historyGroupDelay),
    pasteMode:
      paste === 'plain' || paste === 'structure' || paste === 'rich'
        ? paste
        : DEFAULT_EDITING_SETTINGS.pasteMode,
    inheritBlockType: bool('inheritBlockType', DEFAULT_EDITING_SETTINGS.inheritBlockType),
  };
}

/**
 * 把任意来源（存储 / localStorage / 导入的 JSON）规范化为快照
 *
 * 未知字段丢弃、缺失字段补默认；`version` 恒为 1（未来高版本在此做分支迁移）。
 */
export function normalizeStyleSnapshot(
  raw: unknown,
  scope: string,
): StyleSettingsSnapshot {
  const record = asRecord(raw);
  return {
    version: 1,
    scope,
    layout: asRecord(record.layout),
    tokens: asStringRecord(record.tokens),
    features: normalizeFeatureSheet(record.features),
    namedStyles: normalizeNamedStyles(record.namedStyles),
    editing: normalizeEditing(record.editing),
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
  };
}

/**
 * 从改造前的 demo 设置快照迁移
 *
 * 旧结构（`bt-demo:settings`）：`{ themeKey, layoutPatch, tokenPatch, night, pagination }`。
 * 映射关系：
 * - `layoutPatch` → `layout`
 * - `tokenPatch` → `tokens`
 * - `pagination` → `editing.pagination`
 * - `night` 无对应项（夜间是演示态快捷预设，不迁移）
 *
 * 返回值在「旧快照无任何有效内容」时为 `undefined`，避免凭空写出一条空记录。
 */
export function migrateLegacyStyleSnapshot(
  raw: unknown,
  scope = 'global',
): StyleSettingsSnapshot | undefined {
  const record = asRecord(raw);
  const layout = asRecord(record.layoutPatch);
  const tokens = asStringRecord(record.tokenPatch);
  const hasLayout = Object.keys(layout).length > 0;
  const hasTokens = Object.keys(tokens).length > 0;
  const hasPagination = typeof record.pagination === 'boolean';
  if (!hasLayout && !hasTokens && !hasPagination) return undefined;

  return {
    version: 1,
    scope,
    layout,
    tokens,
    features: {},
    namedStyles: { version: 1, styles: [] },
    editing: {
      ...DEFAULT_EDITING_SETTINGS,
      pagination:
        typeof record.pagination === 'boolean'
          ? record.pagination
          : DEFAULT_EDITING_SETTINGS.pagination,
    },
    updatedAt: Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* 存储端口                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 样式设置存储适配器（Port）
 *
 * 约定：
 * - `load` 未命中返回 `undefined`（不抛错），由调用方决定是否取默认；
 * - `save` 为整条覆盖语义（快照本身体量很小，无需增量）；
 * - `listPresets` 按创建时间降序；
 * - `close` 释放底层资源，调用后仍可再用（延迟重开）。
 *
 * 实现参考：`@bibliotype/adapter-indexeddb` 的 `IndexedDbStyleStore` /
 * `LocalStorageStyleStore` / `MemoryStyleStore`；Electron 侧可再实现 SQLite / HTTP 版本。
 */
export interface StyleSettingsStore {
  /** 适配器名称（'indexeddb' / 'localstorage' / 'memory' / 'sqlite' …） */
  readonly name: string;
  /** 读取指定作用域的快照 */
  load(scope: string): Promise<StyleSettingsSnapshot | undefined>;
  /** 写入指定作用域的快照 */
  save(scope: string, snapshot: StyleSettingsSnapshot): Promise<void>;
  /** 列出全部预设（创建时间降序） */
  listPresets(): Promise<StylePreset[]>;
  /** 写入 / 覆盖预设 */
  savePreset(preset: StylePreset): Promise<void>;
  /** 删除预设 */
  deletePreset(id: string): Promise<boolean>;
  /** 删除指定作用域的快照 */
  delete(scope: string): Promise<boolean>;
  /** 清空全部（快照 + 预设） */
  clear(): Promise<void>;
  /** 释放底层资源 */
  close(): Promise<void>;
}

/** 作用域键常量 */
export const STYLE_SCOPE = {
  GLOBAL: 'global',
  /** 本书作用域前缀（拼接 bookId） */
  BOOK_PREFIX: 'book:',
} as const;

/** 构造本书作用域键 */
export function bookStyleScope(bookId: string): string {
  return `${STYLE_SCOPE.BOOK_PREFIX}${bookId}`;
}
