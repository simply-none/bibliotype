/**
 * 设置面板「古籍仿真」模板区行为测试
 *
 * 守护清单里的四条：
 * 1. 进入仿真主题默认呈现第一个模板；
 * 2. 点模板 = 只写布局补丁，令牌补丁保持为空（模板令牌只派生）；
 * 3. 手改结构令牌（字号）判定为「已修改」，纯颜色改动不算；
 * 4. 切回「古籍直排」后模板派生为空、字体回主题基线，无残留。
 *
 * 另守护弹窗回显：草稿模式下 panelLayoutPatch 跟随草稿（点了即高亮），
 * 源状态 layoutPatch 不提前变（画布不重排），discardDraft 后回落。
 *
 * 面板 dirty 判定与模板派生都在 `facsimile-theme.ts` 的纯函数里，
 * 因此无需挂载组件即可覆盖。
 */
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { MemoryStyleStore } from '@bibliotype/adapter-indexeddb';
import { DEFAULT_THEME, FONT_SIZE_TOKENS } from '@bibliotype/core';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  FACSIMILE_PRESETS,
  mergeLayoutOptions,
  type LayoutOptions,
} from '@bibliotype/layout';
import { useStyleSettings } from '../composables/use-style-settings.js';
import {
  isFacsimilePresetModified,
  resolveActiveFacsimilePreset,
  resolveActiveFontToken,
  resolveFacsimilePresetTokens,
} from '../facsimile-theme.js';

/** 默认模板（宋刻浙本） */
const DEFAULT_PRESET = FACSIMILE_PRESETS[0] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;
/** 第三个模板（清武英殿本） */
const THIRD_PRESET = FACSIMILE_PRESETS[2] as NonNullable<(typeof FACSIMILE_PRESETS)[2]>;

describe('古籍仿真模板区', () => {
  it('进入仿真主题默认呈现第一个模板', () => {
    const preset = resolveActiveFacsimilePreset(DEFAULT_PRESET.layout);
    expect(preset?.id).toBe('song-zhe');
    expect(isFacsimilePresetModified(DEFAULT_PRESET.layout, DEFAULT_PRESET.tokens)).toBe(false);
  });

  it('套用第三个模板：只写布局补丁，令牌补丁保持为空', async () => {
    const store = new MemoryStyleStore();
    const api = useStyleSettings({ bookId: ref('demo'), draft: true, store });
    await api.load();

    api.patchLayout(THIRD_PRESET.layout as unknown as Record<string, unknown>);
    await api.applyDraft();

    const effective = mergeLayoutOptions(
      DEFAULT_PRESET.layout,
      api.layoutPatch.value as Partial<LayoutOptions>,
    );
    expect(effective.facsimile?.preset).toBe(THIRD_PRESET.id);
    expect(api.tokenPatch.value).toEqual({});

    const tokens = { ...DEFAULT_THEME, ...resolveFacsimilePresetTokens(effective) };
    expect(tokens['color-background']).toBe(THIRD_PRESET.tokens['color-background']);
    expect(resolveActiveFontToken(effective, 'font-family-body')).toBe(THIRD_PRESET.fontToken);

    /* 模拟刷新：同 store + 同 bookId 重载，模板与手改布局仍在 */
    const reloaded = useStyleSettings({ bookId: ref('demo'), draft: true, store });
    await reloaded.load();
    const restored = mergeLayoutOptions(
      DEFAULT_PRESET.layout,
      reloaded.layoutPatch.value as Partial<LayoutOptions>,
    );
    expect(restored.facsimile?.preset).toBe(THIRD_PRESET.id);
  });

  it('草稿模式：点模板后面板视图立即跟随，源状态不提前生效，丢弃后回落', async () => {
    const api = useStyleSettings({
      bookId: ref('demo'),
      draft: true,
      store: new MemoryStyleStore(),
    });
    await api.load();

    api.patchLayout(THIRD_PRESET.layout as unknown as Record<string, unknown>);

    /* 面板视图（弹窗高亮读这里）：草稿已含新模板 */
    const panelView = mergeLayoutOptions(
      DEFAULT_PRESET.layout,
      api.panelLayoutPatch.value as Partial<LayoutOptions>,
    );
    expect(panelView.facsimile?.preset).toBe(THIRD_PRESET.id);
    /* 源状态（画布读这里）：未保存前不变 */
    expect((api.layoutPatch.value as Partial<LayoutOptions>).facsimile?.preset).not.toBe(
      THIRD_PRESET.id,
    );

    /* 关闭弹窗 = 丢弃草稿：面板视图同步回落，高亮不会残留 */
    api.discardDraft();
    expect(
      (api.panelLayoutPatch.value as Partial<LayoutOptions>).facsimile?.preset,
    ).not.toBe(THIRD_PRESET.id);
  });

  it('手改字号判定为已修改，纯颜色改动不算', () => {
    const base = { ...DEFAULT_THEME, ...resolveFacsimilePresetTokens(DEFAULT_PRESET.layout) };
    expect(isFacsimilePresetModified(DEFAULT_PRESET.layout, base)).toBe(false);
    expect(
      isFacsimilePresetModified(DEFAULT_PRESET.layout, {
        ...base,
        [FONT_SIZE_TOKENS.BODY]: '30px',
      }),
    ).toBe(true);
    expect(
      isFacsimilePresetModified(DEFAULT_PRESET.layout, {
        ...base,
        'page-frame-color': '#a33a2a',
      }),
    ).toBe(false);
  });

  it('切回古籍直排：模板派生为空、字体回主题基线、无残留', () => {
    const classical = mergeLayoutOptions(CLASSICAL_LAYOUT_OPTIONS, {});
    expect(resolveFacsimilePresetTokens(classical)).toEqual({});
    expect(resolveActiveFontToken(classical, 'font-family-classical-body')).toBe(
      'font-family-classical-body',
    );
    expect(isFacsimilePresetModified(classical, DEFAULT_THEME)).toBe(false);
  });
});
