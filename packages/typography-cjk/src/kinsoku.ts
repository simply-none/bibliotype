/**
 * 禁则处理（避头尾）
 *
 * 两条铁律：
 * 1. **不可居行首**（行头禁则）：句读、后括号、后引号等收束性标点不能出现在行首；
 * 2. **不可居行尾**（行尾禁则）：前括号、前引号等开启性标点不能悬在行尾。
 *
 * 分页器 / 分栏引擎在「行级拆分」处必须用本模块给出的断点，而不是按字数硬切——
 * 这正是纸书排版与网页流式排版的差别所在。
 */
import { isHighSurrogate, isLowSurrogate } from './chars.js';

/** 禁则配置 */
export interface KinsokuProfile {
  /** 配置名（用于错误信息与调试） */
  name: string;
  /** 不可出现在行首的字符集合 */
  forbiddenAtLineStart: string;
  /** 不可出现在行尾的字符集合 */
  forbiddenAtLineEnd: string;
}

/** 中文（简体）行头禁则：收束性标点 */
const ZH_HANS_FORBIDDEN_START =
  '。，、；：？！）〕］｝〉》」』】〗〙〛”’…‥·ー々〻%‰℃°′″';

/** 中文（简体）行尾禁则：开启性标点 */
const ZH_HANS_FORBIDDEN_END = '（〔［｛〈《「『【〖〘〚“‘';

/** 繁体补充：顿号变体、间隔号等 */
const ZH_HANT_EXTRA_START = '﹑‧・';

/** 日文补充：长音符、叠字符、小假名不可居行首 */
const JA_EXTRA_START = 'ー々〻ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';

/** 内置禁则配置 */
export const KINSOKU_PROFILES = {
  'zh-Hans': {
    name: 'zh-Hans',
    forbiddenAtLineStart: ZH_HANS_FORBIDDEN_START,
    forbiddenAtLineEnd: ZH_HANS_FORBIDDEN_END,
  },
  'zh-Hant': {
    name: 'zh-Hant',
    forbiddenAtLineStart: ZH_HANS_FORBIDDEN_START + ZH_HANT_EXTRA_START,
    forbiddenAtLineEnd: ZH_HANS_FORBIDDEN_END,
  },
  ja: {
    name: 'ja',
    forbiddenAtLineStart: ZH_HANS_FORBIDDEN_START + JA_EXTRA_START,
    forbiddenAtLineEnd: ZH_HANS_FORBIDDEN_END,
  },
} as const;

/** 内置配置名 */
export type KinsokuProfileName = keyof typeof KINSOKU_PROFILES;

/** 缺省配置（简体中文） */
export const DEFAULT_KINSOKU_PROFILE: KinsokuProfileName = 'zh-Hans';

/** 解析配置：名称 → 内置配置，对象 → 原样返回 */
export function resolveKinsokuProfile(
  profile: KinsokuProfileName | KinsokuProfile | undefined,
): KinsokuProfile {
  if (profile === undefined) {
    return KINSOKU_PROFILES[DEFAULT_KINSOKU_PROFILE];
  }
  if (typeof profile === 'string') {
    return KINSOKU_PROFILES[profile] ?? KINSOKU_PROFILES[DEFAULT_KINSOKU_PROFILE];
  }
  return profile;
}

/** 断行计算选项 */
export interface BreakOptions {
  /** 禁则配置（缺省 zh-Hans） */
  profile?: KinsokuProfileName | KinsokuProfile;
  /** 是否允许在拉丁单词内断行（缺省 false：英文单词整体不断） */
  breakLatinWords?: boolean;
  /** 是否逐字断行（缺省 true；关闭后仅在空白与标点后断行） */
  perCharacter?: boolean;
  /** 追加的行首禁则字符 */
  extraForbiddenStart?: string;
  /** 追加的行尾禁则字符 */
  extraForbiddenEnd?: string;
}

/** 合并后的禁则判定器 */
interface BreakRules {
  start: Set<string>;
  end: Set<string>;
  breakLatinWords: boolean;
  perCharacter: boolean;
}

