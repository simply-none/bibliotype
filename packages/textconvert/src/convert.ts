/**
 * 表驱动转换器
 *
 * 匹配优先级：词组（长度降序）→ 单字 → 原样保留。
 * `to === from` 的词组视为「保护规则」（如「皇后」不转成「皇后→皇后」以外的形态，
 * 同时阻止其中的「後」被单字规则改写）。
 */
import { TRADITIONAL_TO_SIMPLIFIED } from './traditional-table.js';
import type {
  ConversionEntry,
  ConversionHit,
  ConversionResult,
  TextConversionTable,
  TextConverter,
} from './types.js';

/** 反向转换时需跳过的简体目标字（一对多或义项歧义） */
export const AMBIGUOUS_SIMPLIFIED = new Set<string>([
  '后',
  '发',
  '里',
  '面',
  '干',
  '台',
  '只',
  '云',
  '历',
  '种',
  '斗',
  '余',
  '于',
  '系',
]);

/** 索引化后的转换表 */
interface TableIndex {
  chars: Map<string, string>;
  phrasesByFirst: Map<string, ConversionEntry[]>;
}

function buildIndex(table: TextConversionTable): TableIndex {
  const chars = new Map<string, string>();
  const phrases: ConversionEntry[] = [...(table.phrases ?? [])];
  table.entries.forEach((entry) => {
    if (!entry.from) {
      throw new RangeError('转换表非法：存在空的 from 规则。');
    }
    if (entry.from.length === 1) {
      const existing = chars.get(entry.from);
      if (existing !== undefined && existing !== entry.to) {
        throw new RangeError(`转换表非法：字 "${entry.from}" 存在互相冲突的规则。`);
      }
      chars.set(entry.from, entry.to);
    } else {
      phrases.push(entry);
    }
  });

  const phrasesByFirst = new Map<string, ConversionEntry[]>();
  phrases
    .sort((left, right) => right.from.length - left.from.length)
    .forEach((entry) => {
      const first = entry.from[0] ?? '';
      const bucket = phrasesByFirst.get(first);
      if (bucket) {
        bucket.push(entry);
      } else {
        phrasesByFirst.set(first, [entry]);
      }
    });
  return { chars, phrasesByFirst };
}

/** 取一个完整字符（代理对视为整体） */
function charAt(text: string, index: number): string {
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    return text.slice(index, index + 2);
  }
  return text[index] ?? '';
}

/** 执行转换并记录命中 */
function runConvert(text: string, table: TextConversionTable): ConversionResult {
  const index = buildIndex(table);
  const hits: ConversionHit[] = [];
  let output = '';
  let cursor = 0;

  while (cursor < text.length) {
    const first = charAt(text, cursor);
    const bucket = index.phrasesByFirst.get(first);
    const phrase = bucket?.find((entry) => text.startsWith(entry.from, cursor));
    if (phrase) {
      if (phrase.from !== phrase.to) {
        hits.push({ offset: cursor, from: phrase.from, to: phrase.to });
      }
      output += phrase.to;
      cursor += phrase.from.length;
      continue;
    }

    const char = charAt(text, cursor);
    const mapped = index.chars.get(char);
    if (mapped !== undefined && mapped !== char) {
      hits.push({ offset: cursor, from: char, to: mapped });
      output += mapped;
    } else {
      output += char;
    }
    cursor += char.length;
  }

  return { text: output, hits };
}

/** 由转换表创建转换器 */
export function createTableConverter(table: TextConversionTable): TextConverter {
  if (!table.id) {
    throw new RangeError('创建转换器失败：转换表缺少 id。');
  }
  // 提前索引一次以尽早暴露冲突规则（后续 convert 复用同一份校验结果）
  buildIndex(table);
  return {
    id: table.id,
    name: table.name,
    convert: (text: string): string => runConvert(text, table).text,
    convertWithHits: (text: string): ConversionResult => runConvert(text, table),
  };
}

/** 用内置繁简表直接转换文本 */
export function convertText(
  text: string,
  table: TextConversionTable = TRADITIONAL_TO_SIMPLIFIED,
): string {
  return runConvert(text, table).text;
}

/** 外部转换器（OpenCC 等）选项 */
export interface ExternalConverterOptions {
  /** 转换器标识（缺省 `external`） */
  id?: string;
  /** 转换器名称 */
  name?: string;
}

/**
 * 包装外部转换实现（如 `opencc-js`）
 *
 * 外部实现不提供逐字命中记录，`convertWithHits` 的 hits 恒为空数组。
 */
export function createOpenCcConverter(
  convert: (text: string) => string,
  options: ExternalConverterOptions = {},
): TextConverter {
  return {
    id: options.id ?? 'external',
    name: options.name ?? '外部转换器',
    convert,
    convertWithHits: (text: string): ConversionResult => ({ text: convert(text), hits: [] }),
  };
}

/** 找出转换表中「多个源字指向同一目标」的歧义目标 */
export function findAmbiguousTargets(table: TextConversionTable): string[] {
  const counts = new Map<string, number>();
  table.entries.forEach((entry) => {
    counts.set(entry.to, (counts.get(entry.to) ?? 0) + 1);
  });
  return [...counts.entries()]
    .filter(([target, count]) => count > 1 || AMBIGUOUS_SIMPLIFIED.has(target))
    .map(([target]) => target)
    .sort();
}

/** 反向表选项 */
export interface ReverseTableOptions {
  /** 新表 id（缺省 `<原 id>-reversed`） */
  id?: string;
  /** 新表名称（缺省 `原名称（反向）`） */
  name?: string;
}

/**
 * 生成反向转换表（简 → 繁）
 *
 * 一对多目标（发 / 后 / 里 …）与义项歧义字会被跳过：宁可不转，也不产生错字。
 * 需要严格相反转换时请使用 `createOpenCcConverter`。
 */
export function reverseTable(
  table: TextConversionTable,
  options: ReverseTableOptions = {},
): TextConversionTable {
  const ambiguous = new Set(findAmbiguousTargets(table));
  const entries: ConversionEntry[] = [];
  table.entries.forEach((entry) => {
    if (ambiguous.has(entry.to)) {
      return;
    }
    entries.push({ from: entry.to, to: entry.from });
  });
  return {
    id: options.id ?? `${table.id}-reversed`,
    name: options.name ?? `${table.name}（反向）`,
    entries,
    phrases: (table.phrases ?? [])
      .filter((entry) => entry.from !== entry.to)
      .map((entry) => ({ from: entry.to, to: entry.from })),
  };
}

/** 命中统计（按源文本聚合，便于预览与差异高亮） */
export function summarizeHits(hits: readonly ConversionHit[]): {
  total: number;
  byFrom: Record<string, number>;
} {
  const byFrom: Record<string, number> = {};
  hits.forEach((hit) => {
    byFrom[hit.from] = (byFrom[hit.from] ?? 0) + 1;
  });
  return { total: hits.length, byFrom };
}
