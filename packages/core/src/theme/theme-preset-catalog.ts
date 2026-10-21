/**
 * 主题预设目录（D10）
 *
 * 做成可实例化的注册表而非模块级单例，与 `NodeTypeRegistry` / `PluginRegistry`
 * 口径一致：库内不持有隐式全局状态，宿主可为不同书架 / 阅读器各建一套目录。
 *
 * 内置三套只覆盖颜色令牌——字体与版式属于用户排版偏好（`StylePreset` 管），
 * 主题包若也写字号，切换主题就会覆盖用户调好的字号，正好违反 D10 的解耦要求。
 */
import { COLOR_TOKENS } from './tokens.js';
import type { ThemePreset } from './theme-preset.js';

/** 内置预设：夜间（深底暖白字） */
export const NIGHT_THEME_PRESET: ThemePreset = {
  id: 'night',
  name: '夜间',
  description: '深色底面 + 暖白文字，弱光环境下对比柔和',
  tokens: {
    [COLOR_TOKENS.TEXT]: '#E8E4DC',
    [COLOR_TOKENS.BACKGROUND]: '#1C1B19',
    [COLOR_TOKENS.NOTE_TEXT]: '#9A948A',
    [COLOR_TOKENS.ACCENT]: '#C9A227',
  },
};

/** 内置预设：护眼（豆绿底） */
export const EYE_CARE_THEME_PRESET: ThemePreset = {
  id: 'eye-care',
  name: '护眼',
  description: '低饱和豆绿底 + 深墨绿字，长时间阅读不刺眼',
  tokens: {
    [COLOR_TOKENS.TEXT]: '#2F3B2E',
    [COLOR_TOKENS.BACKGROUND]: '#E8EFDF',
    [COLOR_TOKENS.NOTE_TEXT]: '#5C6A56',
    [COLOR_TOKENS.ACCENT]: '#4E7A48',
  },
};

/** 内置预设：羊皮纸（暖黄纸感） */
export const PARCHMENT_THEME_PRESET: ThemePreset = {
  id: 'parchment',
  name: '羊皮纸',
  description: '暖黄纸色 + 棕墨字，接近古籍抄本的阅读观感',
  tokens: {
    [COLOR_TOKENS.TEXT]: '#43321F',
    [COLOR_TOKENS.BACKGROUND]: '#F4E8D2',
    [COLOR_TOKENS.NOTE_TEXT]: '#7A6449',
    [COLOR_TOKENS.ACCENT]: '#A9743F',
  },
};

/** 内置预设（顺序即面板展示顺序） */
export const BUILTIN_THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  NIGHT_THEME_PRESET,
  EYE_CARE_THEME_PRESET,
  PARCHMENT_THEME_PRESET,
]);

/** 主题预设目录 */
export interface ThemePresetCatalog {
  /** 全部预设（内置 + 已注册，按注册顺序） */
  list(): readonly ThemePreset[];
  /** 按 id 取预设 */
  get(id: string): ThemePreset | undefined;
  /**
   * 注册（或覆盖同 id）预设
   *
   * @param preset 已通过 `validateThemePreset` 的预设
   */
  register(preset: ThemePreset): void;
  /** 移除预设（内置预设也可移除，便于宿主裁剪） */
  remove(id: string): boolean;
  /** 清空为仅内置预设 */
  reset(): void;
}

/**
 * 创建主题预设目录
 *
 * @param initial 初始预设（缺省为 {@link BUILTIN_THEME_PRESETS}）
 */
export function createThemePresetCatalog(
  initial: readonly ThemePreset[] = BUILTIN_THEME_PRESETS,
): ThemePresetCatalog {
  let presets: ThemePreset[] = [...initial];

  return {
    list: () => presets,
    get: (id) => presets.find((preset) => preset.id === id),
    register: (preset) => {
      const index = presets.findIndex((item) => item.id === preset.id);
      if (index >= 0) {
        presets = presets.map((item, current) => (current === index ? preset : item));
        return;
      }
      presets = [...presets, preset];
    },
    remove: (id) => {
      const next = presets.filter((preset) => preset.id !== id);
      if (next.length === presets.length) return false;
      presets = next;
      return true;
    },
    reset: () => {
      presets = [...initial];
    },
  };
}
