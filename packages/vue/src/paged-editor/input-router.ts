/**
 * 分页输入路由（阶段三方案 S + 阶段四：自定义 contenteditable 片段 ⇄ 模型输入编排）
 *
 * 3A 编辑面策略固化（方案 S）：方案 R 要求把「绑定整文档 EditorState 的
 * prosemirror-view」放进单页单片段格内 —— PM 视图必然渲染整棵树，页格窗口化
 * 即回到旧「叠层 + margin 造假缝」的漂移老路，无法根治。故编辑面为：
 * 每页片段独立 contenteditable，输入事件（beforeinput / composition / paste /
 * keydown）经 selection-bridge 映射为 BookEditor 事务；caret / 历史 / 命令的
 * 真相在模型，重排后按模型选区还原本位（restoreCaret）。
 *
 * 本模块提供可脱框架单测的纯辅助：
 * - 片段 DOM ⇄ 字符偏移互定位（charOffsetInFrag / domPosInFrag）；
 * - IME 组合差分（diffTextReplace：组合首尾快照求公共前后缀 → 单次替换落模）；
 * - 模型块内字符 → 页/片段归属（resolveCaretTarget：caret 还原与跨页导航共用）。
 */
import { isRubyAnnotationElement } from '../ruby-annotation.js';
import { charOfLine, type PagedBlockLoc, type PagedIndex } from './selection-bridge.js';
import type { PagedFragment, PagedPage } from './use-paged-layout.js';

/** 片段内文本选区（字符偏移，相对片段首行行首） */
export interface FragSel {
  blockId: string;
  fromLine: number;
  start: number;
  end: number;
}

/** caret 还原目标：某页某片段内字符偏移 */
export interface CaretTarget {
  pageIndex: number;
  blockId: string;
  fromLine: number;
  localChar: number;
}

/** 片段的块内起始字符（整块为 0；续排为该行行首偏移） */
export function fragStartChar(
  frag: PagedFragment,
  loc: PagedBlockLoc | undefined,
  charsPerLine: number,
): number {
  if (frag.lineCount === 0 && frag.fromLine === 0) return 0;
  return charOfLine(frag.fromLine, loc?.lineOffsets, charsPerLine);
}

/** 列出某块在全部分页中的片段序列（按页序），附各片段块内起始字符 */
export function blockFragments(
  pages: readonly PagedPage[],
  blockId: string,
  loc: PagedBlockLoc | undefined,
  charsPerLine: number,
): { pageIndex: number; frag: PagedFragment; startChar: number }[] {
  const out: { pageIndex: number; frag: PagedFragment; startChar: number }[] = [];
  for (const page of pages) {
    for (const frag of page.fragments) {
      if (frag.blockId !== blockId) continue;
      out.push({ pageIndex: page.index, frag, startChar: fragStartChar(frag, loc, charsPerLine) });
    }
  }
  return out;
}

/**
 * 块内字符 → 所在页片段与片段内偏移（取 startChar 不超过 blockChar 的最后一个片段）。
 *
 * @returns 命中返回 CaretTarget；该块未出现在分页中返回 null。
 */
export function resolveCaretTarget(
  pages: readonly PagedPage[],
  index: PagedIndex,
  charsPerLine: number,
  blockId: string,
  blockChar: number,
): CaretTarget | null {
  const loc = index.byId.get(blockId);
  if (loc === undefined) return null;
  const list = blockFragments(pages, blockId, loc, charsPerLine);
  let best: { pageIndex: number; frag: PagedFragment; startChar: number } | undefined;
  for (const entry of list) {
    if (entry.startChar <= blockChar) best = entry;
    else break;
  }
  if (best === undefined) best = list[0];
  if (best === undefined) return null;
  return {
    pageIndex: best.pageIndex,
    blockId,
    fromLine: best.frag.fromLine,
    localChar: Math.max(0, blockChar - best.startChar),
  };
}

/**
 * 收集片段子树文本节点（手工文档序递归，不依赖 TreeWalker 实现差异）。
 *
 * 跳过 ruby 注文子树（`<rt>` / `<rp>`，见 `ruby-annotation`）：注文由
 * html-serializer 从 mark 的 attrs.text 渲染而来，**不是模型文本**（模型轴口径
 * 见 `node-slice` 的 `nodeTextLength`）。若计入，DOM 字符轴会比模型轴多出注文
 * 长度，使 `charOffsetInFrag` / `domPosInFrag` / `fragPlainText` 全部错位——
 * 典型症状是同段落中选中内容之前有注音时，mark 落点与 IME 插入位置整体右移。
 */
