/**
 * 主题预设包测试：序列化往返、非法输入拒绝、keep 语义、目录注册。
 */
import { describe, expect, it } from 'vitest';
import {
  COLOR_TOKENS,
  FONT_SIZE_TOKENS,
  FONT_TOKENS,
  LAYOUT_TOKENS,
} from '../theme/tokens.js';
import { DEFAULT_THEME } from '../theme/default-theme.js';
import {
  THEME_PRESET_KIND,
  THEME_PRESET_SCHEMA_VERSION,
  ThemePresetError,
  applyThemePreset,
  parseThemePreset,
  serializeThemePreset,
  validateThemePreset,
  type ThemePreset,
} from '../theme/theme-preset.js';
import {
  BUILTIN_THEME_PRESETS,
  createThemePresetCatalog,
} from '../theme/theme-preset-catalog.js';
import { isThemeToken, validateThemeTokenValue } from '../theme/theme-token-validation.js';

/** 最小合法预设 */
function samplePreset(): ThemePreset {
  return {
    id: 'ink-night',
    name: '墨夜',
    description: '测试用',
    tokens: {
      [COLOR_TOKENS.TEXT]: '#EEEEEE',
      [COLOR_TOKENS.BACKGROUND]: '#101010',
      [COLOR_TOKENS.ACCENT]: '#C9A227',
    },
  };
}

/** 包装为文件对象 */
function wrap(preset: unknown): Record<string, unknown> {
  return { kind: THEME_PRESET_KIND, schemaVersion: THEME_PRESET_SCHEMA_VERSION, preset };
}

describe('serializeThemePreset / parseThemePreset', () => {
  it('往返后字段一致', () => {
    const preset = samplePreset();
    expect(parseThemePreset(serializeThemePreset(preset))).toEqual(preset);
  });

  it('字段顺序固定、令牌按规范顺序输出（可进快照）', () => {
    const preset: ThemePreset = {
      id: 'order',
      name: '顺序',
      tokens: {
        [COLOR_TOKENS.ACCENT]: '#000000',
        [FONT_TOKENS.BODY]: 'serif',
      },
    };
    const json = serializeThemePreset(preset);
    expect(json.indexOf('"id"')).toBeLessThan(json.indexOf('"name"'));
    expect(json.indexOf('"font-family-body"')).toBeLessThan(json.indexOf('"color-accent"'));
    expect(json.endsWith('\n')).toBe(true);
    expect(serializeThemePreset(preset)).toBe(json);
  });

  it('JSON 语法错误抛 ThemePresetError 并带 issue', () => {
    expect(() => parseThemePreset('{')).toThrow(ThemePresetError);
    try {
      parseThemePreset('{');
    } catch (error) {
      expect((error as ThemePresetError).issues[0]?.message).toBe('JSON 语法错误');
    }
  });

  it('kind 不符视为非主题包', () => {
    const raw = wrap(samplePreset());
    raw.kind = 'bibliotype-style-preset';
    const result = validateThemePreset(raw);
    expect(result.preset).toBeUndefined();
    expect(result.issues.some((issue) => issue.path === 'kind')).toBe(true);
  });

  it('版本不支持时拒绝', () => {
    const raw = wrap(samplePreset());
    raw.schemaVersion = 99;
    const result = validateThemePreset(raw);
    expect(result.preset).toBeUndefined();
    expect(result.issues[0]?.message).toContain('不支持的版本');
  });

  it('未知令牌键被拒并给出路径', () => {
    const preset = samplePreset();
    (preset.tokens as Record<string, string>)['color-unknown'] = '#ffffff';
    const result = validateThemePreset(wrap(preset));
    expect(result.preset).toBeUndefined();
    expect(result.issues.some((issue) => issue.path === 'preset.tokens.color-unknown')).toBe(true);
  });

  it('非法颜色被拒', () => {
    const preset = samplePreset();
    preset.tokens[COLOR_TOKENS.TEXT] = 'red; background: url(x)';
    const result = validateThemePreset(wrap(preset));
    expect(result.preset).toBeUndefined();
    expect(result.issues.some((issue) => issue.message.includes('非法字符'))).toBe(true);
  });

  it('不带单位的字号被拒、calc() 取值放行', () => {
    expect(validateThemeTokenValue(FONT_SIZE_TOKENS.BODY, '16')).toBeUndefined();
    expect(validateThemeTokenValue(FONT_SIZE_TOKENS.BODY, 'big')).toContain('长度');
    expect(
      validateThemeTokenValue(LAYOUT_TOKENS.PAGE_MARGIN, 'calc(1rem + 4px)'),
    ).toBeUndefined();
    expect(validateThemeTokenValue(LAYOUT_TOKENS.PAGE_MARGIN, '1px 2px 3px 4px 5px')).toContain(
      '1~4',
    );
  });

  it('令牌表为空时拒绝', () => {
    const result = validateThemePreset(wrap({ id: 'empty', name: '空', tokens: {} }));
    expect(result.preset).toBeUndefined();
    expect(result.issues.some((issue) => issue.path === 'preset.tokens')).toBe(true);
  });

  it('id 只允许小写字母、数字与连字符', () => {
    const result = validateThemePreset(wrap({ id: 'Night Theme', name: '夜', tokens: { [COLOR_TOKENS.TEXT]: '#fff' } }));
    expect(result.issues.some((issue) => issue.path === 'preset.id')).toBe(true);
  });

  it('isThemeToken 只认已注册键', () => {
    expect(isThemeToken(COLOR_TOKENS.TEXT)).toBe(true);
    expect(isThemeToken('color-text-shadow')).toBe(false);
  });
});

