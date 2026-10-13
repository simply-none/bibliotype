/**
 * 编辑态文本查找与替换（无 DOM，纯 EditorState 层）
 *
 * 与 Reader.search（阅读态、逐块摘录）不同：这里产出的是 ProseMirror 文档坐标
 * 上的匹配区间，供编辑画布内选中、逐处替换与全部替换复用。
 * 采用字面（非正则）匹配，逐 text 节点扫描，命中不跨节点边界。
 */
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Node as PmNode } from 'prosemirror-model';

/** 一处文本匹配（文档坐标区间，from 含、to 不含） */
export interface TextMatch {
  from: number;
  to: number;
}

/**
 * 在文档中查找 query 的所有字面匹配区间
 *
 * - 逐 text 节点扫描（匹配不跨越节点 / 标记边界）；
 * - caseSensitive 缺省 false（大小写不敏感）；query 为空返回空数组。
 */
export function findTextMatches(
  doc: PmNode,
  query: string,
  caseSensitive = false,
): TextMatch[] {
  const matches: TextMatch[] = [];
  if (query === '') {
    return matches;
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || node.text === undefined) {
      return;
    }
    const text = caseSensitive ? node.text : node.text.toLowerCase();
    let index = text.indexOf(needle);
    while (index !== -1) {
      const from = pos + index;
      matches.push({ from, to: from + query.length });
      index = text.indexOf(needle, index + needle.length);
    }
  });
  return matches;
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
 * 全部替换：把文档中所有 query 的字面匹配替换为 replacement（空串即删除）
 *
 * - 自后向前替换，前面的坐标保持有效（无需映射）；
 * - 每处替换沿用该匹配起点处的标记；
 * - query 为空或无匹配时返回 false（不派发事务）。
 */
export function replaceAll(
  query: string,
  replacement: string,
  caseSensitive = false,
): Command {
  return (state: EditorState, dispatch) => {
    if (query === '') {
      return false;
    }
    const matches = findTextMatches(state.doc, query, caseSensitive);
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
