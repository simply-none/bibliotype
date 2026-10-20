/**
 * 编辑态文本查找与替换（无 DOM，纯 EditorState 层）
 *
 * 与 Reader.search（阅读态、逐块摘录）不同：这里产出的是 ProseMirror 文档坐标
 * 上的匹配区间，供编辑画布内选中、逐处替换与全部替换复用。
 * 逐 text 节点扫描，匹配不跨节点边界；默认字面匹配，可切正则 / 整词 / 范围限定。
 */
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Node as PmNode } from 'prosemirror-model';

/** 一处文本匹配（文档坐标区间，from 含、to 不含） */
export interface TextMatch {
  from: number;
  to: number;
}

/** 查找选项 */
export interface EditorSearchOptions {
  /** 大小写敏感（默认 false） */
  caseSensitive?: boolean;
  /** 把查询串按正则解释（默认 false = 字面匹配；非法正则返回空结果） */
  regex?: boolean;
  /**
   * 整词匹配（默认 false）
   *
   * 仅对「以拉丁字母 / 数字开头或结尾」的查询生效（按 ASCII 词边界判定）；
   * 中文没有词边界，CJK 查询保持子串匹配。
   */
  wholeWord?: boolean;
  /** 限定文档坐标范围（半开区间，按匹配区间整体落在范围内过滤） */
  range?: { from: number; to: number };
  /** 结果上限（默认 0 = 不限） */
  limit?: number;
}

/** 拉丁 / 数字词字符（整词边界判定） */
const WORD_CHAR_PATTERN = /[A-Za-z0-9_]/;

/** 转义正则元字符（字面匹配用） */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 是否启用选项形态（兼容旧的三参 `caseSensitive: boolean` 调用） */
function normalizeOptions(options?: boolean | EditorSearchOptions): EditorSearchOptions {
  if (typeof options === 'boolean') {
    return { caseSensitive: options };
  }
  return options ?? {};
}

/**
 * 构造查询正则（全局）
 *
 * - 字面匹配时转义元字符；正则模式原样编译；
 * - 非法正则抛 `SyntaxError`（查找入口会捕获并返回空结果）。
 */
export function buildSearchRegExp(
  query: string,
  options?: boolean | EditorSearchOptions,
): RegExp {
  const resolved = normalizeOptions(options);
  const source = resolved.regex === true ? query : escapeRegExp(query);
  const flags = resolved.caseSensitive === true ? 'g' : 'gi';
  return new RegExp(source, flags);
}

/** 整词边界判定：查询首 / 尾为词字符时，要求文本相邻字符不是词字符 */
function isWholeWordHit(text: string, index: number, length: number): boolean {
  const head = text[index] ?? '';
  const tail = text[index + length - 1] ?? '';
  if (WORD_CHAR_PATTERN.test(head)) {
    const before = text[index - 1];
    if (before !== undefined && WORD_CHAR_PATTERN.test(before)) {
      return false;
    }
  }
  if (WORD_CHAR_PATTERN.test(tail)) {
    const after = text[index + length];
    if (after !== undefined && WORD_CHAR_PATTERN.test(after)) {
      return false;
    }
  }
  return true;
}

/**
 * 在文档中查找 query 的匹配区间
 *
 * - 逐 text 节点扫描（匹配不跨越节点 / 标记边界）；
 * - `caseSensitive` 缺省 false（大小写不敏感）；query 为空返回空数组；
 * - 正则非法时返回空数组（输入过程中不抛错，由 UI 自行提示）。
 */
