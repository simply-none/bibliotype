/**
 * 主题切换净版（F-设置残留）：切主题清空令牌补丁与功能样式，
 * 命名样式 / 编辑行为保留——版式度量令牌与书写方向强耦合，残留会破坏
 * 直排字位网格与界行对齐。
 */
import { describe, expect, it } from 'vitest';
import { createStyleStore } from '@bibliotype/adapter-indexeddb';
import { useStyleSettings } from '../composables/use-style-settings.js';

function memoryApi() {
  return useStyleSettings({ draft: true, store: createStyleStore({ prefer: 'memory' }) });
}

describe('useStyleSettings.resetForThemeSwitch', () => {
  it('清空令牌补丁与功能样式（并重建草稿），保留命名样式', async () => {
    const api = memoryApi();
    await api.load();

    api.setToken('line-height-body', '1.2');
    api.setToken('font-size-body', '22px');
    api.setToken('letter-spacing-body', '0.1em');
    api.setFeatureDeclaration('block.paragraph', 'margin-block-end', '1em');
    api.createNamedStyle('测试样式', 'block.paragraph');
    /* 「保存」语义：草稿烘焙进源状态（demo 的设置面板流程） */
    await api.applyDraft();

    console.log(JSON.stringify({ dirty: api.draftDirty?.value, tp: Object.keys(api.tokenPatch.value).length, dp: Object.keys((api as unknown as { draftBody?: { value: { tokens: Record<string, unknown> } } }).draftBody?.value?.tokens ?? {}) }));
    expect(Object.keys(api.tokenPatch.value).length).toBeGreaterThan(0);
    expect(Object.keys(api.features.value).length).toBeGreaterThan(0);

    api.resetForThemeSwitch();

    /* 源 refs 清空，草稿同步重建为净版（demo 为 draft 模式，面板读写草稿） */
    expect(api.tokenPatch.value).toEqual({});
    expect(api.features.value).toEqual({});
    expect(api.draftDirty.value).toBe(false);
    /* 命名样式保留（用户内容级样式，与主题无耦合） */
    expect(api.namedStyles.value.styles.length).toBeGreaterThan(0);
  });

  it('清空后落盘（本书作用域快照同步为净版）', async () => {
    const api = memoryApi();
    await api.load();
    api.setToken('font-size-body', '24px');
    await api.flush();
    api.resetForThemeSwitch();
    await api.flush();
    /* 重新载入应读到净版（无令牌补丁） */
    const api2 = memoryApi();
    await api2.load();
    expect(api2.tokenPatch.value).toEqual({});
  });
});
