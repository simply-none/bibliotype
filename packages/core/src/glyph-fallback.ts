/**
 * 字形回退决策（K6）
 *
 * 回退顺序固定：**主字体链 → IDS 合成 → 方框（tofu）**。
 *
 * - 字体链逐族探测（`GlyphProbe` 由宿主提供，测试注入假实现）；
 * - 全链未命中时，若宿主能给出该字的 IDS 描述，则交给 `layout` 合成字形；
 * - 都不可行才落到方框，并标记 `missing` 供导出前报告。
 *
 * 探测缺省时视为「全部命中」（宁漏报不误报）——与 D10 的字体覆盖分析同口径。
 */
import { formatCodePoint, isPrivateUseCodePoint, type GlyphProbe } from './font-coverage.js';
import { parseIds, type IdsTreeNode } from './ids.js';

/** 回退阶段 */
export type GlyphFallbackStage = 'font' | 'ids' | 'tofu';

/** 单字回退结果 */
export interface GlyphFallbackResolution {
  /** 字符本身 */
  char: string;
  /** Unicode 码位（数值） */
  codePoint: number;
  /** Unicode 码位（`U+4E00`） */
  code: string;
  /** 最终采用的阶段 */
  stage: GlyphFallbackStage;
  /** `stage === 'font'` 时命中的字体族 */
  family?: string;
  /** `stage === 'ids'` 时的 IDS 描述 */
  idsDescription?: string;
  /** `stage === 'ids'` 时解析出的结构树（渲染用） */
  idsTree?: IdsTreeNode;
  /** 是否为缺字（字体与 IDS 都不可用） */
  missing: boolean;
  /** 是否位于私用区（字体私有映射，换字体必错字） */
  privateUse: boolean;
  /** 中文说明（界面 / 报告直接展示） */
  description: string;
}

/** 回退选项 */
export interface GlyphFallbackOptions {
  /** 字体回退链（顺序即 CSS 声明顺序） */
  families: readonly string[];
  /** 单字探测端口；缺省视为全部命中 */
  probe?: GlyphProbe;
  /** 字符 → IDS 描述（宿主提供；本包不内置缺字字典） */
  idsFor?: (char: string) => string | undefined;
}

/**
 * 解析单个字符的回退路径
 *
 * @param char 单个字符（含代理对）
 * @param options 见 {@link GlyphFallbackOptions}
 */
export function resolveGlyphFallback(
  char: string,
  options: GlyphFallbackOptions,
): GlyphFallbackResolution {
  const codePoint = char.codePointAt(0) ?? 0;
  const base = {
    char,
    codePoint,
    code: formatCodePoint(codePoint),
    privateUse: isPrivateUseCodePoint(codePoint),
  };

  const probe = options.probe;
  if (probe === undefined) {
    return {
      ...base,
      stage: 'font',
      family: options.families[0],
      missing: false,
      description: '未提供字体探测，按命中处理',
    };
  }

  const family = options.families.find((name) => probe(char, name));
  if (family !== undefined) {
    return {
      ...base,
      stage: 'font',
      family,
      missing: false,
      description: `由「${family}」绘制`,
    };
  }

  const description = options.idsFor?.(char);
  if (description !== undefined && description.trim() !== '') {
    const parsed = parseIds(description);
    // 只有结构完全合法才合成；缺组件 / 超深的描述按缺字处理（避免画出错字）
    if (parsed.tree !== undefined && parsed.issues.length === 0) {
      return {
        ...base,
        stage: 'ids',
        idsDescription: description,
        idsTree: parsed.tree,
        missing: false,
        description: `字体缺失，改用 IDS「${description}」合成`,
      };
    }
  }

  return {
    ...base,
    stage: 'tofu',
    missing: true,
    description: `缺字 ${formatCodePoint(codePoint)}，无可用字体或 IDS 描述`,
  };
}

/** 把回退结果格式化成一行中文（报告 / 调试面板） */
export function describeGlyphFallback(resolution: GlyphFallbackResolution): string {
  const parts = [`${resolution.char}（${resolution.code}）`, resolution.description];
  if (resolution.privateUse) parts.push('私用区字符');
  return parts.join('：');
}