export function findTextMatches(
  doc: PmNode,
  query: string,
  options?: boolean | EditorSearchOptions,
): TextMatch[] {
  const matches: TextMatch[] = [];
  if (query === '') {
    return matches;
  }
  const resolved = normalizeOptions(options);
  let pattern: RegExp;
  try {
    pattern = buildSearchRegExp(query, resolved);
  } catch {
    return matches;
  }
  const range = resolved.range;
  const limit = resolved.limit !== undefined && resolved.limit > 0 ? resolved.limit : Infinity;

  doc.descendants((node, pos) => {
    if (matches.length >= limit) {
      return false;
    }
    if (!node.isText || node.text === undefined) {
      return undefined;
    }
    pattern.lastIndex = 0;
    const text = node.text;
    let hit = pattern.exec(text);
    while (hit !== null) {
      const length = hit[0].length;
      if (length === 0) {
        pattern.lastIndex += 1;
        hit = pattern.exec(text);
        continue;
      }
      const from = pos + hit.index;
      const to = from + length;
      const inRange =
        range === undefined || (from >= range.from && to <= range.to);
      const wholeWordOk =
        resolved.wholeWord !== true || isWholeWordHit(text, hit.index, length);
      if (inRange && wholeWordOk) {
        matches.push({ from, to });
        if (matches.length >= limit) {
          return false;
        }
      }
      hit = pattern.exec(text);
    }
    return undefined;
  });
  return matches;
}

/**
 * 从给定文档位置开始找下一处 / 上一处匹配（查找框「下一个」用）
 *
 * - forward：取起点在 `from` 之后的第一个匹配（同起点视为已过，跳过）；
 * - backward：取终点在 `from` 之前的最后一个匹配。
 */
export function findNextMatch(
  doc: PmNode,
  query: string,
  from: number,
  options?: boolean | EditorSearchOptions,
  backward = false,
): TextMatch | undefined {
  const matches = findTextMatches(doc, query, options);
  if (backward) {
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i]!;
      if (match.to <= from) {
        return match;
      }
    }
    return undefined;
  }
  return matches.find((match) => match.from >= from);
}

/**
 * 选中文档中给定区间并滚动到视口（查找「定位下一个」复用）
 */
export function selectRange(match: TextMatch): Command {
  return (state, dispatch) => {
    if (match.from < 0 || match.to > state.doc.content.size || match.from === match.to) {
      return false;
    }
    const tr = state.tr.setSelection(
      TextSelection.create(state.doc, match.from, match.to),
    );
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * 将当前选区替换为文本（沿用选区起点处的标记；replacement 为空即删除选区）
 *
 * 选区为空时返回 false（无从替换）。
 */
export function replaceSelectionWith(replacement: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) {
      return false;
    }
    const tr = state.tr;
    if (replacement === '') {
      tr.delete(from, to);
    } else {
      const marks = state.doc.resolve(from).marks();
      tr.replaceWith(from, to, state.schema.text(replacement, marks));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * 全部替换：把文档中所有匹配替换为 replacement（空串即删除）
 *
 * - 自后向前替换，前面的坐标保持有效（无需映射）；
 * - 每处替换沿用该匹配起点处的标记；
 * - 选项支持正则 / 整词 / 范围限定（与 `findTextMatches` 同口径）；
 * - query 为空或无匹配时返回 false（不派发事务）。
 */
export function replaceAll(
  query: string,
  replacement: string,
  options?: boolean | EditorSearchOptions,
): Command {
  return (state: EditorState, dispatch) => {
    if (query === '') {
      return false;
    }
    const matches = findTextMatches(state.doc, query, options);
    if (matches.length === 0) {
      return false;
    }
    const tr = state.tr;
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i]!;
      if (replacement === '') {
        tr.delete(match.from, match.to);
      } else {
        const marks = state.doc.resolve(match.from).marks();
        tr.replaceWith(match.from, match.to, state.schema.text(replacement, marks));
      }
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * 逐条替换：只替换给定的一处匹配（「替换当前」用）
 *
 * 与 `replaceSelectionWith` 的区别是坐标显式给出，不依赖当前选区。
 */
export function replaceMatch(match: TextMatch, replacement: string): Command {
  return (state, dispatch) => {
    if (match.from < 0 || match.to > state.doc.content.size || match.from >= match.to) {
      return false;
    }
    const tr = state.tr;
    if (replacement === '') {
      tr.delete(match.from, match.to);
    } else {
      const marks = state.doc.resolve(match.from).marks();
      tr.replaceWith(match.from, match.to, state.schema.text(replacement, marks));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
