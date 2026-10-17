/**
 * 样式设置（三级作用域 + 自动持久化）
 *
 * 对应改造清单 §五：
 * - 改动默认落**本书**（`book:<id>`），不污染其他书；
 * - 「设为全局默认」显式写 `global`；
 * - 命名预设存 `presets`，可套用 / 导出 / 导入；
 * - 存储介质由 `StyleSettingsStore` 端口的实现决定（IndexedDB / localStorage / 内存，
 *   Electron 侧可换成 SQLite 或远端实现，本文件无需改动）。
 *
 * 保存时机：任何改动 800ms 后自动落盘（切书 / 关窗前 flush）——
 * 「下次打开还是这个样式」不依赖用户点按钮。
 */
import { computed, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue';
import {
  DEFAULT_EDITING_SETTINGS,
  STYLE_SCOPE,
  bookStyleScope,
  createNamedStyleId,
  mergeFeatureStyleSheets,
  normalizeStyleSnapshot,
  type EditingSettings,
  type FeatureDeclarations,
  type FeatureStyleId,
  type FeatureStyleSheet,
  type NamedStyle,
  type NamedStyleSet,
  type StylePreset,
  type StyleSettingsBody,
  type StyleSettingsSnapshot,
  type StyleSettingsStore,
} from '@bibliotype/core';
import { createStyleStore } from '@bibliotype/adapter-indexeddb';

/** 自动保存防抖（ms） */
const AUTOSAVE_DELAY = 800;

/** 旧版 demo 设置快照键（迁移来源） */
const LEGACY_SETTINGS_KEY = 'bt-demo:settings';

export interface UseStyleSettingsOptions {
  /** 存储实现（缺省按环境自动选择 IndexedDB → localStorage → 内存） */
  store?: StyleSettingsStore;
  /** 当前书籍 id（缺省 'demo'） */
  bookId?: string;
  /** 迁移用的旧快照读取函数（缺省读 localStorage 的 bt-demo:settings） */
  readLegacy?: () => unknown;
}

/** 预设导出格式 */
export interface StylePresetExport {
  kind: 'bibliotype-style-preset';
  version: 1;
  preset: StylePreset;
}

/** 样式设置组合式函数 */
export function useStyleSettings(options: UseStyleSettingsOptions = {}) {
  const bookId = options.bookId ?? 'demo';
  const bookScope = bookStyleScope(bookId);

  let store: StyleSettingsStore;
  try {
    store = options.store ?? createStyleStore();
  } catch {
    store = createStyleStore({ prefer: 'memory' });
  }

  /* ---------- 状态 ---------- */

  /** 布局补丁（覆盖主题基准） */
  const layoutPatch = ref<Record<string, unknown>>({});
  /** 令牌补丁 */
  const tokenPatch = ref<Record<string, string>>({});
  /** 功能样式表 */
  const features = ref<FeatureStyleSheet>({});
  /** 命名样式集合 */
  const namedStyles = ref<NamedStyleSet>({ version: 1, styles: [] });
  /** 编辑行为 */
  const editing = ref<EditingSettings>({ ...DEFAULT_EDITING_SETTINGS });
  /** 预设列表 */
  const presets = shallowRef<StylePreset[]>([]);
  /** 是否已完成首轮加载（避免加载前的默认值覆盖已存配置） */
  const loaded = ref(false);
  /** 存储适配器名（面板上显示，便于确认走的是哪条链路） */
  const storeName = ref(store.name);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;

  /* ---------- 快照 ---------- */

  /** 当前配置主体 */
  function currentBody(): StyleSettingsBody {
    return {
      layout: layoutPatch.value,
      tokens: tokenPatch.value,
      features: features.value,
      namedStyles: namedStyles.value,
      editing: editing.value,
    };
  }

  /** 当前快照（含作用域） */
  function currentSnapshot(scope = bookScope): StyleSettingsSnapshot {
    return {
      version: 1,
      scope,
      ...currentBody(),
      updatedAt: Date.now(),
    };
  }

  /** 应用一份主体（覆盖全部状态） */
  function applyBody(body: StyleSettingsBody): void {
    layoutPatch.value = { ...body.layout };
    tokenPatch.value = { ...body.tokens };
    features.value = { ...body.features };
    namedStyles.value = {
      version: 1,
      styles: body.namedStyles.styles.map((style) => ({ ...style })),
    };
    editing.value = { ...body.editing };
  }

  /* ---------- 持久化 ---------- */

  /** 立即落盘（本书作用域） */
  async function flush(): Promise<void> {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (!loaded.value) return;
    if (saving !== undefined) {
      await saving.catch(() => undefined);
    }
    const snapshot = currentSnapshot();
    saving = store.save(bookScope, snapshot).then(
      () => undefined,
      () => undefined,
    );
    await saving;
    saving = undefined;
  }

  /** 排期落盘（防抖合并连续改动） */
  function scheduleSave(): void {
    if (!loaded.value) return;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void flush();
    }, AUTOSAVE_DELAY);
  }

  /** 读取旧版快照（用于一次性迁移） */
  function defaultReadLegacy(): unknown {
    if (typeof window === 'undefined') return undefined;
    try {
      const raw = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
      return raw === null ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  /**
   * 载入配置
   *
   * 优先级：本书快照 → 全局快照 → 旧版 demo 快照（迁移）→ 空。
   * 旧版迁移时把 `layoutPatch` / `tokenPatch` / `pagination` 映射进新结构，
   * 并写一份本书快照，避免下次再迁移。
   */
  async function load(): Promise<void> {
    const fromBook = await store.load(bookScope).catch(() => undefined);
    if (fromBook !== undefined) {
      applyBody(fromBook);
      loaded.value = true;
      await refreshPresets();
      return;
    }

    const fromGlobal = await store.load(STYLE_SCOPE.GLOBAL).catch(() => undefined);
    if (fromGlobal !== undefined) {
      applyBody(fromGlobal);
      loaded.value = true;
      await refreshPresets();
      return;
    }

    const legacy = (options.readLegacy ?? defaultReadLegacy)();
    if (legacy !== undefined) {
      const migrated = normalizeStyleSnapshot(legacy, bookScope);
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
      applyBody(migrated);
      loaded.value = true;
      await store.save(bookScope, migrated).catch(() => undefined);
      await refreshPresets();
      return;
    }

    loaded.value = true;
    await refreshPresets();
  }

  /* ---------- 修改入口 ---------- */

  /** 写单个令牌 */
  function setToken(key: string, value: string): void {
    tokenPatch.value = { ...tokenPatch.value, [key]: value };
    scheduleSave();
  }

  /** 删单个令牌覆写（回落主题基准） */
  function clearToken(key: string): void {
    if (!(key in tokenPatch.value)) return;
    const next = { ...tokenPatch.value };
    delete next[key];
    tokenPatch.value = next;
    scheduleSave();
  }

  /** 合并布局补丁 */
  function patchLayout(patch: Record<string, unknown>): void {
    layoutPatch.value = { ...layoutPatch.value, ...patch };
    scheduleSave();
  }

  /** 写一条功能声明（value 为 null 表示删除该条，回落默认样式） */
  function setFeatureDeclaration(
    id: FeatureStyleId,
    property: string,
    value: string | null,
  ): void {
    const current = features.value[id] ?? {};
    const next: FeatureDeclarations = { ...current };
    if (value === null || value === '') delete next[property];
    else next[property] = value;

    const sheet: FeatureStyleSheet = { ...features.value };
    if (Object.keys(next).length === 0) delete sheet[id];
    else sheet[id] = next;
    features.value = sheet;
    scheduleSave();
  }

  /** 整体覆盖某功能的声明（「自定义声明」文本框用） */
  function setFeatureDeclarations(id: FeatureStyleId, declarations: FeatureDeclarations): void {
    const sheet: FeatureStyleSheet = { ...features.value };
    if (Object.keys(declarations).length === 0) delete sheet[id];
    else sheet[id] = declarations;
    features.value = sheet;
    scheduleSave();
  }

  /** 恢复某功能的默认样式（删掉它的全部覆盖） */
  function resetFeature(id: FeatureStyleId): void {
    if (features.value[id] === undefined) return;
    const sheet = { ...features.value };
    delete sheet[id];
    features.value = sheet;
    scheduleSave();
  }

  /** 恢复全部默认（本书作用域清空，并删除已存快照） */
  async function resetAll(): Promise<void> {
    layoutPatch.value = {};
    tokenPatch.value = {};
    features.value = {};
    namedStyles.value = { version: 1, styles: [] };
    editing.value = { ...DEFAULT_EDITING_SETTINGS };
    await store.delete(bookScope).catch(() => false);
    await store.delete(STYLE_SCOPE.GLOBAL).catch(() => false);
  }

  /** 是否存在任何覆写 */
  const customized = computed(
    () =>
      Object.keys(layoutPatch.value).length > 0 ||
      Object.keys(tokenPatch.value).length > 0 ||
      Object.keys(features.value).length > 0 ||
      namedStyles.value.styles.length > 0,
  );

  /* ---------- 编辑行为 ---------- */

  /** 改编辑行为（逐字段合并） */
  function patchEditing(patch: Partial<EditingSettings>): void {
    editing.value = { ...editing.value, ...patch };
    scheduleSave();
  }

  /* ---------- 命名样式 ---------- */

  /** 新建命名样式（基于某功能的当前声明） */
  function createNamedStyle(name: string, featureId: FeatureStyleId): NamedStyle {
    const style: NamedStyle = {
      id: createNamedStyleId(),
      name,
      featureId,
      declarations: { ...(features.value[featureId] ?? {}) },
    };
    namedStyles.value = { version: 1, styles: [...namedStyles.value.styles, style] };
    scheduleSave();
    return style;
  }

  /** 改名 */
  function renameNamedStyle(id: string, name: string): void {
    namedStyles.value = {
      version: 1,
      styles: namedStyles.value.styles.map((style) =>
        style.id === id ? { ...style, name } : style,
      ),
    };
    scheduleSave();
  }

  /** 改声明 */
  function setNamedStyleDeclaration(id: string, property: string, value: string | null): void {
    namedStyles.value = {
      version: 1,
      styles: namedStyles.value.styles.map((style) => {
        if (style.id !== id) return style;
        const declarations: FeatureDeclarations = { ...style.declarations };
        if (value === null || value === '') delete declarations[property];
        else declarations[property] = value;
        return { ...style, declarations };
      }),
    };
    scheduleSave();
  }

  /** 删除 */
  function deleteNamedStyle(id: string): void {
    namedStyles.value = {
      version: 1,
      styles: namedStyles.value.styles.filter((style) => style.id !== id),
    };
    scheduleSave();
  }

  /* ---------- 预设 ---------- */

  /** 刷新预设列表 */
  async function refreshPresets(): Promise<void> {
    presets.value = await store.listPresets().catch(() => []);
  }

  /** 另存为预设 */
  async function saveAsPreset(
    name: string,
    basedOn: 'modern' | 'classical' = 'modern',
  ): Promise<StylePreset> {
    const preset: StylePreset = {
      id: `preset-${Date.now().toString(36)}`,
      name,
      basedOn,
      body: currentBody(),
      createdAt: Date.now(),
    };
    await store.savePreset(preset).catch(() => undefined);
    await refreshPresets();
    return preset;
  }

  /** 套用预设 */
  function applyPreset(preset: StylePreset): void {
    applyBody(preset.body);
    scheduleSave();
  }

  /** 删除预设 */
  async function deletePreset(id: string): Promise<void> {
    await store.deletePreset(id).catch(() => false);
    await refreshPresets();
  }

  /** 设为全局默认（把本书配置写成全局） */
  async function saveAsGlobal(): Promise<void> {
    await store.save(STYLE_SCOPE.GLOBAL, currentSnapshot(STYLE_SCOPE.GLOBAL)).catch(() => undefined);
  }

  /** 导出预设为 JSON 文本 */
  function exportPreset(preset: StylePreset): string {
    const payload: StylePresetExport = {
      kind: 'bibliotype-style-preset',
      version: 1,
      preset,
    };
    return JSON.stringify(payload, null, 2);
  }

  /** 导入预设（返回导入的预设，格式非法返回 undefined） */
  async function importPreset(json: string): Promise<StylePreset | undefined> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (record.kind !== 'bibliotype-style-preset') return undefined;
    const raw = record.preset as Record<string, unknown> | undefined;
    if (raw === undefined) return undefined;
    const snapshot = normalizeStyleSnapshot(raw.body, 'imported');
    const preset: StylePreset = {
      id: `preset-${Date.now().toString(36)}`,
      name: typeof raw.name === 'string' ? raw.name : '导入的预设',
      basedOn: raw.basedOn === 'classical' ? 'classical' : 'modern',
      body: {
        layout: snapshot.layout,
        tokens: snapshot.tokens,
        features: snapshot.features,
        namedStyles: snapshot.namedStyles,
        editing: snapshot.editing,
      },
      createdAt: Date.now(),
    };
    await store.savePreset(preset).catch(() => undefined);
    await refreshPresets();
    return preset;
  }

  /* ---------- 合并工具 ---------- */

  /** 合并多个样式表（供调用方叠加「主题内置 + 用户」） */
  function mergeSheets(...sheets: Array<FeatureStyleSheet | undefined>): FeatureStyleSheet {
    return mergeFeatureStyleSheets(...sheets);
  }

  /* ---------- 生命周期 ---------- */

  /** 关窗前 flush（浏览器标签关闭 / 刷新） */
  function onBeforeUnload(): void {
    void flush();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', onBeforeUnload);
  }
  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
    void flush();
    void store.close();
  });

  return {
    /* 状态 */
    layoutPatch: layoutPatch as Ref<Record<string, unknown>>,
    tokenPatch: tokenPatch as Ref<Record<string, string>>,
    features: features as Ref<FeatureStyleSheet>,
    namedStyles: namedStyles as Ref<NamedStyleSet>,
    editing: editing as Ref<EditingSettings>,
    presets,
    loaded,
    storeName,
    customized,
    /* 生命周期 */
    load,
    flush,
    scheduleSave,
    /* 修改 */
    setToken,
    clearToken,
    patchLayout,
    setFeatureDeclaration,
    setFeatureDeclarations,
    resetFeature,
    resetAll,
    patchEditing,
    /* 命名样式 */
    createNamedStyle,
    renameNamedStyle,
    setNamedStyleDeclaration,
    deleteNamedStyle,
    /* 预设 */
    refreshPresets,
    saveAsPreset,
    applyPreset,
    deletePreset,
    saveAsGlobal,
    exportPreset,
    importPreset,
    mergeSheets,
  };
}

/** 组合式函数返回类型 */
export type StyleSettingsApi = ReturnType<typeof useStyleSettings>;
