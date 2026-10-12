/**
 * 古籍专有节点类型常量
 *
 * 命名空间归属 classical（对应 D8：古籍节点定义统放在本包）。
 * 命名约定：全部小写、kebab-case，语义优先；
 * 与 core 的 NODE_TYPES 无重名（重复注册由注册表兜底报错）。
 */
export const CLASSICAL_NODE_TYPES = {
  /* ---------- 注疏体例 ---------- */

  /** 双行小注（正文一行夹两行小字，如《十三经注疏》） */
  DOUBLE_NOTE: 'double-note',
  /** 夹注（行内注文，随正文流） */
  INLINE_NOTE: 'inline-note',
  /** 眉批（版心上方批语） */
  HEAD_NOTE: 'head-note',
  /** 尾批（段末/篇末批语） */
  TAIL_NOTE: 'tail-note',

  /* ---------- 校勘与字形 ---------- */

  /** 校勘记（底本/校本异文记录） */
  COLLATION_NOTE: 'collation-note',
  /** 校勘符号（○□△等标记，attrs.symbol 携取值） */
  COLLATION_MARK: 'collation-mark',
  /** 异体字（保留原字形的行内载体，attrs.standard 携带规范字形） */
  VARIANT_CHAR: 'variant-char',
  /** 避讳字（缺笔字行内载体，attrs.taboo 携带避讳缘由） */
  TABOO_CHAR: 'taboo-char',

  /* ---------- 版式元素 ---------- */

  /** 牌记 / 刊记 */
  IMPRINT: 'imprint',
  /** 卷末题记 / 跋语 */
  COLOPHON: 'colophon',
  /** 印章（attrs.kind 区分起首章/压角章等） */
  SEAL: 'seal',
  /** 版框装饰（乌丝栏/朱丝栏，attrs.style 携取值） */
  BORDER_FRAME: 'border-frame',
  /** 鱼尾（版心装饰，attrs.style 区分单/双鱼尾） */
  FISH_TAIL: 'fish-tail',
} as const;

/** 古籍节点类型联合（由常量推导） */
export type ClassicalNodeType =
  (typeof CLASSICAL_NODE_TYPES)[keyof typeof CLASSICAL_NODE_TYPES];
