/**
 * 专名识别（K3，纯函数 + 宿主端口）
 *
 * 分两层：
 * 1. **内置字典**：高频人名 / 书名 / 国名 / 朝代，按最长优先、不重叠匹配；
 * 2. **模型端口**：`ProperNameDetector` 由宿主注入（可接 NER 服务或本地模型），
 *    本包不内置模型、不发网络请求；模型结果与字典结果合并去重。
 *
 * 约束：
 * - 纯函数、无 DOM、无存储，偏移为 UTF-16 code unit；
 * - 命中区间互不重叠（同一段文字只归一个专名，避免叠加专名号）；
 * - 只给「建议」，是否落成 `proper-name` 标记由人工确认。
 */

/** 专名类别 */
export type ProperNameKind = 'person' | 'place' | 'dynasty' | 'book' | 'office';

/** 字典条目 */
export interface ProperNameTerm {
  /** 词形（与正文完全一致，繁简各收一条） */
  name: string;
  /** 类别 */
  kind: ProperNameKind;
}

/** 专名命中 */
export interface ProperNameMatch {
  /** 段内起始偏移（含） */
  start: number;
  /** 段内结束偏移（不含） */
  end: number;
  /** 命中的词形 */
  name: string;
  /** 类别 */
  kind: ProperNameKind;
  /** 来源：字典 / 模型 */
  source: 'dictionary' | 'model';
  /** 置信度 0~1 */
  confidence: number;
}

/** 模型端口入参 */
export interface ProperNameDetectorInput {
  /** 段落纯文本 */
  text: string;
  /** 内置字典（模型可参考，也可忽略） */
  terms: readonly ProperNameTerm[];
}

/**
 * 专名模型端口
 *
 * 实现方返回的区间必须落在 `text` 范围内；实现方可抛错，由调用方决定如何提示，
 * 本包不吞异常（避免「识别失败却显示为没有专名」）。
 */
export type ProperNameDetector = (
  input: ProperNameDetectorInput,
) => readonly ProperNameMatch[];

/**
 * 内置专名词典
 *
 * 只收**两字及以上、歧义低**的词形：单字国名 / 朝代（齐、宋）在古文中常作
 * 普通词使用，收进来会大量误标，故只收「齊國」「北宋」这类完整词形。
 */
export const BUILTIN_PROPER_NAME_TERMS: readonly ProperNameTerm[] = [
  /* ---------- 人物 ---------- */
  { name: '孔子', kind: 'person' },
  { name: '孟子', kind: 'person' },
  { name: '荀子', kind: 'person' },
  { name: '老子', kind: 'person' },
  { name: '莊子', kind: 'person' },
  { name: '庄子', kind: 'person' },
  { name: '曾子', kind: 'person' },
  { name: '有子', kind: 'person' },
  { name: '子夏', kind: 'person' },
  { name: '子貢', kind: 'person' },
  { name: '子贡', kind: 'person' },
  { name: '子路', kind: 'person' },
  { name: '顏回', kind: 'person' },
  { name: '颜回', kind: 'person' },
  { name: '朱熹', kind: 'person' },
  { name: '程頤', kind: 'person' },
  { name: '程颐', kind: 'person' },
  { name: '程顥', kind: 'person' },
  { name: '程颢', kind: 'person' },
  { name: '王陽明', kind: 'person' },
  { name: '王阳明', kind: 'person' },
  { name: '韓愈', kind: 'person' },
  { name: '韩愈', kind: 'person' },
  { name: '柳宗元', kind: 'person' },
  { name: '歐陽修', kind: 'person' },
  { name: '欧阳修', kind: 'person' },
  { name: '蘇軾', kind: 'person' },
  { name: '苏轼', kind: 'person' },
  { name: '王安石', kind: 'person' },
  { name: '司馬遷', kind: 'person' },
  { name: '司马迁', kind: 'person' },
  { name: '班固', kind: 'person' },
  { name: '鄭玄', kind: 'person' },
  { name: '郑玄', kind: 'person' },
  { name: '孔穎達', kind: 'person' },
  { name: '孔颖达', kind: 'person' },
  { name: '劉向', kind: 'person' },
  { name: '刘向', kind: 'person' },
  { name: '許慎', kind: 'person' },
  { name: '许慎', kind: 'person' },
  { name: '段玉裁', kind: 'person' },
  { name: '戴震', kind: 'person' },
  { name: '章學誠', kind: 'person' },
  { name: '章学诚', kind: 'person' },
  { name: '顧炎武', kind: 'person' },
  { name: '顾炎武', kind: 'person' },
  { name: '黃宗羲', kind: 'person' },
  { name: '黄宗羲', kind: 'person' },
  { name: '王夫之', kind: 'person' },
  { name: '曾國藩', kind: 'person' },
  { name: '曾国藩', kind: 'person' },

  /* ---------- 典籍 ---------- */
  { name: '論語', kind: 'book' },
  { name: '论语', kind: 'book' },
  { name: '大學', kind: 'book' },
  { name: '大学', kind: 'book' },
  { name: '中庸', kind: 'book' },
  { name: '詩經', kind: 'book' },
  { name: '诗经', kind: 'book' },
  { name: '尚書', kind: 'book' },
  { name: '尚书', kind: 'book' },
  { name: '周易', kind: 'book' },
  { name: '春秋', kind: 'book' },
  { name: '禮記', kind: 'book' },
  { name: '礼记', kind: 'book' },
  { name: '左傳', kind: 'book' },
  { name: '左传', kind: 'book' },
  { name: '史記', kind: 'book' },
  { name: '史记', kind: 'book' },
  { name: '漢書', kind: 'book' },
  { name: '汉书', kind: 'book' },
  { name: '三國志', kind: 'book' },
  { name: '三国志', kind: 'book' },
  { name: '資治通鑑', kind: 'book' },
  { name: '资治通鉴', kind: 'book' },
  { name: '說文解字', kind: 'book' },
  { name: '说文解字', kind: 'book' },
  { name: '爾雅', kind: 'book' },
  { name: '尔雅', kind: 'book' },
  { name: '廣韻', kind: 'book' },
  { name: '广韵', kind: 'book' },
  { name: '文選', kind: 'book' },
  { name: '文选', kind: 'book' },
  { name: '楚辭', kind: 'book' },
  { name: '楚辞', kind: 'book' },

  /* ---------- 国名 / 朝代（避开单字高频词） ---------- */
  { name: '魯國', kind: 'place' },
  { name: '鲁国', kind: 'place' },
  { name: '齊國', kind: 'place' },
  { name: '齐国', kind: 'place' },
  { name: '衛國', kind: 'place' },
  { name: '卫国', kind: 'place' },
  { name: '晉國', kind: 'place' },
  { name: '晋国', kind: 'place' },
  { name: '楚國', kind: 'place' },
  { name: '楚国', kind: 'place' },
  { name: '秦國', kind: 'place' },
  { name: '秦国', kind: 'place' },
  { name: '大唐', kind: 'dynasty' },
  { name: '北宋', kind: 'dynasty' },
  { name: '南宋', kind: 'dynasty' },
  { name: '漢代', kind: 'dynasty' },
  { name: '汉代', kind: 'dynasty' },
  { name: '唐代', kind: 'dynasty' },
  { name: '宋代', kind: 'dynasty' },
  { name: '明代', kind: 'dynasty' },
  { name: '清代', kind: 'dynasty' },
];

