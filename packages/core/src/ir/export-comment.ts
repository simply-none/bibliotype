/**
 * 评论导出跨包契约
 *
 * 评论数据来自 `@bibliotype/annotation`，但各类导出器（EPUB / 站点 / DOCX）只依赖本契约，
 * 不反向依赖 annotation 包 —— 避免导出层引入协同 / 存储等无关依赖。
 */
import type { Anchor } from './anchor.js';

/** 可导出的一条评论 */
export interface ExportComment {
  /** 锚点（定位到原书正文，与正文注记 / 书签共用同一契约） */
  anchor: Anchor;
  /** 评论正文（纯文本） */
  body: string;
  /** 作者名（缺省省略） */
  author?: string;
  /** 创建时间（ISO 8601；缺省省略，导出器不做时间生成） */
  createdAt?: string;
}
