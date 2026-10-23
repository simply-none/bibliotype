/**
 * 命名样式预设的组合式：列表刷新、另存、套用、删除、导出 / 导入
 *
 * 由 `useStyleSettings` 门面在源状态与调度函数就绪后实例化并接线（依赖注入），
 * 本文件只持有 `presets` 列表这一份状态，其余读写均经注入的 store 与回调完成，
 * 不反向引用门面。
 */
import { shallowRef, type ShallowRef } from 'vue';
import {
  normalizeStyleSnapshot,
  type StylePreset,
  type StyleSettingsBody,
  type StyleSettingsStore,
} from '@bibliotype/core';

/** 预设导出格式 */
export interface StylePresetExport {
  kind: 'bibliotype-style-preset';
  version: 1;
  preset: StylePreset;
}

export interface StylePresetsDeps {
  /** 存储端口（预设读写与删除走此实现） */
  store: StyleSettingsStore;
  /** 当前配置主体（另存预设 / 导出取此快照，草稿模式下为面板视图） */
  currentBody: () => StyleSettingsBody;
  /** 应用一份主体到面板（套用 / 导入预设时用，草稿模式写草稿） */
  applyBody: (body: StyleSettingsBody) => void;
  /** 排期落盘（套用预设后触发自动保存） */
  scheduleSave: () => void;
}

/** 预设状态与操作 */
export function useStylePresets(deps: StylePresetsDeps) {
  const { store, currentBody, applyBody, scheduleSave } = deps;

  /** 预设列表 */
  const presets: ShallowRef<StylePreset[]> = shallowRef([]);

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

  return {
    presets,
    refreshPresets,
    saveAsPreset,
    applyPreset,
    deletePreset,
    exportPreset,
    importPreset,
  };
}