/** 按长度降序排列的字典（最长优先匹配） */
function sortByLengthDesc(terms: readonly ProperNameTerm[]): ProperNameTerm[] {
  return terms
    .slice()
    .sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
}

/** 字典匹配：最长优先、命中间隔后跳过，保证区间不重叠 */
function matchDictionary(
  text: string,
  terms: readonly ProperNameTerm[],
): ProperNameMatch[] {
  const sorted = sortByLengthDesc(terms);
  const matches: ProperNameMatch[] = [];
  let index = 0;
  while (index < text.length) {
    const hit = sorted.find((term) => text.startsWith(term.name, index));
    if (hit === undefined) {
      index += 1;
      continue;
    }
    matches.push({
      start: index,
      end: index + hit.name.length,
      name: hit.name,
      kind: hit.kind,
      source: 'dictionary',
      confidence: 0.9,
    });
    index += hit.name.length;
  }
  return matches;
}

/** 去掉重叠区间：先到者优先（字典结果在前，长词优先） */
function removeOverlaps(matches: readonly ProperNameMatch[]): ProperNameMatch[] {
  const sorted = matches
    .slice()
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const result: ProperNameMatch[] = [];
  let cursor = 0;
  for (const match of sorted) {
    if (match.start < cursor) continue;
    result.push(match);
    cursor = match.end;
  }
  return result;
}

/** 模型端口结果的基础校验（越界 / 空区间 / 顺序颠倒直接丢弃） */
function isValidMatch(match: ProperNameMatch, length: number): boolean {
  return (
    Number.isInteger(match.start) &&
    Number.isInteger(match.end) &&
    match.start >= 0 &&
    match.end > match.start &&
    match.end <= length
  );
}

/**
 * 识别专名
 *
 * @param text 段落纯文本（调用方按段传入，避免跨段重叠）
 * @param options.terms 自定义字典（缺省 {@link BUILTIN_PROPER_NAME_TERMS}）
 * @param options.detector 宿主模型端口（缺省只用字典）
 * @returns 按起始偏移升序、互不重叠的命中
 */
export function detectProperNames(
  text: string,
  options: {
    terms?: readonly ProperNameTerm[];
    detector?: ProperNameDetector;
  } = {},
): ProperNameMatch[] {
  if (text.length === 0) return [];
  const terms = options.terms ?? BUILTIN_PROPER_NAME_TERMS;
  const dictionary = matchDictionary(text, terms);
  if (options.detector === undefined) return dictionary;

  const model = options.detector({ text, terms })
    .filter((match) => isValidMatch(match, text.length))
    .map<ProperNameMatch>((match) => ({
      ...match,
      source: 'model',
      kind: match.kind ?? 'person',
      confidence: Number.isFinite(match.confidence) ? match.confidence : 0.7,
    }));

  /* 同区间以模型结果为准（模型语义更细）；不同区间交给重叠裁剪 */
  const merged = dictionary.filter(
    (hit) => !model.some((item) => item.start === hit.start && item.end === hit.end),
  );
  return removeOverlaps([...model, ...merged]);
}
