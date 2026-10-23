/**
 * 样式设置持久化纯函数与最外层存储读取
 *
 * 承接「草稿 / 源状态」主体构造、快照序列化（去响应式往返）、旧版 demo 快照读取
 * 与迁移映射——均为「输入 → 输出」的确定性计算或隔离到最外层的单一副作用；
 * 组合式 `useStyleSettings` 负责状态编排，本文件不持有响应式状态。
 */
import {
  DEFAULT_EDITING_SETTINGS,
  normalizeStyleSnapshot,
  type FeatureStyleSheet,
  type StyleSettingsBody,
  type StyleSettingsSnapshot,
} from '@bibliotype/core';

/** 旧版 demo 设置快照键（迁移来源） */
const LEGACY_SETTINGS_KEY = 'bt-demo:settings';

/** 空主体（草稿初始化 / 重置用） */
export function createEmptyBody(): StyleSettingsBody {
  return {
    layout: {},
    tokens: {},
    features: {},
    namedStyles: { version: 1, styles: [] },
    editing: { ...DEFAULT_EDITING_SETTINGS },
  };
}

/** 深拷贝一份主体（草稿与源状态隔离，互不引用） */
export function cloneBody(body: StyleSettingsBody): StyleSettingsBody {
  return {
    layout: { ...body.layout },
    tokens: { ...body.tokens },
    features: Object.fromEntries(
      Object.entries(body.features).map(([id, declarations]) => [id, { ...declarations }]),
    ) as FeatureStyleSheet,
    namedStyles: {
      version: 1,
      styles: body.namedStyles.styles.map((style) => ({
        ...style,
        declarations: { ...style.declarations },
      })),
    },
    editing: { ...body.editing },
  };
}

/**
 * 构造带作用域与时间戳的快照
 *
 * 源状态经 ref 持有，都是 Vue reactive 代理；IndexedDB 走 structured clone 落盘，
 * 无法序列化 Proxy（会抛 DataCloneError 且被 flush 吞掉），导致「保存后刷新回到默认」。
 * 这里先转纯对象再保存（配置全为 JSON 安全数据，round-trip 安全）。时间由调用方注入。
 */
export function buildSnapshot(
  body: StyleSettingsBody,
  scope: string,
  updatedAt: number,
): StyleSettingsSnapshot {
  return JSON.parse(
    JSON.stringify({
      version: 1,
      scope,
      ...body,
      updatedAt,
    }),
  ) as StyleSettingsSnapshot;
}

/** 读取旧版快照（localStorage `bt-demo:settings`，无则 undefined） */
export function readLegacySnapshot(): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * 旧版 demo 快照 → 归一化快照
 *
 * 经 `normalizeStyleSnapshot` 补齐结构后，再映射旧结构独有键：
 * `layoutPatch` / `tokenPatch` / `pagination`（新结构键名不同）。
 */
export function migrateLegacySnapshot(legacy: unknown, scope: string): StyleSettingsSnapshot {
  const migrated = normalizeStyleSnapshot(legacy, scope);
  /* 旧结构的键名不同：layoutPatch / tokenPatch / pagination */
  const record = legacy as Record<string, unknown>;
  if (record.layoutPatch !== undefined) {
    migrated.layout = (record.layoutPatch as Record<string, unknown>) ?? {};
  }
  if (record.tokenPatch !== undefined) {
    migrated.tokens = (record.tokenPatch as Record<string, string>) ?? {};
  }
  if (typeof record.pagination === 'boolean') {
    migrated.editing = { ...migrated.editing, pagination: record.pagination };
  }
  return migrated;
}
