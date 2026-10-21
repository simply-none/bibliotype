/**
 * 主题预设组合式（D10）
 *
 * 职责边界：
 * - **主题**只写令牌（颜色 / 字体 / 版式），切换预设默认保留字体与版式（`keep`），
 *   所以用户调过的字号不会被主题冲掉；
 * - **样式预设**（layout / features / NamedStyle）不在此处出现，二者互不覆盖；
 * - 目录可注入（`catalog`），导入的主题包注册进目录后立即可回切。
 *
 * 库内不写存储、不弹文件框：导入导出都是纯字符串进出，落盘与下载交给宿主。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  BUILTIN_THEME_PRESETS,
  COLOR_TOKENS,
  DEFAULT_THEME,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
  ThemePresetError,
  applyThemePreset,
  createThemePresetCatalog,
  parseThemePreset,
  serializeThemePreset,
  type ThemePreset,
  type ThemePresetCatalog,
  type ThemePresetIssue,
  type ThemeToken,
} from '@bibliotype/core';

/**
 * 默认保留的排版类令牌：字体族 / 字号 / 字距行距 / 缩进 / 页边距 / 栏距
 *
 * 主题包的意义是「换纸色」，不是「换排版」；内置三套也只给颜色。
 */
export const TYPOGRAPHY_THEME_TOKENS: readonly ThemeToken[] = [
  FONT_TOKENS.BODY,
  FONT_TOKENS.HEADING,
  FONT_TOKENS.CLASSICAL_BODY,
  FONT_TOKENS.MONO,
  FONT_SIZE_TOKENS.BODY,
  FONT_SIZE_TOKENS.NOTE,
  FONT_SIZE_TOKENS.HEADING,
  LAYOUT_TOKENS.LINE_HEIGHT,
  LAYOUT_TOKENS.LETTER_SPACING,
  LAYOUT_TOKENS.TEXT_INDENT,
  LAYOUT_TOKENS.PAGE_MARGIN,
  LAYOUT_TOKENS.COLUMN_GAP,
];

/** 导出用的固定预设 id（导入后覆盖同名自定义主题，不污染内置项） */
export const CUSTOM_THEME_PRESET_ID = 'custom-theme';

/** 颜色令牌键（主题面板色板显示顺序） */
export const THEME_COLOR_TOKENS: readonly ThemeToken[] = [
  COLOR_TOKENS.BACKGROUND,
  COLOR_TOKENS.TEXT,
  COLOR_TOKENS.NOTE_TEXT,
  COLOR_TOKENS.ACCENT,
];

/** useThemePresets 入参 */
export interface UseThemePresetsOptions {
  /** 基线令牌（重置目标；缺省 {@link DEFAULT_THEME}） */
  base?: () => Readonly<Record<ThemeToken, string>>;
  /** 当前生效令牌（导出用；缺省取基线） */
  tokens?: () => Readonly<Record<ThemeToken, string>>;
  /** 令牌变更回调（组件里转发 `update:tokens`） */
  onTokensChange?: (tokens: Record<ThemeToken, string>) => void;
  /** 预设目录；不传则用 `presets`（缺省内置三套）新建一个 */
  catalog?: ThemePresetCatalog;
  /** 预设列表（仅在未传 `catalog` 时生效） */
  presets?: readonly ThemePreset[];
  /** 切换预设时保留取值的令牌（缺省 {@link TYPOGRAPHY_THEME_TOKENS}） */
  keep?: readonly ThemeToken[];
}

/** useThemePresets 返回值 */
export interface UseThemePresets {
  /** 目录中的全部预设 */
  presets: ComputedRef<readonly ThemePreset[]>;
  /** 当前选中的预设 id（null = 基线 / 自定义） */
  activeId: Ref<string | null>;
  /** 最近一次导入的问题清单（空 = 无问题） */
  issues: Ref<readonly ThemePresetIssue[]>;
  /** 应用预设（保留排版令牌）；返回是否命中预设 */
  applyPreset: (id: string) => boolean;
  /** 回到基线令牌 */
  resetTheme: () => void;
  /** 导出当前令牌为主题包 JSON */
  exportJson: () => string;
  /** 导入主题包 JSON（成功即应用；失败把问题写进 `issues`） */
  importJson: (json: string) => boolean;
  /** 清空问题清单 */
  clearIssues: () => void;
}

/** 把稀疏令牌表收敛为完整记录（导出时去掉 undefined） */
function compactTokens(
  tokens: Readonly<Record<ThemeToken, string | undefined>>,
): Partial<Record<ThemeToken, string>> {
  const result: Partial<Record<ThemeToken, string>> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value === 'string' && value !== '') result[key as ThemeToken] = value;
  }
  return result;
}

/**
 * 创建主题预设状态
 *
 * @param options 见 {@link UseThemePresetsOptions}
 */
export function useThemePresets(options: UseThemePresetsOptions = {}): UseThemePresets {
  const baseOf = options.base ?? ((): Readonly<Record<ThemeToken, string>> => DEFAULT_THEME);
  const currentOf = options.tokens ?? baseOf;
  const keep = options.keep ?? TYPOGRAPHY_THEME_TOKENS;
  const catalog =
    options.catalog ??
    createThemePresetCatalog(options.presets ?? BUILTIN_THEME_PRESETS);

  const version = ref(0);
  const activeId = ref<string | null>(null);
  const issues = ref<readonly ThemePresetIssue[]>([]);

  const presets = computed<readonly ThemePreset[]>(() => {
    // version 只用于在 register 后触发重算（目录是可变对象，本身非响应式）
    void version.value;
    return catalog.list();
  });

  const emitTokens = (next: Record<ThemeToken, string>): void => {
    options.onTokensChange?.(next);
  };

  const applyPreset = (id: string): boolean => {
    const preset = catalog.get(id);
    if (preset === undefined) return false;
    emitTokens(applyThemePreset(baseOf(), preset, keep));
    activeId.value = id;
    issues.value = [];
    return true;
  };

  const resetTheme = (): void => {
    emitTokens({ ...baseOf() });
    activeId.value = null;
    issues.value = [];
  };

  const exportJson = (): string => {
    const preset: ThemePreset = {
      id: CUSTOM_THEME_PRESET_ID,
      name: '当前外观',
      description: '由当前阅读器令牌导出',
      tokens: compactTokens(currentOf()),
    };
    return serializeThemePreset(preset);
  };

  const importJson = (json: string): boolean => {
    try {
      const preset = parseThemePreset(json);
      catalog.register(preset);
      version.value += 1;
      // 导入的是用户自己的快照：全量应用（含排版令牌），保证「导出再导入视觉一致」
      emitTokens(applyThemePreset(baseOf(), preset));
      activeId.value = preset.id;
      issues.value = [];
      return true;
    } catch (error) {
      issues.value =
        error instanceof ThemePresetError
          ? [...error.issues]
          : [{ path: '', message: '主题包导入失败，请重试' }];
      return false;
    }
  };

  const clearIssues = (): void => {
    issues.value = [];
  };

  return {
    presets,
    activeId,
    issues,
    applyPreset,
    resetTheme,
    exportJson,
    importJson,
    clearIssues,
  };
}
