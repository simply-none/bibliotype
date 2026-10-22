/**
 * Demo 三档主题定义与主题态
 *
 * 主题 = 布局基准 + 令牌基线 + 正文字体令牌。三档并列：现代横排 / 古籍直排 /
 * 古籍仿真直排。`night`（夜间纸面）与主题正交，只覆盖阅读区配色令牌。
 * 本文件只提供常量与 `themeKey / night` 两个源状态，派生的 effectiveLayout /
 * tokens 在 `use-layout-tokens` 组装。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { COLOR_TOKENS, DEFAULT_THEME, FONT_TOKENS } from '@bibliotype/core';
import { CLASSICAL_THEME_OVERRIDES } from '@bibliotype/classical';
import {
  CLASSICAL_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  FACSIMILE_BASE_LAYOUT,
  FACSIMILE_PRESETS,
  type LayoutOptions,
} from '@bibliotype/layout';

export type ThemeKey = 'modern' | 'classical' | 'facsimile';

export interface ThemeConfig {
  /** 工具栏展示名 */
  label: string;
  /** 布局选项（分区尺寸 / 书写方向 / 页码样式） */
  layout: LayoutOptions;
  /** 主题令牌值表 */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 正文字体令牌键 */
  fontToken: string;
}

/** 现代横排：默认布局 + 默认主题 */
export const MODERN_THEME: ThemeConfig = {
  label: '现代横排',
  layout: DEFAULT_LAYOUT_OPTIONS,
  tokens: { ...DEFAULT_THEME },
  fontToken: FONT_TOKENS.BODY,
};

/** 古籍直排：16 开直排 + 古典令牌覆盖（楷体系字体、无首行缩进、版框四周双边） */
export const CLASSICAL_THEME: ThemeConfig = {
  label: '古籍直排',
  layout: CLASSICAL_LAYOUT_OPTIONS,
  tokens: {
    ...DEFAULT_THEME,
    ...CLASSICAL_THEME_OVERRIDES,
    'page-border': '3px double #b09a76',
  },
  fontToken: FONT_TOKENS.CLASSICAL_BODY,
};

/**
 * 古籍仿真直排：与「古籍直排」并列的第三档主题
 *
 * 布局基准取第一个模板（进入即展示第一种模板的样式），令牌与字体由
 * `layout.facsimile.preset` 派生（见 use-layout-tokens 的 facsimilePreset），
 * 因此切模板不会污染令牌补丁，切回「古籍直排」也不残留仿真纸色 / 框色。
 */
export const FACSIMILE_THEME: ThemeConfig = {
  label: '古籍仿真直排',
  layout: FACSIMILE_PRESETS[0]?.layout ?? FACSIMILE_BASE_LAYOUT,
  tokens: { ...DEFAULT_THEME },
  fontToken: FONT_TOKENS.CLASSICAL_BODY,
};

export const THEMES: Record<ThemeKey, ThemeConfig> = {
  modern: MODERN_THEME,
  classical: CLASSICAL_THEME,
  facsimile: FACSIMILE_THEME,
};

/** 工具栏按钮列表（key 显式携带，避免模板内索引推断） */
export const THEME_ENTRIES: ReadonlyArray<{ key: ThemeKey; config: ThemeConfig }> = [
  { key: 'modern', config: MODERN_THEME },
  { key: 'classical', config: CLASSICAL_THEME },
  { key: 'facsimile', config: FACSIMILE_THEME },
];

/** 夜间配色覆盖（正文 / 背景 / 注文 / 强调） */
export const NIGHT_COLORS: Readonly<Record<string, string>> = {
  [COLOR_TOKENS.BACKGROUND]: '#171614',
  [COLOR_TOKENS.TEXT]: '#cec9c0',
  [COLOR_TOKENS.NOTE_TEXT]: '#8f897d',
  [COLOR_TOKENS.ACCENT]: '#c99a5b',
};

/** 主题态：themeKey（三档主题）+ night（夜间纸面开关），派生值由消费方计算 */
export function useAppThemes(): {
  themeKey: Ref<ThemeKey>;
  night: Ref<boolean>;
  theme: ComputedRef<ThemeConfig>;
} {
  const themeKey = ref<ThemeKey>('modern');
  const night = ref(false);
  const theme = computed<ThemeConfig>(() => THEMES[themeKey.value]);
  return { themeKey, night, theme };
}
