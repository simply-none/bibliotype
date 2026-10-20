/**
 * 交叉引用数据结构
 *
 * 纸书的「参见第 128 页」必须等**分页完成**才知道页码，这是典型的「两遍排版」：
 * - 第一遍：分页，产出「节点 id → 页码」索引；
 * - 第二遍：渲染，把引用占位替换成真实页码。
 *
 * 本包只做索引与替换（纯函数），不依赖具体分页器：只要分页结果能给出每页出现过
 * 哪些块 id，就能建索引（`PageSource` 与 layout 的 `PaginatedPage` 结构兼容）。
 */
import type { NodeId } from '@bibliotype/core';

/** 分页结果中单页的最小投影（与 layout.PaginatedPage 结构兼容） */
export interface PageSource {
  /** 页码（自 0 起） */
  index: number;
  /** 页内片段（行级拆分结果，优先取用） */
  items?: readonly { readonly block: { readonly id: string } }[];
  /** 页内整块（向后兼容字段） */
  blocks?: readonly { readonly id: string }[];
}

/** 页码索引（可序列化） */
export interface PageIndex {
  /** 节点 id → 页码（1 起，按 startNumber 偏移后） */
  entries: Record<NodeId, number>;
  /** 总页数 */
  totalPages: number;
}

/** 建索引选项 */
export interface BuildPageIndexOptions {
  /** 首页页码（缺省 1；封面 / 前置页场景可传更大值或由调用方自行偏移） */
  startNumber?: number;
}

/** 交叉引用条目（label → 目标节点） */
export interface CrossReference {
  /** 引用标签（书中唯一，如 `fig-1` / `本草纲目`） */
  label: string;
  /** 目标节点 id */
  nodeId: NodeId;
  /** 引用类型（用于格式化与分组） */
  kind?: 'chapter' | 'section' | 'figure' | 'table' | 'note' | 'custom';
}

/** 占位符解析结果 */
export interface PageReferenceMatch {
  /** 完整占位符文本，如 `{{page:p1}}` */
  raw: string;
  /** 目标节点 id */
  nodeId: NodeId;
  /** 起始偏移 */
  start: number;
  /** 结束偏移（不含） */
  end: number;
}

/** 页码格式化选项 */
export interface PageReferenceOptions {
  /** 自定义页码格式化（缺省十进制；可接 reader 的中文数字 / 罗马数字） */
  format?: (page: number) => string;
  /** 目标未找到时的替换文本（缺省 `？`） */
  missing?: string;
  /** 自定义整体模板（缺省只输出页码本身，前后文字由正文承载） */
  template?: (formatted: string, match: PageReferenceMatch) => string;
}

/** 标签占位符（`{{ref:fig-1}}`） */
export interface LabelReferenceMatch {
  /** 完整占位符文本 */
  raw: string;
  /** 引用标签 */
  label: string;
  /** 起始偏移 */
  start: number;
  /** 结束偏移（不含） */
  end: number;
}
