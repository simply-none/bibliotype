/**
 * 注释节点（脚注 / 尾注 / 边注）公共契约
 *
 * 三种注释在 IR 中都是**块级容器**（`kind: 'block'`，`children` 为块内容），
 * 差异只在语义与呈现位置：
 * - `footnote`：页底注，随文就近；
 * - `endnote`：书末 / 篇末注，集中排布；
 * - `margin-note`：边注，排在版心外侧。
 *
 * 本模块把「哪些类型算注释、注码怎么编号、导出用什么语义」收敛为一处，
 * 供统计（`document-stats`）、编辑器命令（`@bibliotype/editor`）与
 * 导出（`@bibliotype/layout/html`、`@bibliotype/exporter-epub`）共用，
 * 避免各处各自维护一份类型表。
 */
import { NODE_TYPES } from './node-types.js';
import { isTextNode } from './nodes.js';
import type { BookNode } from './nodes.js';

/**
 * 注释角色（EPUB 3 结构语义词汇）
 *
 * 边注在 EPUB 词汇里没有独立词条，映射为 `sidebar`：视觉上是版心外的旁注，
 * 语义上就是「旁栏内容」，比强行套 `footnote` 更贴近读者预期，
 * 也不会让 epubcheck 报未知词汇。
 */
export const NOTE_ROLES = {
  FOOTNOTE: 'footnote',
  ENDNOTE: 'endnote',
  MARGIN_NOTE: 'sidebar',
} as const;

/** 注释角色联合 */
export type NoteRole = (typeof NOTE_ROLES)[keyof typeof NOTE_ROLES];

/** 注释节点类型（顺序即文档内编号扫描顺序） */
export const NOTE_NODE_TYPES = [
  NODE_TYPES.FOOTNOTE,
  NODE_TYPES.ENDNOTE,
  NODE_TYPES.MARGIN_NOTE,
] as const;

/** 注释节点类型 → 角色 */
const NOTE_ROLE_BY_TYPE: Readonly<Record<string, NoteRole>> = {
  [NODE_TYPES.FOOTNOTE]: NOTE_ROLES.FOOTNOTE,
  [NODE_TYPES.ENDNOTE]: NOTE_ROLES.ENDNOTE,
  [NODE_TYPES.MARGIN_NOTE]: NOTE_ROLES.MARGIN_NOTE,
};

/** 类型名是否为注释节点（传入文本节点类型 `text` 返回 false） */
export function isNoteNodeType(type: string): boolean {
  return NOTE_ROLE_BY_TYPE[type] !== undefined;
}

/** 节点是否为注释（文本叶子恒为 false） */
export function isNoteNode(node: BookNode): boolean {
  return !isTextNode(node) && isNoteNodeType(node.type);
}

/** 注释节点类型 → EPUB 角色；非注释类型返回 undefined */
export function noteRoleOf(type: string): NoteRole | undefined {
  return NOTE_ROLE_BY_TYPE[type];
}

/** 注码样式 */
export const NOTE_LABEL_STYLES = {
  /** 1 / 2 / 3（现代书默认） */
  ARABIC: 'arabic',
  /** ① / ② / ③（超出 20 回退为 (21)） */
  CIRCLED: 'circled',
  /** 一 / 二 / 三（古籍与竖排习惯） */
  CHINESE: 'chinese',
} as const;

/** 注码样式联合 */
export type NoteLabelStyle = (typeof NOTE_LABEL_STYLES)[keyof typeof NOTE_LABEL_STYLES];

/** 圈码 ①~⑳（U+2460 起连续码位；更多序号以下标形式回退） */
const CIRCLED_LABELS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** 中文数字字符（1~99 够用；百位以上回退为阿拉伯数字） */
const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 两位以内整数 → 中文数字（10 → 十，21 → 二十一） */
function chineseNumber(value: number): string {
  if (value < 10) return CHINESE_DIGITS[value] ?? '';
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  const tensPart = tens === 1 ? '十' : `${CHINESE_DIGITS[tens] ?? ''}十`;
  return ones === 0 ? tensPart : `${tensPart}${CHINESE_DIGITS[ones] ?? ''}`;
}

/**
 * 生成注码文本
 *
 * `index` 为该类注释内的 1 起序号；非法值（< 1 / 非整数）按 1 处理。
 */
export function formatNoteLabel(
  index: number,
  style: NoteLabelStyle = NOTE_LABEL_STYLES.ARABIC,
): string {
  const safe = Number.isFinite(index) ? Math.max(1, Math.round(index)) : 1;
  switch (style) {
    case NOTE_LABEL_STYLES.CIRCLED:
      return safe <= CIRCLED_LABELS.length
        ? (CIRCLED_LABELS[safe - 1] ?? String(safe))
        : `(${safe})`;
    case NOTE_LABEL_STYLES.CHINESE:
      return safe < 100 ? chineseNumber(safe) : String(safe);
    default:
      return String(safe);
  }
}

/** 注释条目（编号扫描结果） */
export interface NoteEntry {
  /** IR 节点引用（不拷贝） */
  node: BookNode;
  /** 节点类型（footnote / endnote / margin-note） */
  type: string;
  /** EPUB 语义角色 */
  role: NoteRole;
  /** 同类注释内的 1 起序号 */
  index: number;
  /** 导出锚点 id：优先节点自带 id，缺省 `note-{type}-{index}` */
  id: string;
  /** 显示注码（按样式格式化后的 `index`；节点自带 `attrs.marker` 时优先） */
  label: string;
}

/** 注释扫描选项 */
export interface CollectNotesOptions {
  /** 注码样式（缺省阿拉伯数字） */
  labelStyle?: NoteLabelStyle;
}

/** 节点显式注码（`attrs.marker`） */
function explicitMarker(node: BookNode): string | undefined {
  const raw = node.attrs?.['marker'];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/**
 * 按先序收集全书注释并编号
 *
 * 编号按**类型分别计数**（脚注 1、2、3…与尾注 1、2、3…互不干扰），
 * 与出版习惯一致；节点自带 `attrs.marker` 时保留作者手写注码，
 * 序号仍照常递增（避免后续注释错位）。
 */
export function collectNotes(
  root: BookNode,
  options: CollectNotesOptions = {},
): NoteEntry[] {
  const style = options.labelStyle ?? NOTE_LABEL_STYLES.ARABIC;
  const counters = new Map<string, number>();
  const entries: NoteEntry[] = [];

  const walk = (node: BookNode): void => {
    if (isTextNode(node)) return;
    const role = noteRoleOf(node.type);
    if (role !== undefined) {
      const index = (counters.get(node.type) ?? 0) + 1;
      counters.set(node.type, index);
      entries.push({
        node,
        type: node.type,
        role,
        index,
        id: node.id ?? `note-${node.type}-${index}`,
        label: explicitMarker(node) ?? formatNoteLabel(index, style),
      });
      // 注释自身内容不再下钻：注释里嵌套注释没有排版意义，也避免计数器错乱
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(root);
  return entries;
}

/**
 * 下一个可用注码序号（同类注释的当前数量 + 1）
 *
 * 编辑器插入命令用它给新注释自动编号，保证「插几条就是几条」，
 * 不依赖光标位置，也不受中间已删除注释影响（只数现存）。
 */
export function nextNoteIndex(root: BookNode, type: string): number {
  if (!isNoteNodeType(type)) return 1;
  let count = 0;
  const walk = (node: BookNode): void => {
    if (isTextNode(node)) return;
    if (node.type === type) {
      count += 1;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return count + 1;
}
