/**
 * 校勘汇总表（K2）
 *
 * 把散在正文后的 `collation-note` 收成书末「校勘记」附录：按编号排序、
 * 摘要截断、每条带回到注文的锚点。输出与 K4 索引附录同构（`appendix` 节点 +
 * `heading` + 条目段落 + `link` 标记），EPUB / 站点 / PDF 复用同一 IR。
 */
import {
  MARK_TYPES,
  NODE_TYPES,
  isTextNode,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import { CLASSICAL_NODE_TYPES } from './node-types.js';

/** 汇总表单条 */
export interface CollationSummaryEntry {
  /** 校勘记编号（缺省 null：未编号的旧数据） */
  marker: number | null;
  /** 配对 id（未配对为 null） */
  pairId: string | null;
  /** 注文摘要（截断到 `maxLength`） */
  text: string;
  /** 注文块 id（回跳锚点；无 id 时为空串） */
  anchorId: string;
}

/** 汇总表生成选项 */
export interface CollationSummaryOptions {
  /** 章节标题（缺省「校勘记」） */
  title?: string;
  /** 附录节点 id（缺省 `collation-summary`） */
  id?: string;
  /** 单条摘要最大字数（缺省 60） */
  maxLength?: number;
  /** 块 id → 链接地址（EPUB 传 `text/sec-N.xhtml#id`；缺省 `#id`） */
  hrefFor?: (blockId: string) => string;
}

/** 块级纯文本 */
function plainText(node: BookNode): string {
  if (isTextNode(node)) return node.text ?? '';
  return (node.children ?? []).map(plainText).join('');
}

/**
 * 采集校勘记条目（按编号升序；未编号条目排在最后，保持文档序）
 */
export function collectCollationEntries(
  document: BookDocument | BookNode,
  maxLength = 60,
): CollationSummaryEntry[] {
  const root = 'root' in document ? document.root : document;
  const entries: Array<CollationSummaryEntry & { order: number }> = [];

  const walk = (node: BookNode): void => {
    if (node.type === CLASSICAL_NODE_TYPES.COLLATION_NOTE) {
      const rawMarker = node.attrs?.['marker'];
      const marker =
        typeof rawMarker === 'number' && Number.isFinite(rawMarker)
          ? Math.round(rawMarker)
          : typeof rawMarker === 'string' && /^\d+$/.test(rawMarker)
            ? Number(rawMarker)
            : null;
      const rawPair = node.attrs?.['pairId'];
      const text = plainText(node).replace(/\s+/g, ' ').trim();
      entries.push({
        marker,
        pairId: typeof rawPair === 'string' && rawPair !== '' ? rawPair : null,
        text: text.length > maxLength ? `${text.slice(0, maxLength)}…` : text,
        anchorId: typeof node.id === 'string' ? node.id : '',
        order: entries.length,
      });
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(root);

  return entries
    .sort((left, right) => {
      if (left.marker === null && right.marker === null) return left.order - right.order;
      if (left.marker === null) return 1;
      if (right.marker === null) return -1;
      return left.marker - right.marker || left.order - right.order;
    })
    .map(({ order: _order, ...rest }) => rest);
}

/**
 * 生成「校勘记」附录（与索引附录同构，导出器零分叉）
 */
export function buildCollationSummary(
  document: BookDocument | BookNode,
  options: CollationSummaryOptions = {},
): BookNode {
  const title = options.title ?? '校勘记';
  const hrefFor = options.hrefFor ?? ((blockId: string) => `#${blockId}`);
  const entries = collectCollationEntries(document, options.maxLength);

  const children: BookNode[] = [
    {
      type: NODE_TYPES.HEADING,
      attrs: { level: 1 },
      children: [{ type: NODE_TYPES.TEXT, text: title }],
    },
  ];

  for (const entry of entries) {
    const label = entry.marker === null ? '—' : String(entry.marker);
    const inline: BookNode[] = [
      {
        type: NODE_TYPES.TEXT,
        text: `${label}　`,
        ...(entry.anchorId === ''
          ? {}
          : { marks: [{ type: MARK_TYPES.LINK, attrs: { href: hrefFor(entry.anchorId) } }] }),
      },
      { type: NODE_TYPES.TEXT, text: entry.text },
    ];
    children.push({ type: NODE_TYPES.PARAGRAPH, children: inline });
  }

  return {
    type: NODE_TYPES.APPENDIX,
    id: options.id ?? 'collation-summary',
    attrs: { title },
    children,
  };
}