function buildRules(options: BreakOptions): BreakRules {
  const profile = resolveKinsokuProfile(options.profile);
  const start = new Set<string>([...profile.forbiddenAtLineStart, ...(options.extraForbiddenStart ?? '')]);
  const end = new Set<string>([...profile.forbiddenAtLineEnd, ...(options.extraForbiddenEnd ?? '')]);
  return {
    start,
    end,
    breakLatinWords: options.breakLatinWords ?? false,
    perCharacter: options.perCharacter ?? true,
  };
}

/** 该字符是否不可居行首 */
export function isForbiddenAtLineStart(
  char: string,
  profile?: KinsokuProfileName | KinsokuProfile,
): boolean {
  if (!char) {
    return false;
  }
  return resolveKinsokuProfile(profile).forbiddenAtLineStart.includes(char);
}

/** 该字符是否不可居行尾 */
export function isForbiddenAtLineEnd(
  char: string,
  profile?: KinsokuProfileName | KinsokuProfile,
): boolean {
  if (!char) {
    return false;
  }
  return resolveKinsokuProfile(profile).forbiddenAtLineEnd.includes(char);
}

/** 判断在 `index` 前断行是否合法 */
function canBreakAt(text: string, index: number, rules: BreakRules): boolean {
  if (index <= 0 || index >= text.length) {
    return false;
  }
  const prev = text[index - 1] ?? '';
  const next = text[index] ?? '';
  if (isHighSurrogate(prev) && isLowSurrogate(next)) {
    return false;
  }
  if (rules.start.has(next) || rules.end.has(prev)) {
    return false;
  }
  if (!rules.perCharacter) {
    const prevIsSpace = prev === ' ' || prev === '\t' || prev === '\u3000';
    if (!prevIsSpace && !rules.breakLatinWords) {
      return false;
    }
  }
  if (!rules.breakLatinWords) {
    const isLatin = (char: string): boolean => /[A-Za-z0-9]/.test(char);
    if (isLatin(prev) && isLatin(next)) {
      return false;
    }
  }
  return true;
}

/**
 * 计算全部合法断点
 *
 * @returns 升序的下标数组，`index` 表示「在第 index 个码元前断行」
 */
export function findBreakOpportunities(text: string, options: BreakOptions = {}): number[] {
  const rules = buildRules(options);
  const breaks: number[] = [];
  for (let index = 1; index < text.length; index += 1) {
    if (canBreakAt(text, index, rules)) {
      breaks.push(index);
    }
  }
  return breaks;
}

/**
 * 按「每行最多 units 个码元」贪心求下一次断点
 *
 * 找不到合法断点（如整行是不可断的长英文串）时退回 `maxUnits`，
 * 由调用方决定溢出处理（缩放 / 强制断词），绝不返回 0 造成死循环。
 *
 * @param text 待排文本
 * @param maxUnits 本行容量（码元数）
 * @param options 禁则选项，额外支持 `from` 起始偏移
 */
export function resolveLineBreak(
  text: string,
  maxUnits: number,
  options: BreakOptions & { from?: number } = {},
): number {
  const start = options.from ?? 0;
  if (maxUnits <= 0 || start >= text.length) {
    return start;
  }
  const limit = Math.min(start + maxUnits, text.length);
  if (limit >= text.length) {
    return text.length;
  }
  const rules = buildRules(options);
  for (let index = limit; index > start; index -= 1) {
    if (canBreakAt(text, index, rules)) {
      return index;
    }
  }
  return limit;
}

/** 按容量切分为多行（用于行盒测量与预览） */
export function splitLines(
  text: string,
  maxUnits: number,
  options: BreakOptions = {},
): string[] {
  if (maxUnits <= 0) {
    throw new RangeError('切分失败：maxUnits 必须为正整数。');
  }
  const lines: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = resolveLineBreak(text, maxUnits, { ...options, from: cursor });
    lines.push(text.slice(cursor, next));
    cursor = next;
  }
  return lines;
}
