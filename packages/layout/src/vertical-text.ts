/**
 * 竖排文字细节（B7 落地）
 *
 * 竖排（`vertical-rl` / `vertical-lr`）除了书写方向与行款，还要处理两类字符形态：
 * - **标点 / 引号**：横排字形在竖排中位置错位（句号跑到左下、引号横躺），
 *   须换用 Unicode 竖排形态（`︒` `︑` `﹁` `﹂`…）；浏览器虽有 OpenType `vert`
 *   特性可自动替换，但导出管线（PDF / EPUB）、无该特性的渲染环境、以及需要
 *   「所见即所得」逐字控制的场景仍需显式转换；
 * - **数字**：阿拉伯数字在竖排中默认侧转或合并（见 `combine-upright.ts`），
 *   古籍 / 港台排版可选用「汉字数字直排」（`1850` → `一八五〇`）或全角数字。
 *
 * 本模块全部为纯函数，且**逐字符一一对应**（不含增删字符），因此可直接用于
 * 已分页 / 已量测的文本而不改变字符偏移（`lineOffsets` / `charRange` 口径不变）。
 */

/** 竖排标点 / 引号 / 括号形态表（横排字符 → Unicode 竖排呈现形式） */
export const VERTICAL_PUNCTUATION_FORMS: Readonly<Record<string, string>> = {
  '，': '︐',
  '、': '︑',
  '。': '︒',
  '：': '︓',
  '；': '︔',
  '！': '︕',
  '？': '︖',
  '（': '︵',
  '）': '︶',
  '〔': '︹',
  '〕': '︺',
  '…': '︙',
  '「': '﹁',
  '」': '﹂',
  '『': '﹃',
  '』': '﹄',
  '【': '﹇',
  '】': '﹈',
  '〈': '︿',
  '〉': '﹀',
  '《': '︽',
  '》': '︾',
};

/** 数字形态策略 */
export const VERTICAL_DIGIT_STYLES = {
  /** 保持原样（阿拉伯数字，交给 text-combine-upright / 侧转策略） */
  NONE: 'none',
  /** 汉字数字直排：1850 → 一八五〇 */
  KANJI: 'kanji',
  /** 全角数字：1850 → １８５０ */
  FULLWIDTH: 'fullwidth',
} as const;

/** 数字形态策略联合 */
export type VerticalDigitStyle =
  (typeof VERTICAL_DIGIT_STYLES)[keyof typeof VERTICAL_DIGIT_STYLES];

/** 竖排文字转换选项 */
export interface VerticalTextOptions {
  /** 标点 / 引号替换为竖排形态（缺省 true） */
  punctuation?: boolean;
  /** 数字形态（缺省 'none'，保持原样） */
  digits?: VerticalDigitStyle;
}

/** 汉字数字（0-9） */
const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 半角 / 全角阿拉伯数字 */
const DIGIT_RE = /^[0-9０-９]$/;

/** 单字符 → 竖排形态（无对应形式返回 undefined） */
export function verticalPunctuationOf(char: string): string | undefined {
  return VERTICAL_PUNCTUATION_FORMS[char];
}

/** 标点 / 引号整体替换为竖排形态（逐字符一一对应） */
export function toVerticalPunctuation(text: string): string {
  let out = '';
  for (const char of text) {
    out += VERTICAL_PUNCTUATION_FORMS[char] ?? char;
  }
  return out;
}

/** 半角 / 全角数字 → 汉字数字（逐字符一一对应，小数点和分隔符原样保留） */
export function toKanjiDigits(text: string): string {
  let out = '';
  for (const char of text) {
    if (DIGIT_RE.test(char)) {
      const code = char.charCodeAt(0);
      const digit = code >= 0xff10 ? code - 0xff10 : code - 0x30;
      out += KANJI_DIGITS[digit] ?? char;
      continue;
    }
    out += char;
  }
  return out;
}

/** 半角数字 → 全角数字（已是全角 / 非数字原样保留） */
export function toFullwidthDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    out += code >= 0x30 && code <= 0x39 ? String.fromCharCode(code + 0xfee0) : char;
  }
  return out;
}

/**
 * 竖排文字转换：标点竖排形态 + 可选数字形态
 *
 * 转换逐字符一一对应（UTF-16 长度不变，代理对字符整体透传），可安全作用于
 * 已分页 / 已实测的文本。
 */
export function transformVerticalText(text: string, options: VerticalTextOptions = {}): string {
  if (text.length === 0) return text;
  const punctuation = options.punctuation !== false;
  const digits = options.digits ?? VERTICAL_DIGIT_STYLES.NONE;
  if (!punctuation && digits === VERTICAL_DIGIT_STYLES.NONE) return text;

  let out = '';
  for (const char of text) {
    let next = punctuation ? (VERTICAL_PUNCTUATION_FORMS[char] ?? char) : char;
    if (digits !== VERTICAL_DIGIT_STYLES.NONE && DIGIT_RE.test(next)) {
      const code = next.charCodeAt(0);
      const digit = code >= 0xff10 ? code - 0xff10 : code - 0x30;
      next =
        digits === VERTICAL_DIGIT_STYLES.KANJI
          ? (KANJI_DIGITS[digit] ?? next)
          : String.fromCharCode(0xff10 + digit);
    }
    out += next;
  }
  return out;
}

/** 文本是否需要竖排转换（按给定选项判断，供渲染层跳过无谓遍历） */
export function needsVerticalTextTransform(text: string, options: VerticalTextOptions = {}): boolean {
  const punctuation = options.punctuation !== false;
  const digits = options.digits ?? VERTICAL_DIGIT_STYLES.NONE;
  for (const char of text) {
    if (punctuation && VERTICAL_PUNCTUATION_FORMS[char] !== undefined) return true;
    if (digits !== VERTICAL_DIGIT_STYLES.NONE && DIGIT_RE.test(char)) return true;
  }
  return false;
}
