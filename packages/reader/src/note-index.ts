/**
 * 注释页索引（纯函数）
 *
 * 页底注（`PaginatedPage.notes`）与正文同源分页，但注释序列在渲染层只以
 * HTML 字符串出现；阅读器的「点击注码跳注文」「上一条 / 下一条注释」需要
 * 「注释 id → 页号」与文档顺序的注释序列。
 *
 * 同一注释可能因注区满而跨页续排（同一 `block.id` 出现在多页 `notes` 中），
 * 索引只保留**首次出现**的页作为跳转目标，避免跳到「续前页」片段。
 */
import type { PageItem } from '@bibliotype/layout';

/** 注释页定位条目 */
export interface NotePageAnchor {
  /** 注释节点 id（与 `.bt-page-note` 的 `data-note-id` 一致） */
  noteId: string;
  /** 首次出现所在页（自 0 起） */
  pageIndex: number;
}

/** 建立索引所需的最小分页信息（只读 `notes`，不耦合 `PaginatedPage` 其余字段） */
export interface NoteIndexPage {
  notes?: readonly PageItem[];
}

/**
 * 构建注释定位表
 *
 * 顺序即文档顺序（按页、页内注区顺序），供上一条 / 下一条在全书范围循环。
 *
 * @param pages 分页结果（越界页自然被忽略）
 */
export function buildNoteAnchors(pages: readonly NoteIndexPage[]): NotePageAnchor[] {
  const anchors: NotePageAnchor[] = [];
  const seen = new Set<string>();
  for (const [pageIndex, page] of pages.entries()) {
    for (const item of page.notes ?? []) {
      const noteId = item.block.id;
      if (noteId === undefined || noteId === '' || seen.has(noteId)) continue;
      seen.add(noteId);
      anchors.push({ noteId, pageIndex });
    }
  }
  return anchors;
}

/** 按注释 id 取定位条目（未收录时为 `undefined`） */
export function findNoteAnchor(
  anchors: readonly NotePageAnchor[],
  noteId: string,
): NotePageAnchor | undefined {
  for (const anchor of anchors) {
    if (anchor.noteId === noteId) return anchor;
  }
  return undefined;
}

/**
 * 取相邻注释（循环）
 *
 * - `direction = 1`：下一条；到末尾回绕到首条
 * - `direction = -1`：上一条；到开头回绕到末条
 *
 * @param currentId 当前注释 id；为空或不在索引中时返回首条 / 末条
 * @returns 无注释时为 `undefined`
 */
export function neighborNoteAnchor(
  anchors: readonly NotePageAnchor[],
  currentId: string | undefined,
  direction: 1 | -1,
): NotePageAnchor | undefined {
  if (anchors.length === 0) return undefined;
  const index = currentId === undefined ? -1 : anchors.findIndex((anchor) => anchor.noteId === currentId);
  if (index < 0) return direction === 1 ? anchors[0] : anchors[anchors.length - 1];
  const next = (index + direction + anchors.length) % anchors.length;
  return anchors[next];
}
