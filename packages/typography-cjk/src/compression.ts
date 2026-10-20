/**
 * 标点挤压
 *
 * 中文标点都是全角（1em 宽），但两个标点连排时（`。」`、`，、`）视觉上会拉出一道空档。
 * 纸书做法是把后续标点压到半角，本模块把该规则算成「位置 → 挤压量」的调整表，
 * 由渲染层转成 `letter-spacing` / `margin-inline` 或 CSS `text-spacing-trim`。
 *
 * 纯函数：不读写 DOM，输出可缓存、可测试、可跨端（预览 / 导出 / PDF）复用。
 */

/** 参与挤压判定的标点（全角收束性标点） */
export const DEFAULT_SQUEEZE_CHARS = '。，、；：？！）〕］｝〉》」』】〗〙〛”’…‥·';

/** 挤压选项 */
export interface CompressionOptions {
  /** 每个「后续标点」的挤压量（em，缺省 0.5 = 压到半角） */
  squeezeEm?: number;
  /** 参与挤压的字符集合（缺省 DEFAULT_SQUEEZE_CHARS） */
  squeezeChars?: string;
}

/** 连续标点段 */
export interface PunctuationRun {
  /** 起始偏移（含） */
  start: number;
  /** 结束偏移（不含） */
  end: number;
  /** 段内文本 */
  text: string;
}

/** 单处挤压调整 */
export interface PunctuationAdjustment {
  /** 字符偏移（UTF-16 码元下标） */
  offset: number;
  /** 该位置的字符 */
  char: string;
  /** 需挤压的量（em） */
  squeezeEm: number;
}

function squeezeSet(options: CompressionOptions): Set<string> {
  return new Set<string>([...(options.squeezeChars ?? DEFAULT_SQUEEZE_CHARS)]);
}

/** 找出全部连续标点段（长度 ≥ 2 才可能与挤压相关，但仍全部返回） */
export function findPunctuationRuns(
  text: string,
  options: CompressionOptions = {},
): PunctuationRun[] {
  const chars = squeezeSet(options);
  const runs: PunctuationRun[] = [];
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    const isPunctuation = chars.has(char);
    if (isPunctuation && start < 0) {
      start = index;
    }
    if (!isPunctuation && start >= 0) {
      runs.push({ start, end: index, text: text.slice(start, index) });
      start = -1;
    }
  }
  if (start >= 0) {
    runs.push({ start, end: text.length, text: text.slice(start) });
  }
  return runs;
}

/**
 * 计算挤压调整表
 *
 * 规则：连续标点段内，**首个标点保持全角**，其余各压 `squeezeEm`；
 * 单标点不挤压（行首行尾的悬挂由 CSS `hanging-punctuation` 处理，不在文本层做）。
 */
export function buildCompressionAdjustments(
  text: string,
  options: CompressionOptions = {},
): PunctuationAdjustment[] {
  const squeezeEm = options.squeezeEm ?? 0.5;
  if (squeezeEm <= 0) {
    return [];
  }
  const adjustments: PunctuationAdjustment[] = [];
  findPunctuationRuns(text, options).forEach((run) => {
    for (let offset = run.start + 1; offset < run.end; offset += 1) {
      const char = text[offset] ?? '';
      adjustments.push({ offset, char, squeezeEm });
    }
  });
  return adjustments;
}

/** 挤压调整表的总宽度收益（em），用于估算行宽与判断是否值得启用 */
export function totalSqueezeEm(adjustments: readonly PunctuationAdjustment[]): number {
  return adjustments.reduce((total, item) => total + item.squeezeEm, 0);
}