describe('applyThemePreset', () => {
  it('只覆盖预设提供的键', () => {
    const next = applyThemePreset(DEFAULT_THEME, samplePreset());
    expect(next[COLOR_TOKENS.TEXT]).toBe('#EEEEEE');
    expect(next[FONT_SIZE_TOKENS.BODY]).toBe(DEFAULT_THEME[FONT_SIZE_TOKENS.BODY]);
  });

  it('keep 中的键保留基线值（用户自定义字号不被主题覆盖）', () => {
    const base = { ...DEFAULT_THEME, [FONT_SIZE_TOKENS.BODY]: '22px' };
    const preset: ThemePreset = {
      id: 'with-font',
      name: '带字号',
      tokens: {
        [COLOR_TOKENS.TEXT]: '#000000',
        [FONT_SIZE_TOKENS.BODY]: '14px',
      },
    };
    const kept = applyThemePreset(base, preset, [FONT_SIZE_TOKENS.BODY]);
    expect(kept[FONT_SIZE_TOKENS.BODY]).toBe('22px');
    expect(kept[COLOR_TOKENS.TEXT]).toBe('#000000');

    const overridden = applyThemePreset(base, preset);
    expect(overridden[FONT_SIZE_TOKENS.BODY]).toBe('14px');
    // 不修改入参
    expect(base[FONT_SIZE_TOKENS.BODY]).toBe('22px');
  });
});

describe('内置主题预设与目录', () => {
  it('三套内置预设均通过文件级校验，且只含颜色令牌', () => {
    expect(BUILTIN_THEME_PRESETS.map((preset) => preset.id)).toEqual([
      'night',
      'eye-care',
      'parchment',
    ]);
    for (const preset of BUILTIN_THEME_PRESETS) {
      expect(validateThemePreset(wrap(preset)).issues).toEqual([]);
      for (const key of Object.keys(preset.tokens)) {
        expect(isThemeToken(key)).toBe(true);
        expect(key.startsWith('color-')).toBe(true);
      }
    }
  });

  it('注册同 id 覆盖、remove 生效、reset 恢复内置', () => {
    const catalog = createThemePresetCatalog();
    catalog.register({ id: 'night', name: '深夜', tokens: { [COLOR_TOKENS.TEXT]: '#fff' } });
    expect(catalog.get('night')?.name).toBe('深夜');

    catalog.register({ id: 'custom', name: '自定义', tokens: { [COLOR_TOKENS.TEXT]: '#123456' } });
    expect(catalog.list()).toHaveLength(4);
    expect(catalog.remove('custom')).toBe(true);
    expect(catalog.remove('custom')).toBe(false);

    catalog.reset();
    expect(catalog.list().map((preset) => preset.name)).toEqual(['夜间', '护眼', '羊皮纸']);
  });

  it('初始预设可裁剪（空目录）', () => {
    const catalog = createThemePresetCatalog([]);
    expect(catalog.list()).toEqual([]);
    expect(catalog.get('night')).toBeUndefined();
  });
});
