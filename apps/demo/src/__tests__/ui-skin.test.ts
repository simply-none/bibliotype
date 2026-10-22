/**
 * 界面皮肤注册表测试（P0）
 *
 * 只测纯数据契约：皮肤键唯一且与 `styles.css` 约定一致、预览色合法、
 * 深色标记正确、存储脏值一律回落——这些决定了换肤会不会把界面带进
 * 「无令牌」状态（CSS 变量缺失时按钮会退化成浏览器默认样式）。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_DENSITY,
  DEFAULT_UI_MOTION,
  DEFAULT_UI_SKIN,
  UI_SKINS,
  UI_SKIN_KEYS,
  isUiDensity,
  isUiMotion,
  isUiSkinKey,
  resolveUiSkin,
} from '../ui-skin.js';

/** 十六进制色（#rgb / #rrggbb） */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

describe('ui-skin 注册表', () => {
  it('四套皮肤、键唯一、默认皮肤排第一', () => {
    expect(UI_SKINS).toHaveLength(4);
    expect(new Set(UI_SKIN_KEYS).size).toBe(4);
    expect(UI_SKINS[0]?.key).toBe(DEFAULT_UI_SKIN);
  });

  it('每套皮肤都有名称与合法预览色块', () => {
    for (const skin of UI_SKINS) {
      expect(skin.label.length).toBeGreaterThan(1);
      expect(skin.preview.canvas).toMatch(HEX_COLOR);
      expect(skin.preview.surface).toMatch(HEX_COLOR);
      expect(skin.preview.accent).toMatch(HEX_COLOR);
    }
  });

  it('只有墨色专注是深色壳', () => {
    const dark = UI_SKINS.filter((skin) => skin.dark).map((skin) => skin.key);
    expect(dark).toEqual(['ink']);
  });

  it('isUiSkinKey 拒绝未知值与脏数据', () => {
    expect(isUiSkinKey('paper')).toBe(true);
    expect(isUiSkinKey('contrast')).toBe(true);
    expect(isUiSkinKey('Paper')).toBe(false);
    expect(isUiSkinKey('')).toBe(false);
    expect(isUiSkinKey(null)).toBe(false);
    expect(isUiSkinKey(1)).toBe(false);
  });

  it('resolveUiSkin 未知键回落默认皮肤', () => {
    expect(resolveUiSkin('ink').key).toBe('ink');
    expect(resolveUiSkin('neon').key).toBe(DEFAULT_UI_SKIN);
    expect(resolveUiSkin(undefined).key).toBe(DEFAULT_UI_SKIN);
  });

  it('密度与动效枚举容错', () => {
    expect(isUiDensity('compact')).toBe(true);
    expect(isUiDensity('dense')).toBe(false);
    expect(isUiMotion('off')).toBe(true);
    expect(isUiMotion('on')).toBe(false);
    expect(DEFAULT_UI_DENSITY).toBe('comfortable');
    expect(DEFAULT_UI_MOTION).toBe('auto');
  });
});
