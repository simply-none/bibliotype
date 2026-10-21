/**
 * 语义节点类型常量（Modern Book 部分）
 *
 * 命名约定：全部小写、kebab-case，作为 IR 节点的 `type` 值。
 * 古籍专有节点（双行小注、校勘等）由 @bibliotype/classical 扩展注册，不在此定义。
 */
export const NODE_TYPES = {
  /** 书籍根节点（唯一根） */
  BOOK: 'book',

  /* ---------- 结构节点 ---------- */

  /** 封面（电子封面） */
  COVER: 'cover',
  /** 书名页 / 扉页 */
  TITLE_PAGE: 'title-page',
  /** 版权页（版权记录） */
  COPYRIGHT_PAGE: 'copyright-page',
  /** 封底 */
  BACK_COVER: 'back-cover',
  /** 卷 */
  VOLUME: 'volume',
  /** 章 */
  CHAPTER: 'chapter',
  /** 节 */
  SECTION: 'section',
  /** 附录 */
  APPENDIX: 'appendix',
  /** 前言 / 序 */
  PREFACE: 'preface',
  /** 后记 / 跋 */
  POSTSCRIPT: 'postscript',
  /** 目录 */
  TOC: 'toc',

  /* ---------- 块级内容节点 ---------- */

  /** 正文段落 */
  PARAGRAPH: 'paragraph',
  /** 标题（级别由 attrs.level 描述，1~6） */
  HEADING: 'heading',
  /** 引文块 */
  QUOTE: 'quote',
  /** 列表 */
  LIST: 'list',
  /** 列表项 */
  LIST_ITEM: 'list-item',
  /** 图片 */
  IMAGE: 'image',
  /** 图注 / 图版说明 */
  CAPTION: 'caption',
  /** 表格 */
  TABLE: 'table',
  /** 表格行 */
  TABLE_ROW: 'table-row',
  /** 表格单元格 */
  TABLE_CELL: 'table-cell',
  /** 代码块 */
  CODE_BLOCK: 'code-block',
  /** 公式块（MathML / KaTeX 源码存于 attrs） */
  MATH_BLOCK: 'math-block',
  /** 分隔线 / 分节符 */
  BREAK: 'break',
  /** 页眉（book 级至多一个，覆盖派生页眉） */
  PAGE_HEADER: 'page-header',
  /** 页脚（book 级至多一个，覆盖派生页脚） */
  PAGE_FOOTER: 'page-footer',
  /** 条件内容容器（attrs.when 求值为真时才输出） */
  CONDITION: 'condition',

  /* ---------- 注释节点 ---------- */

  /** 脚注 */
  FOOTNOTE: 'footnote',
  /** 尾注 */
  ENDNOTE: 'endnote',
  /** 边注 */
  MARGIN_NOTE: 'margin-note',

  /* ---------- 行内节点 ---------- */

  /** 行内文本载体 */
  TEXT: 'text',
  /** 行内公式 */
  MATH_INLINE: 'math-inline',
} as const;

/** 节点类型联合（由 NODE_TYPES 推导） */
export type CoreNodeType = (typeof NODE_TYPES)[keyof typeof NODE_TYPES];

/**
 * 语义标记类型常量（行内）
 *
 * 与节点不同：标记不构成树结构，仅附加于文本区间之上。
 */
export const MARK_TYPES = {
  /** 强调（斜体） */
  EMPHASIS: 'emphasis',
  /** 着重（粗体） */
  STRONG: 'strong',
  /** 下划线 */
  UNDERLINE: 'underline',
  /** 删除线 */
  STRIKETHROUGH: 'strikethrough',
  /** 行内代码 */
  CODE: 'code',
  /** 超链接 */
  LINK: 'link',
  /** 注音（ruby，attrs 携带注文） */
  RUBY: 'ruby',
  /** 高亮 */
  HIGHLIGHT: 'highlight',
  /**
   * 注引用（正文上标 → 注释块）
   *
   * 作为**标记**而非节点：注引用只承载「指向哪个注释」这一层关系，
   * 不构成结构，天然随文字移动 / 删除，也避免行内原子节点在分页与文本抽取里
   * 另开特例。attrs：`targetId`（注释块 id）、`refId`（本条引用的锚点 id，
   * 供注文末的回跳链接使用）。
   */
  NOTE_REF: 'noteref',
  /**
   * 索引词（书末索引条目的采集来源）
   *
   * 作为**标记**而非节点：索引是对既有文字的语义覆盖，加节点会破坏选区、
   * 既有编辑命令与无损往返。attrs：`term`（索引词，缺省取选中文本）、
   * `sortKey`（可选排序键，如手填拼音 / 笔画序）。
   */
  INDEX_TERM: 'index-term',
  /**
   * 修订：插入（C5）
   *
   * 与 `deletion` / `format-change` 同属「修订标记」，只在修订模式开启时写入；
   * attrs：`changeId`（同一笔修订的标识）、`author`、`timestamp`、
   * `previous`（`format-change` 专用的变更前标记快照 JSON）。
   */
  INSERTION: 'insertion',
  /** 修订：删除（内容保留在 IR 中，终稿视图投影时才隐去） */
  DELETION: 'deletion',
  /** 修订：格式变更（保留变更前标记快照，拒绝时还原） */
  FORMAT_CHANGE: 'format-change',
} as const;

/** 标记类型联合（由 MARK_TYPES 推导） */
export type CoreMarkType = (typeof MARK_TYPES)[keyof typeof MARK_TYPES];