export function fragTextNodes(
  fragEl: HTMLElement,
): { node: Text; start: number; len: number }[] {
  const list: { node: Text; start: number; len: number }[] = [];
  let offset = 0;
  const walk = (el: Node): void => {
    if (el.nodeType === 3) {
      const data = (el as Text).data ?? '';
      if (data.length > 0) list.push({ node: el as Text, start: offset, len: data.length });
      offset += data.length;
      return;
    }
    // 元素：注文子树整体跳过（不递归），保证 DOM 文本轴与模型文本轴同口径
    if (el.nodeType === 1 && isRubyAnnotationElement(el as Element)) {
      return;
    }
    const children = el.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      const child = children.item(i);
      if (child !== null) walk(child);
    }
  };
  walk(fragEl);
  return list;
}

/** 片段纯文本（与 collectNodeText / 切片口径一致：拼接文本节点，不含 ruby 注文） */
export function fragPlainText(fragEl: HTMLElement): string {
  return fragTextNodes(fragEl)
    .map((e) => e.node.data)
    .join('');
}

/**
 * DOM 选区点（container, offset）→ 片段内字符偏移（文档序累计，片段外返回 null）。
 *
 * 点在片段子树内：文本节点直接按节点内序号折算；元素容器按「第 offset 个子节点之前」
 * 的文本量累计（caret 落在子节点边界时，其内部文本均计入）。
 */
export function charOffsetInFrag(
  fragEl: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  if (!fragEl.contains(container)) return null;
  const list = fragTextNodes(fragEl);
  if (container.nodeType === 3) {
    const hit = list.find((e) => e.node === container);
    if (hit !== undefined) return hit.start + Math.min(offset, hit.len);
    // 零长文本节点不在列表：按「先于该节点的全部文本」折算
  } else {
    const childAt = container.childNodes.item(offset);
    let acc = 0;
    for (const e of list) {
      if (container.contains(e.node)) {
        // 后代文本：仅当已越过定点（childAt 为空 = 容器末尾）才计入；含 childAt 自身子树
        if (childAt === null) acc = e.start + e.len;
        continue;
      }
      if (container.compareDocumentPosition(e.node) & Node.DOCUMENT_POSITION_PRECEDING) {
        acc = e.start + e.len;
      }
    }
    return acc;
  }
  let acc = 0;
  for (const e of list) {
    if (container.compareDocumentPosition(e.node) & Node.DOCUMENT_POSITION_PRECEDING) {
      acc = e.start + e.len;
    }
  }
  return acc;
}

/**
 * 片段内字符偏移 → DOM 选区点（caret 还原用）。
 *
 * @returns 命中文本节点返回点；越界钳到首/末文本节点；空片段回退元素内 0 位。
 */
export function domPosInFrag(
  fragEl: HTMLElement,
  charIndex: number,
): { container: Node; offset: number } | null {
  const list = fragTextNodes(fragEl);
  if (list.length === 0) return { container: fragEl, offset: 0 };
  const g = Math.max(0, charIndex);
  for (const e of list) {
    if (g >= e.start && g <= e.start + e.len) {
      return { container: e.node, offset: g - e.start };
    }
  }
  const last = list[list.length - 1] as { node: Text; start: number; len: number };
  return { container: last.node, offset: last.len };
}

/**
 * 公共前后缀差分：oldText → newText 的最小替换窗口。
 *
 * IME 组合期间不落事务，compositionend 以快照差分一次性提交（阶段四 IME 口径）。
 */
export function diffTextReplace(
  oldText: string,
  newText: string,
): { from: number; to: number; text: string } {
  const maxPrefix = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < maxPrefix && oldText.charAt(p) === newText.charAt(p)) p += 1;
  const maxSuffix = Math.min(oldText.length - p, newText.length - p);
  let s = 0;
  while (s < maxSuffix && oldText.charAt(oldText.length - 1 - s) === newText.charAt(newText.length - 1 - s)) {
    s += 1;
  }
  return {
    from: p,
    to: oldText.length - s,
    text: newText.slice(p, newText.length - s),
  };
}

/** 读取 window 选区在指定片段内的起止（两点必须都在该片段内） */
export function fragSelection(fragEl: HTMLElement): FragSel | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (sel === null || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!fragEl.contains(range.startContainer) || !fragEl.contains(range.endContainer)) {
    return null;
  }
  const start = charOffsetInFrag(fragEl, range.startContainer, range.startOffset);
  const end = charOffsetInFrag(fragEl, range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  const blockId = fragEl.dataset.blockId ?? '';
  const fromLine = Number(fragEl.dataset.fromLine ?? '0');
  return { blockId, fromLine: Number.isFinite(fromLine) ? fromLine : 0, start, end };
}
