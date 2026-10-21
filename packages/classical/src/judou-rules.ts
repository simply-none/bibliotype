/**
 * 句读候选规则（K3，纯函数）
 *
 * 目标：在不改动正文的前提下，给出「此处宜加逗号 / 句号」的候选位置，
 * 由人工在审阅面板逐条接受。规则只覆盖**高频、低争议**的几类信号：
 *
 * - 句末语气词（也 / 矣 / 焉 / 哉 / 耳 / 乎 / 耶 / 邪 / 夫 / 兮）→ 句号；
 * - 提示语（曰 / 云 / 问）→ 冒号；
 * - 句首连词（然而 / 是以 / 故 / 则 / 而 / 若 …）→ 其前加逗号。
 *
 * 设计约束：
 * - 纯函数、无 DOM、无存储，输入文本 + 偏移即可测；
 * - 偏移一律用 **UTF-16 code unit**（与 ProseMirror 位置口径一致）；
 * - 已有标点之后不再重复建议，同一位置只保留置信度最高的一条；
 * - 不生成「删除 / 替换」建议——句读只加不删，保持可逆。
 */

/** 句读建议可用的标点符号 */
export type JudouSymbol = '，' | '。' | '；' | '：' | '、' | '？' | '！';

/** 全部句读符号（UI 下拉、校验与测试共用） */
export const JUDOU_SYMBOLS: readonly JudouSymbol[] = ['，', '。', '；', '：', '、', '？', '！'];

/** 已存在的标点：其后不再建议新句读，避免「重标」 */
export const EXISTING_PUNCTUATION: ReadonlySet<string> = new Set([
  ...'，。；：、？！…—·「」『』（）《》〈〉【】〔〕',
  ...',.;:?!()[]{}"\'',
]);

/** 单条句读候选 */
export interface JudouCandidate {
  /** 插入偏移（UTF-16 code unit）：标点应插在该位置之前、前一个字之后 */
  offset: number;
  /** 建议符号 */
  symbol: JudouSymbol;
  /** 命中规则 id（便于回溯与统计） */
  rule: string;
  /** 置信度 0~1（审阅面板排序用，不是概率承诺） */
  confidence: number;
  /** 中文理由（面板内直接展示） */
  reason: string;
}

/** 规则选项 */
export interface JudouRuleOptions {
  /** 最多返回条数（按偏移升序截断，缺省不限） */
  limit?: number;
  /** 是否把「文末无标点」也算一处（缺省 true） */
  suggestTrailingStop?: boolean;
}

/** 句末语气词 */
const SENTENCE_FINAL_PARTICLES: ReadonlySet<string> = new Set([
  '也',
  '矣',
  '焉',
  '哉',
  '耳',
  '乎',
  '耶',
  '邪',
  '夫',
  '兮',
]);

/** 提示语：其后通常是引语，宜加冒号 */
const SPEECH_VERBS: ReadonlySet<string> = new Set(['曰', '云', '問', '问']);

/**
 * 句首连词（最长优先匹配）
 *
 * 只收「出现在分句开头、需要停顿」的词；单字连词（而 / 则 / 故 …）也在列，
 * 因为古文中它们极少作句末字，误标影响小于漏标。
 */
const CLAUSE_CONJUNCTIONS: readonly string[] = [
  '然而',
  '然則',
  '然则',
  '是以',
  '是故',
  '於是',
  '于是',
  '若夫',
  '且夫',
  '今夫',
  '雖',
  '虽',
  '然',
  '故',
  '則',
  '则',
  '而',
  '且',
  '乃',
  '遂',
  '因',
  '苟',
  '若',
];

/** 判断单个字符是否为标点（含中英文常用标点） */
function isPunctuation(char: string | undefined): boolean {
  return char !== undefined && EXISTING_PUNCTUATION.has(char);
}

/** 去掉同偏移的重复候选（保留置信度最高，再按偏移升序） */
function dedupe(candidates: readonly JudouCandidate[]): JudouCandidate[] {
  const best = new Map<number, JudouCandidate>();
  for (const candidate of candidates) {
    const current = best.get(candidate.offset);
    if (current === undefined || candidate.confidence > current.confidence) {
      best.set(candidate.offset, candidate);
    }
  }
  return [...best.values()].sort((a, b) => a.offset - b.offset);
}

/**
 * 生成句读候选
 *
 * @param text 纯文本（不含块级结构；调用方按段传入，避免跨段误判）
 * @param options 见 {@link JudouRuleOptions}
 * @returns 按偏移升序的候选；文本为空 / 全是标点时返回空数组
 */
export function suggestJudou(text: string, options: JudouRuleOptions = {}): JudouCandidate[] {
  const { limit, suggestTrailingStop = true } = options;
  const chars = Array.from(text);
  if (chars.length === 0) return [];

  const candidates: JudouCandidate[] = [];
  /** 当前字符的 UTF-16 起始偏移 */
  let offset = 0;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? '';
    const next = chars[index + 1];
    const after = offset + char.length;
    const previous = chars[index - 1];
    const atEnd = next === undefined;

    /* 1. 句末语气词 → 句号（文末无标点也算） */
    if (SENTENCE_FINAL_PARTICLES.has(char) && !isPunctuation(next)) {
      const trailing = atEnd;
      if (!trailing || suggestTrailingStop) {
        candidates.push({
          offset: after,
          symbol: '。',
          rule: 'sentence-final',
          confidence: trailing ? 0.7 : 0.8,
          reason: `「${char}」多为句末语气词，宜断句`,
        });
      }
    }

    /* 2. 提示语 → 冒号（后面已有标点则跳过） */
    if (SPEECH_VERBS.has(char) && !atEnd && !isPunctuation(next)) {
      candidates.push({
        offset: after,
        symbol: '：',
        rule: 'speech-verb',
        confidence: 0.85,
        reason: `「${char}」后接引语，宜用冒号提示`,
      });
    }

    /* 3. 句首连词 → 其前加逗号 */
    if (offset > 0 && !isPunctuation(previous)) {
      const rest = chars.slice(index, index + 4).join('');
      const match = CLAUSE_CONJUNCTIONS.find((word) => rest.startsWith(word));
      if (match !== undefined) {
        candidates.push({
          offset,
          symbol: '，',
          rule: 'clause-conjunction',
          confidence: match.length > 1 ? 0.7 : 0.6,
          reason: `「${match}」多引出一个分句，其前宜停顿`,
        });
      }
    }

    offset = after;
  }

  const result = dedupe(candidates);
  return limit === undefined ? result : result.slice(0, Math.max(0, limit));
}

/**
 * 把句读候选折算成「建议标记的前一个字区间」
 *
 * 标记包裹前一个字（`offset - 1` 至 `offset`），渲染层据此在该字后用 CSS
 * 伪元素显示候选符号；这样「接受」只是加一个 mark，不改变正文字符。
 *
 * @returns 偏移非法的候选（`offset <= 0`）返回 `undefined`
 */
export function judouMarkerRange(
  candidate: Pick<JudouCandidate, 'offset'>,
  text: string,
): { start: number; end: number } | undefined {
  const { offset } = candidate;
  if (!Number.isInteger(offset) || offset <= 0 || offset > text.length) return undefined;
  return { start: offset - 1, end: offset };
}
