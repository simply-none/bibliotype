/**
 * 古籍专有标记类型常量（行内，附着于文本区间）
 *
 * 对应调研清单 § 四：
 * - 专名号（直排为 ︱，横排为下划线式）
 * - 书名号（波浪线 ﹏）
 * - 圈点（传统句读强调）
 * - 注文引用锚点（指向注文节点的行内标记）
 */
export const CLASSICAL_MARK_TYPES = {
  /** 专名号（人名/地名/朝代名等专有名词） */
  PROPER_NAME: 'proper-name',
  /** 书名号（波浪线标注书名） */
  BOOK_TITLE: 'book-title',
  /** 圈点（传统读书标记，attrs.style 区分圈/点） */
  CIRCLE_EMPHASIS: 'circle-emphasis',
  /** 注文引用锚点（attrs.noteId 指向注文节点） */
  NOTE_REF: 'note-ref',
  /** 异文标记（行内轻量标记，与 VARIANT_CHAR 节点互补） */
  VARIANT: 'variant',
  /** 避讳标记（行内轻量标记） */
  TABOO: 'taboo',
} as const;

/** 古籍标记类型联合（由常量推导） */
export type ClassicalMarkType =
  (typeof CLASSICAL_MARK_TYPES)[keyof typeof CLASSICAL_MARK_TYPES];
