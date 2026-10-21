/**
 * 主题预设包（D10）
 *
 * 主题包是**只含令牌**的轻量产物：不含版式快照（layout patch）、不含功能样式
 * （NamedStyle），因此与「样式预设」（`StylePreset`）互不覆盖——切换主题预设
 * 不会动用户自定义的字号、页边距与功能勾选。
 *
 * 文件格式固定：`kind` + `schemaVersion` + `preset`，序列化时字段顺序确定、
 * 不含时间戳与随机 id，保证同一预设导出的 JSON 逐字节一致（可进快照测试）。
 */
import { THEME_TOKEN_KEYS, validateThemeTokens } from './theme-token-validation.js';
import type { ThemeToken } from './tokens.js';

/** 主题包文件类型标识 */
export const THEME_PRESET_KIND = 'bibliotype-theme-preset';
/** 主题包 schema 版本（不兼容变更时递增） */
export const THEME_PRESET_SCHEMA_VERSION = 1;

/** 主题预设：只覆盖令牌，未出现的键按基线主题取值 */
export interface ThemePreset {
  /** 稳定标识（小写字母 / 数字 / 连字符，导入导出后不变） */
  id: string;
  /** 展示名 */
  name: string;
  /** 可选说明（一句话描述适用场景） */
  description?: string;
  /** 令牌覆盖（缺省键沿用基线主题） */
  tokens: Partial<Record<ThemeToken, string>>;
}

/** 主题包问题（导入校验结果，路径形如 `preset.tokens.color-text`） */
export interface ThemePresetIssue {
  /** 出问题的字段路径 */
  path: string;
  /** 中文说明（可直接展示给用户） */
  message: string;
}

/** 主题包校验结果 */
export interface ThemePresetParseResult {
  /** 校验通过时的预设；有致命问题时为 undefined */
  preset?: ThemePreset;
  /** 问题清单（空数组表示通过） */
  issues: ThemePresetIssue[];
}

/** 主题包导入失败（携带结构化 issues，便于面板逐条展示） */
export class ThemePresetError extends TypeError {
  /** 具体问题清单 */
  readonly issues: readonly ThemePresetIssue[];

  constructor(message: string, issues: readonly ThemePresetIssue[]) {
    super(message);
    this.name = 'ThemePresetError';
    this.issues = issues;
  }
}

const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** 是否为主题预设对象（只做结构判定，值合法性交给 {@link validateThemePreset}） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 按规范顺序整理令牌，保证序列化可复现 */
function orderTokens(tokens: Partial<Record<ThemeToken, string>>): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) {
    const value = tokens[key];
    if (value !== undefined) ordered[key] = value;
  }
  return ordered;
}

/**
 * 序列化主题预设为 JSON 文本
 *
 * @param preset 主题预设（应已通过校验；未校验时按对象当前字段输出）
 * @returns 字段顺序固定的 JSON（2 空格缩进 + 结尾换行）
 */
