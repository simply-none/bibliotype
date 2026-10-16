/**
 * 片段编辑落模（阶段三：把某页某片段的文本改动应用为 BookEditor 事务）
 *
 * 输入以「(块, 片段起始行, 片段内字符区间 [fromLocal,toLocal), 待插入文本)」表达，
 * 经 selection-bridge 映射为 PM 文档坐标后，构造 replaceWith/delete/split 事务派发。
 * 为纯模型操作（不触 DOM），可脱浏览器单测；跨块 / IME / 粘贴等由阶段四在上层编排
 * （见 input-router.ts 与 PagedCanvas 事件接入）。
 */
import type { BookEditor } from '@bibliotype/editor';
import { TextSelection } from 'prosemirror-state';
import {
  resolveFragmentPoint,
  resolveFragmentRange,
  type PagedIndex,
} from './selection-bridge.js';

/**
 * 应用一次片段文本编辑。
 *
 * @returns 命中并派发为 true；映射未命中 / 越界为 false（调用方决定回退）。
 */
export function applyFragmentEdit(
  editor: BookEditor,
  index: PagedIndex,
  blockId: string,
  fromLine: number,
  fromLocal: number,
  toLocal: number,
  text: string,
  charsPerLine: number,
): boolean {
  const range = resolveFragmentRange(index, blockId, fromLine, fromLocal, toLocal, charsPerLine);
  if (range === null) return false;
  const { from, to } = range;
  const state = editor.editorState;
  if (from < 0 || to > state.doc.content.size || from > to) return false;

  const tr = state.tr;
  if (text.length > 0) {
    // 继承光标处的标记（与 PM 原生 insertText 一致）：优先 storedMarks（工具栏点选的待输入标记），
    // 否则取光标所在处的 marks。否则分页态下「先点标记再打字」会丢失标记（R5）。
    const marks = state.storedMarks ?? state.doc.resolve(from).marks();
    tr.replaceWith(from, to, state.schema.text(text, marks));
  } else {
    if (from === to) return false;
    tr.delete(from, to);
  }
  editor.dispatch(tr);
  return true;
}

/**
 * 在片段内某字符处拆分所属块（Enter）：PM split 事务 + 光标落入新块首部。
 *
 * @returns 命中并派发为 true；映射未命中 / 越界为 false。
 */
export function applyFragmentSplit(
  editor: BookEditor,
  index: PagedIndex,
  blockId: string,
  fromLine: number,
  localChar: number,
  charsPerLine: number,
): boolean {
  const pmPos = resolveFragmentPoint(
    index,
    blockId,
    fromLine,
    localChar,
    charsPerLine,
    editor.editorState.doc.content.size,
  );
  if (pmPos === null) return false;
  const state = editor.editorState;
  const $pos = state.doc.resolve(pmPos);
  if ($pos.depth === 0) return false;
  const tr = state.tr.split(pmPos);
  try {
    // 拆分点经 mapping 落在新块边界，near 向内取最近文本位置作光标
    const $pos = tr.doc.resolve(Math.min(tr.mapping.map(pmPos), tr.doc.content.size));
    tr.setSelection(TextSelection.near($pos));
  } catch {
    /* 拆分点贴边时保持默认映射光标 */
  }
  editor.dispatch(tr);
  return true;
}

/**
 * 把片段选区 [fromLocal,toLocal) 同步为模型光标 / 选区（selectionchange 落模）。
 *
 * @returns 命中并派发为 true；未命中 / 越界为 false（不回退旧选区）。
 */
export function applyFragmentSelection(
  editor: BookEditor,
  index: PagedIndex,
  blockId: string,
  fromLine: number,
  fromLocal: number,
  toLocal: number,
  charsPerLine: number,
): boolean {
  const range = resolveFragmentRange(index, blockId, fromLine, fromLocal, toLocal, charsPerLine);
  if (range === null) return false;
  const state = editor.editorState;
  const { from, to } = range;
  if (from < 0 || to > state.doc.content.size || from > to) return false;
  try {
    const tr = state.tr;
    tr.setSelection(TextSelection.create(tr.doc, from, to));
    editor.dispatch(tr);
  } catch {
    return false;
  }
  return true;
}
