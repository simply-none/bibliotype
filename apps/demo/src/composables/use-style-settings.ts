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
 *
 * 草稿模式（`draft: true`）：改动只写草稿，不落源状态也不落盘——
 * 页面 / 画布不会因单个字段重排；`applyDraft` 把草稿烘焙进源状态并持久化，
 * `discardDraft` 直接丢弃（关窗 = 撤销全部未保存改动）。
 */
import { computed, onBeforeUnmount, ref, shallowRef, toValue, type MaybeRefOrGetter, type Ref } from 'vue';
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
  /**
   * 当前书籍 id（缺省 'demo'）。可传 ref / getter：切书时更新该值，
   * 再调用 `load()` 即可载入并应用该书自己的设置（每本书独立存于 `book:<id>`）。
   */
  bookId?: MaybeRefOrGetter<string>;
  /** 迁移用的旧快照读取函数（缺省读 localStorage 的 bt-demo:settings） */
  readLegacy?: () => unknown;
  /** 草稿模式：改动先进草稿，显式 applyDraft 才生效并落盘（设置弹窗场景） */
  draft?: boolean;
}

/** 预设导出格式 */
export interface StylePresetExport {
  kind: 'bibliotype-style-preset';
  version: 1;
  preset: StylePreset;
}

/** 样式设置组合式函数 */
export function useStyleSettings(options: UseStyleSettingsOptions = {}) {
  /** 当前书籍 id（响应式：切书时变更，作用域与落盘点随之切换） */
  const bookIdGetter = (): string => toValue(options.bookId) ?? 'demo';
  /** 本书作用域键（book:<id>），随 bookId 变化 */
  const bookScope = computed(() => bookStyleScope(bookIdGetter()));

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
  /** 草稿模式开关 */
  const draftMode = ref(options.draft === true);
  /** 草稿是否存在未保存改动 */
  const draftDirty = ref(false);
  /** 草稿主体（草稿模式下面板读写的对象；未 apply 前不影响源状态） */
  const draftBody = ref<StyleSettingsBody>(createEmptyBody());

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  /** 首轮 load 的 Promise（flush 在加载完成前需 await 它，避免丢首轮保存） */
  let loadPromise: Promise<void> | undefined;
  /** 用户是否已改动源状态（首轮 load 未落定前改动则不回写旧值，防首轮保存被覆盖） */
  let sourceDirty = false;
  /** 是否处于首轮加载阶段（切书 load 不当作首轮，必应用新书设置） */
  let initialLoadPending = true;

  /* ---------- 快照 ---------- */

  /** 空主体（草稿初始化 / 重置用） */
  function createEmptyBody(): StyleSettingsBody {
    return {
      layout: {},
      tokens: {},
      features: {},
      namedStyles: { version: 1, styles: [] },
      editing: { ...DEFAULT_EDITING_SETTINGS },
    };
  }

  /** 深拷贝一份主体（草稿与源状态隔离，互不引用） */
  function cloneBody(body: StyleSettingsBody): StyleSettingsBody {
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

  /** 源主体（当前生效配置；持久化 / 导出 / 全局默认均以此为准） */
  function sourceBody(): StyleSettingsBody {
    return {
      layout: layoutPatch.value,
      tokens: tokenPatch.value,
      features: features.value,
      namedStyles: namedStyles.value,
      editing: editing.value,
    };
  }

  /**
   * 面板读写主体
   *
   * 草稿模式下面板改的是草稿（源状态不动，页面不重排）；
   * 非草稿模式即源状态（改动即时生效）。
   */
  function panelBody(): StyleSettingsBody {
    return draftMode.value ? draftBody.value : sourceBody();
  }

  /** 当前配置主体（预设导出用：草稿模式取面板视图） */
  function currentBody(): StyleSettingsBody {
    return panelBody();
  }

  /** 当前源快照（含作用域；仅非草稿状态有持久化意义） */
  function currentSnapshot(scope = bookScope.value): StyleSettingsSnapshot {
    const body = sourceBody();
    // 去响应式：源状态经 ref 持有，都是 Vue reactive 代理；IndexedDB 走 structured clone 落盘，
    // 无法序列化 Proxy（会抛 DataCloneError 且被 flush 吞掉），导致「保存后刷新回到默认」。
    // 这里先转纯对象再保存（配置全为 JSON 安全数据，round-trip 安全）。
    return JSON.parse(
      JSON.stringify({
        version: 1,
        scope,
        ...body,
        updatedAt: Date.now(),
      }),
    ) as StyleSettingsSnapshot;
  }

  /** 应用一份主体到面板（草稿模式写草稿并标记脏，否则直接写源状态） */
  function applyBody(body: StyleSettingsBody): void {
    if (draftMode.value) {
      draftBody.value = cloneBody(body);
      draftDirty.value = true;
      return;
    }
    applySource(body);
  }

  /** 应用一份主体到源状态（覆盖全部状态） */
  function applySource(body: StyleSettingsBody): void {
    layoutPatch.value = { ...body.layout };
    tokenPatch.value = { ...body.tokens };
    features.value = { ...body.features };
    namedStyles.value = {
      version: 1,
      styles: body.namedStyles.styles.map((style) => ({ ...style })),
    };
    editing.value = { ...body.editing };
  }

  /* ---------- 草稿 ---------- */

  /** 开始编辑：用源状态初始化草稿（弹窗打开时调用） */
  function beginDraft(): void {
    draftBody.value = cloneBody(sourceBody());
    draftDirty.value = false;
  }

  /**
   * 保存草稿：烘焙进源状态（页面此刻一次性重排）并落盘
   *
   * applyDraft 后草稿自动用新源状态重新初始化，可继续编辑下一轮。
   */
  async function applyDraft(): Promise<void> {
    if (!draftMode.value || !draftDirty.value) return;
    applySource(draftBody.value);
    draftDirty.value = false;
    sourceDirty = true;
    await flush();
    beginDraft();
  }

  /** 丢弃草稿：回到源状态（弹窗关闭时调用，未保存改动全部作废） */
  function discardDraft(): void {
    if (!draftMode.value) return;
    beginDraft();
  }

  /* ---------- 持久化 ---------- */

  /** 立即落盘（本书作用域） */
  async function flush(): Promise<void> {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    // 首轮加载未完成时，先等 load 落定：避免「加载前默认态覆盖已存配置」；
    // load 在 sourceDirty 时不会回写旧值，故首轮保存（含极快保存的竞态）不会丢失。
    if (!loaded.value) {
      if (loadPromise !== undefined) {
        await loadPromise;
        if (!loaded.value) return;
      } else {
        return;
      }
    }
    if (saving !== undefined) {
      await saving.catch(() => undefined);
    }
    const snapshot = currentSnapshot();
    saving = store.save(bookScope.value, snapshot).then(
      () => undefined,
      (error: unknown) => {
        // 落盘失败必须可见：此前 reactive 代理导致 IndexedDB DataCloneError 被吞掉，
        // 表现为「保存后刷新回到默认」，故此处改为打印而非静默丢弃。
        console.error('[style-settings] 落盘失败', error);
      },
    );
    await saving;
    saving = undefined;
  }

  /** 排期落盘（防抖合并连续改动）；草稿模式改动未 apply 不落盘 */
  function scheduleSave(): void {
    if (!loaded.value || draftMode.value) return;
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
   *
   * 首轮加载前用户可能已改动（如极快地保存）：`sourceDirty` 为真时回写旧值会吞掉改动，
   * 故首轮阶段遇已改动则保留内存态、仅标记 loaded；切书阶段（initialLoadPending 已置否）
   * 一律应用新书设置。
   */
  async function load(): Promise<void> {
    loadPromise = (async () => {
      const fromBook = await store.load(bookScope.value).catch(() => undefined);
      if (fromBook !== undefined) {
        if (!initialLoadPending || !sourceDirty) applySource(fromBook);
        loaded.value = true;
        initialLoadPending = false;
        beginDraft();
        await refreshPresets();
        return;
      }

      const fromGlobal = await store.load(STYLE_SCOPE.GLOBAL).catch(() => undefined);
      if (fromGlobal !== undefined) {
        if (!initialLoadPending || !sourceDirty) applySource(fromGlobal);
        loaded.value = true;
        initialLoadPending = false;
        beginDraft();
        await refreshPresets();
        return;
      }

      const legacy = (options.readLegacy ?? defaultReadLegacy)();
      if (legacy !== undefined) {
        const migrated = normalizeStyleSnapshot(legacy, bookScope.value);
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
        if (!initialLoadPending || !sourceDirty) {
          applySource(migrated);
          await store.save(bookScope.value, migrated).catch(() => undefined);
        }
        loaded.value = true;
        initialLoadPending = false;
        beginDraft();
        await refreshPresets();
        return;
      }

      loaded.value = true;
      initialLoadPending = false;
      beginDraft();
      await refreshPresets();
    })();
    return loadPromise;
  }

  /* ---------- 修改入口 ---------- */

  /** 写单个令牌 */
  function setToken(key: string, value: string): void {
    panelBody().tokens = { ...panelBody().tokens, [key]: value };
    touchDraft();
    scheduleSave();
  }

  /** 删单个令牌覆写（回落主题基准） */
  function clearToken(key: string): void {
    const body = panelBody();
    if (!(key in body.tokens)) return;
    const next = { ...body.tokens };
    delete next[key];
    body.tokens = next;
    touchDraft();
    scheduleSave();
  }

  /** 合并布局补丁 */
  function patchLayout(patch: Record<string, unknown>): void {
    panelBody().layout = { ...panelBody().layout, ...patch };
    touchDraft();
    scheduleSave();
  }

  /** 改草稿脏标记（草稿模式下改动即脏；调度落盘由 scheduleSave 负责） */
  function touchDraft(): void {
    if (draftMode.value) draftDirty.value = true;
  }

  /** 写一条功能声明（value 为 null 表示删除该条，回落默认样式） */
  function setFeatureDeclaration(
    id: FeatureStyleId,
    property: string,
    value: string | null,
  ): void {
    const body = panelBody();
    const current = body.features[id] ?? {};
    const next: FeatureDeclarations = { ...current };
    if (value === null || value === '') delete next[property];
    else next[property] = value;

    const sheet: FeatureStyleSheet = { ...body.features };
    if (Object.keys(next).length === 0) delete sheet[id];
    else sheet[id] = next;
    body.features = sheet;
    touchDraft();
    scheduleSave();
  }

  /** 整体覆盖某功能的声明（「自定义声明」文本框用） */
  function setFeatureDeclarations(id: FeatureStyleId, declarations: FeatureDeclarations): void {
    const body = panelBody();
    const sheet: FeatureStyleSheet = { ...body.features };
    if (Object.keys(declarations).length === 0) delete sheet[id];
    else sheet[id] = declarations;
    body.features = sheet;
    touchDraft();
    scheduleSave();
  }

  /** 恢复某功能的默认样式（删掉它的全部覆盖） */
  function resetFeature(id: FeatureStyleId): void {
    const body = panelBody();
    if (body.features[id] === undefined) return;
    const sheet = { ...body.features };
    delete sheet[id];
    body.features = sheet;
    touchDraft();
    scheduleSave();
  }

  /** 恢复全部默认（本书作用域清空，并删除已存快照）
   *
   * 直写源状态并立即生效：已存快照此刻删除，若只清草稿、
   * 「关闭不保存」会造成内存与存储不一致（重开后回落默认）。
   */
  async function resetAll(): Promise<void> {
    applySource(createEmptyBody());
    sourceDirty = true;
    if (draftMode.value) beginDraft();
    await store.delete(bookScope.value).catch(() => false);
    await store.delete(STYLE_SCOPE.GLOBAL).catch(() => false);
  }

  /** 是否存在任何覆写 */
  const customized = computed(
    () => {
      const body = panelBody();
      return (
        Object.keys(body.layout).length > 0 ||
        Object.keys(body.tokens).length > 0 ||
        Object.keys(body.features).length > 0 ||
        body.namedStyles.styles.length > 0
      );
    },
  );

  /* ---------- 编辑行为 ---------- */

  /** 改编辑行为（逐字段合并） */
  function patchEditing(patch: Partial<EditingSettings>): void {
    panelBody().editing = { ...panelBody().editing, ...patch };
    touchDraft();
    scheduleSave();
  }

  /** 改编辑行为（直写源状态，绕过草稿）
   *
   * 供设置弹窗之外的即时生效场景（工具条只读切换 / 进编辑重置）；
   * 若弹窗开着，关闭时草稿会用最新源状态重新初始化。
   */
  function patchEditingDirect(patch: Partial<EditingSettings>): void {
    editing.value = { ...editing.value, ...patch };
    sourceDirty = true;
    if (draftMode.value && !draftDirty.value) beginDraft();
    // 源状态改动不走草稿防抖（草稿模式下 scheduleSave 会直接跳过），立即落盘
    void flush();
  }

  /* ---------- 命名样式 ---------- */

  /** 新建命名样式（基于某功能的当前声明，可选指定依据样式） */
  function createNamedStyle(
    name: string,
    featureId: FeatureStyleId,
    basedOn?: string,
  ): NamedStyle {
    const body = panelBody();
    const style: NamedStyle = {
      id: createNamedStyleId(),
      name,
      featureId,
      ...(basedOn === undefined || basedOn === '' ? {} : { basedOn }),
      declarations: { ...(body.features[featureId] ?? {}) },
    };
    body.namedStyles = { version: 1, styles: [...body.namedStyles.styles, style] };
    touchDraft();
    scheduleSave();
    return style;
  }

  /** 改名 */
  function renameNamedStyle(id: string, name: string): void {
    const body = panelBody();
    body.namedStyles = {
      version: 1,
      styles: body.namedStyles.styles.map((style) =>
        style.id === id ? { ...style, name } : style,
      ),
    };
    touchDraft();
    scheduleSave();
  }

  /** 改声明 */
  function setNamedStyleDeclaration(id: string, property: string, value: string | null): void {
    const body = panelBody();
    body.namedStyles = {
      version: 1,
      styles: body.namedStyles.styles.map((style) => {
        if (style.id !== id) return style;
        const declarations: FeatureDeclarations = { ...style.declarations };
        if (value === null || value === '') delete declarations[property];
        else declarations[property] = value;
        return { ...style, declarations };
      }),
    };
    touchDraft();
    scheduleSave();
  }

  /** 设置命名样式的依据（null / 空串 = 断开继承） */
  function setNamedStyleBasedOn(id: string, basedOn: string | null): void {
    const body = panelBody();
    body.namedStyles = {
      version: 1,
      styles: body.namedStyles.styles.map((style) => {
        if (style.id !== id) return style;
        if (basedOn === null || basedOn === '' || basedOn === id) {
          const next = { ...style };
          delete next.basedOn;
          return next;
        }
        return { ...style, basedOn };
      }),
    };
    touchDraft();
    scheduleSave();
  }

  /** 删除（同时断开其他样式对它的依据引用，避免悬空 id） */
  function deleteNamedStyle(id: string): void {
    const body = panelBody();
    body.namedStyles = {
      version: 1,
      styles: body.namedStyles.styles
        .filter((style) => style.id !== id)
        .map((style) => {
          if (style.basedOn !== id) return style;
          const next = { ...style };
          delete next.basedOn;
          return next;
        }),
    };
    touchDraft();
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
    /* 草稿 */
    draftMode,
    draftDirty,
    beginDraft,
    applyDraft,
    discardDraft,
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
    patchEditingDirect,
    /* 命名样式 */
    createNamedStyle,
    renameNamedStyle,
    setNamedStyleDeclaration,
    setNamedStyleBasedOn,
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