export function serializeThemePreset(preset: ThemePreset): string {
  const body: Record<string, unknown> = {
    id: preset.id,
    name: preset.name,
  };
  if (preset.description !== undefined) body.description = preset.description;
  body.tokens = orderTokens(preset.tokens);
  const file = {
    kind: THEME_PRESET_KIND,
    schemaVersion: THEME_PRESET_SCHEMA_VERSION,
    preset: body,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** 校验 id / name / description 字段 */
function validateMeta(candidate: Record<string, unknown>): ThemePresetIssue[] {
  const issues: ThemePresetIssue[] = [];
  if (typeof candidate.id !== 'string' || candidate.id === '') {
    issues.push({ path: 'preset.id', message: '主题包缺少 id' });
  } else if (!PRESET_ID_PATTERN.test(candidate.id)) {
    issues.push({
      path: 'preset.id',
      message: `id 只能包含小写字母、数字与连字符：${candidate.id}`,
    });
  }
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') {
    issues.push({ path: 'preset.name', message: '主题包缺少名称' });
  } else if (candidate.name.length > 60) {
    issues.push({ path: 'preset.name', message: '名称过长（最多 60 个字符）' });
  }
  if (candidate.description !== undefined) {
    if (typeof candidate.description !== 'string') {
      issues.push({ path: 'preset.description', message: '说明需为字符串' });
    } else if (candidate.description.length > 200) {
      issues.push({ path: 'preset.description', message: '说明过长（最多 200 个字符）' });
    }
  }
  return issues;
}

/**
 * 校验主题包文件对象
 *
 * @param raw 已 `JSON.parse` 的对象（不可信）
 * @returns 通过时为 `preset`，任何问题都会进 `issues`
 */
export function validateThemePreset(raw: unknown): ThemePresetParseResult {
  const issues: ThemePresetIssue[] = [];
  if (!isRecord(raw)) {
    return { issues: [{ path: '', message: '主题包需为 JSON 对象' }] };
  }
  if (raw.kind !== THEME_PRESET_KIND) {
    issues.push({
      path: 'kind',
      message: `不是主题包文件（kind 需为 "${THEME_PRESET_KIND}"）`,
    });
  }
  if (raw.schemaVersion !== THEME_PRESET_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      message: `不支持的版本：${String(raw.schemaVersion)}（当前支持 ${THEME_PRESET_SCHEMA_VERSION}）`,
    });
  }
  if (!isRecord(raw.preset)) {
    issues.push({ path: 'preset', message: '缺少 preset 对象' });
    return { issues };
  }

  const candidate = raw.preset;
  issues.push(...validateMeta(candidate));
  const tokenResult = validateThemeTokens(candidate.tokens);
  for (const issue of tokenResult.issues) {
    issues.push({ path: `preset.tokens.${issue.token}`, message: issue.message });
  }
  if (Object.keys(tokenResult.tokens).length === 0 && tokenResult.issues.length === 0) {
    issues.push({ path: 'preset.tokens', message: '主题包未提供任何令牌' });
  }
  if (issues.length > 0) return { issues };

  const preset: ThemePreset = {
    id: candidate.id as string,
    name: (candidate.name as string).trim(),
    tokens: tokenResult.tokens,
  };
  if (typeof candidate.description === 'string') preset.description = candidate.description.trim();
  return { preset, issues };
}

/**
 * 解析主题包 JSON
 *
 * @param json 主题包文本（剪贴板 / 文件内容）
 * @throws {ThemePresetError} JSON 语法错误或字段非法（消息含首个问题，`issues` 为全量清单）
 */
export function parseThemePreset(json: string): ThemePreset {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ThemePresetError('主题包不是合法 JSON，请检查是否粘贴完整', [
      { path: '', message: 'JSON 语法错误' },
    ]);
  }
  const result = validateThemePreset(raw);
  if (result.preset === undefined) {
    const first = result.issues[0];
    const detail = first === undefined ? '' : `（${first.message}）`;
    throw new ThemePresetError(`主题包校验未通过${detail}`, result.issues);
  }
  return result.preset;
}

/**
 * 应用主题预设
 *
 * @param base 基线令牌（通常为 `DEFAULT_THEME` 或当前主题）
 * @param preset 主题预设
 * @param keep 需要保留基线取值的令牌（如用户自定义字号）
 * @returns 合并后的完整令牌表（不修改入参）
 */
export function applyThemePreset(
  base: Readonly<Record<ThemeToken, string>>,
  preset: ThemePreset,
  keep: readonly ThemeToken[] = [],
): Record<ThemeToken, string> {
  const next: Record<ThemeToken, string> = { ...base };
  const kept = new Set(keep);
  for (const [key, value] of Object.entries(preset.tokens)) {
    if (value === undefined || kept.has(key as ThemeToken)) continue;
    next[key as ThemeToken] = value;
  }
  return next;
}
