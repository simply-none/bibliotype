/**
 * 页底注区（footnote area）HTML 序列化
 *
 * 与 {@link serializePageGutter} 同一范式：只输出语义正确的窄带结构，视觉全部由
 * `book-css` 的 `.bt-page-notes` 规则负责。数据来自分页器产出的 `PaginatedPage.notes`
 * （经 `Reader.getPageNotes` 还原为 IR 节点），本函数不接触分页算法与 DOM。
 *
 * 空注区（未开启页底浮注或本页无注）返回空串，调用方无需额外判空即可拼入。
 */
import type { BookNode } from '@bibliotype/core';
import { escapeHtml, serializeNode, type SerializeNodeOptions } from './html-serializer.js';

/** 页底注区序列化选项 */
export interface SerializePageNotesOptions {
  /**
   * 本页注区承接上一页溢出的注释（output「续前页」标记）
   *
   * 由分页器的跨页续注（`notesCarried`）透传，渲染侧据以提示读者上页注文未完。
   */
  continued?: boolean;
  /**
   * 注区高度超出上限（仅标记，不裁剪）
   *
   * 分页器对超长单条注「仍独占一页」，渲染侧据此在容器上打 `data-overflow="true"`
   * 便于宿主告警，但**不截断**注文（截断/拆条属分页职责，不在渲染层重复实现）。
   */
  overflow?: boolean;
  /** 透传给单条注节点的序列化选项（如 `epubSemantics` / `tagOverrides` / `anchorIds`） */
  nodeOptions?: SerializeNodeOptions;
}

/**
 * 序列化页底注区
 *
 * @param notes 本页页底注节点（已还原为 IR 节点，顺序即呈现顺序）
 * @param options 续注 / 超限 / 节点序列化选项
 * @returns 注区 HTML；无注时返回空串
 */
export function serializePageNotes(
  notes: readonly BookNode[],
  options: SerializePageNotesOptions = {},
): string {
  if (notes.length === 0) return '';

  const parts: string[] = [];
  if (options.continued === true) {
    parts.push('<div class="bt-note-continued bt-note-continued--prev">续前页</div>');
  }

  for (const note of notes) {
    const idAttr = note.id !== undefined && note.id !== '' ? ` data-note-id="${escapeHtml(note.id)}"` : '';
    parts.push(`<div class="bt-page-note"${idAttr}>${serializeNode(note, options.nodeOptions ?? {})}</div>`);
  }

  const classes = options.overflow === true ? 'bt-page-notes bt-page-notes--overflow' : 'bt-page-notes';
  const overflowAttr = options.overflow === true ? ' data-overflow="true"' : '';
  return `<div class="${classes}"${overflowAttr}>${parts.join('')}</div>`;
}
