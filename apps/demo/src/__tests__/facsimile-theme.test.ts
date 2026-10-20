/**
 * 古籍仿真主题派生规则测试
 *
 * 守护清单里的三条承诺：
 * 1. 进入「古籍仿真直排」默认呈现第一个模板（布局基准即 `FACSIMILE_PRESETS[0].layout`）；
 * 2. 模板令牌只派生、不写补丁 —— 且模板本身不携带 `page-border`（不与古典版框叠加）；
 * 3. 从仿真切回古典（布局无 `facsimile`）后，令牌与字体回到基线、不残留。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@bibliotype/core';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  FACSIMILE_PRESETS,
} from '@bibliotype/layout';
import {
  resolveActiveFacsimilePreset,
  resolveActiveFontToken,
  resolveFacsimilePresetTokens,
} from '../facsimile-theme.js';

/** 默认模板（进入主题时套用的第一个） */
const DEFAULT_PRESET = FACSIMILE_PRESETS[0] as NonNullable<(typeof FACSIMILE_PRESETS)[0]>;

describe('facsimile 主题派生', () => {
  it('无 facsimile 的布局：不派生模板、令牌为空、字体回落主题值', () => {
    expect(resolveActiveFacsimilePreset(DEFAULT_LAYOUT_OPTIONS)).toBeUndefined();
    expect(resolveFacsimilePresetTokens(DEFAULT_LAYOUT_OPTIONS)).toEqual({});
    expect(resolveActiveFontToken(DEFAULT_LAYOUT_OPTIONS, 'font-family-body')).toBe(
      'font-family-body',
    );

    expect(resolveActiveFacsimilePreset(CLASSICAL_LAYOUT_OPTIONS)).toBeUndefined();
    expect(resolveFacsimilePresetTokens(CLASSICAL_LAYOUT_OPTIONS)).toEqual({});
    expect(resolveActiveFontToken(CLASSICAL_LAYOUT_OPTIONS, 'font-family-classical-body')).toBe(
      'font-family-classical-body',
    );
  });

  it('默认主题布局即第一个模板（进入即展示模板 1）', () => {
    const preset = resolveActiveFacsimilePreset(DEFAULT_PRESET.layout);
    expect(preset?.id).toBe(DEFAULT_PRESET.id);
    expect(preset?.id).toBe('song-zhe');
    expect(preset?.label).toBe('宋刻浙本');
  });

  it('套用其他模板：令牌与字体随模板切换，且不含 page-border', () => {
    const third = FACSIMILE_PRESETS[2] as NonNullable<(typeof FACSIMILE_PRESETS)[2]>;
    const tokens = resolveFacsimilePresetTokens(third.layout);
    expect(tokens).toEqual(third.tokens);
    expect(tokens['color-background']).toBe(third.tokens['color-background']);
    expect(tokens['page-border']).toBeUndefined();
    expect(resolveActiveFontToken(third.layout, 'font-family-body')).toBe(third.fontToken);
  });

  it('未知模板 id：回退为空令牌与主题字体（不抛错）', () => {
    const layout = {
      ...DEFAULT_PRESET.layout,
      facsimile: { ...DEFAULT_PRESET.layout.facsimile!, preset: 'not-exist' },
    };
    expect(resolveActiveFacsimilePreset(layout)).toBeUndefined();
    expect(resolveFacsimilePresetTokens(layout)).toEqual({});
    expect(resolveActiveFontToken(layout, 'font-family-body')).toBe('font-family-body');
  });

  it('切回古典：同一份主题基准重新生效（无残留）', () => {
    const classicalTokens = DEFAULT_THEME;
    const tokens = resolveFacsimilePresetTokens(CLASSICAL_LAYOUT_OPTIONS);
    expect({ ...classicalTokens, ...tokens }).toEqual(classicalTokens);
  });
});
