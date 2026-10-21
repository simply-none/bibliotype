/**
 * 字体回退链覆盖分析（D10）
 *
 * 「这个字最终由哪款字体画出来」只有宿主环境知道（`document.fonts.check`、
 * 系统字体枚举都属浏览器能力）。core 只定义端口 `GlyphProbe` 与纯函数分析：
 * 输入文本 + 回退链 + 探测函数，输出逐字命中与缺字清单，可完全确定地测试。
 *
 * 缺字标记覆盖两类：
 * - Unicode 私用区（PUA）：字体私有映射，换字体必然错字，需要显式警告；
 * - 全链未命中：任何回退族都没有该字形，浏览器会画豆腐块。
 */

/** 单字覆盖探测端口：返回该字体族在宿主环境中是否具备该字形 */
export interface GlyphProbe {
  /**
   * @param char 单个字符（已按码位切分，含代理对）
   * @param fontFamily 字体族名（CSS `font-family` 中的一项）
   */
  (char: string, fontFamily: string): boolean;
}

/** 单字覆盖结果 */
export interface GlyphCoverageEntry {
  /** 字符本身 */
  char: string;
  /** Unicode 码位（数值） */
  codePoint: number;
  /** Unicode 码位（`U+4E00` 形式，供界面与工单引用） */
  code: string;
  /** 首个命中的字体族；全链未命中时为 undefined */
  family?: string;
  /** 是否缺字（全链未命中） */
  missing: boolean;
  /** 是否位于 Unicode 私用区 */
  privateUse: boolean;
}

/** 覆盖分析报告 */
export interface GlyphCoverageReport {
  /** 逐字结果（按首次出现顺序、已去重） */
  entries: GlyphCoverageEntry[];
  /** 缺字子集（`entries` 的过滤视图） */
  missing: GlyphCoverageEntry[];
  /** 去重后的字符总数 */
  total: number;
  /** 缺字数量 */
  missingCount: number;
  /** 参与分析的回退链（原样保留，供界面展示） */
  families: readonly string[];
}

/** 私用区范围（BMP / 补充私用区 A / 补充私用区 B） */
const PRIVATE_USE_RANGES: readonly (readonly [number, number])[] = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

/** 码位格式化：`U+4E00`（不足四位补零，超出保持原宽） */
export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 是否位于 Unicode 私用区 */
export function isPrivateUseCodePoint(codePoint: number): boolean {
  return PRIVATE_USE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** 无需检查字形的字符（空白 / 控制符）：任何字体都能「画」出空白 */
function isBlank(char: string): boolean {
  return /^\s$/u.test(char) || /^[\u0000-\u001f\u007f]$/u.test(char);
}

/**
 * 分析文本在给定回退链下的字形覆盖
 *
 * @param text 待检查文本（可为整章正文；按码位去重）
 * @param families 字体回退链（顺序即 CSS `font-family` 声明顺序）
 * @param probe 宿主提供的单字探测（测试可注入假实现）
 * @returns 逐字命中与缺字清单（空文本返回空报告）
 */
export function analyzeGlyphCoverage(
  text: string,
  families: readonly string[],
  probe: GlyphProbe,
): GlyphCoverageReport {
  const entries: GlyphCoverageEntry[] = [];
  const seen = new Set<string>();

  for (const char of text) {
    if (isBlank(char) || seen.has(char)) continue;
    seen.add(char);
    const codePoint = char.codePointAt(0) ?? 0;
    const family = families.find((name) => probe(char, name));
    entries.push({
      char,
      codePoint,
      code: formatCodePoint(codePoint),
      ...(family === undefined ? {} : { family }),
      missing: family === undefined,
      privateUse: isPrivateUseCodePoint(codePoint),
    });
  }

  return {
    entries,
    missing: entries.filter((entry) => entry.missing),
    total: entries.length,
    missingCount: entries.filter((entry) => entry.missing).length,
    families: [...families],
  };
}
