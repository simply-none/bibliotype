/**
 * 目录与报告的类型定义（import-epub 内部共用）
 *
 * `TocEntry` 是 nav.xhtml / toc.ncx 两种目录源的**统一形态**：一棵任意深度的树，
 * 每个条目指向「某个正文文档 + 可选页内锚点」。正文重建按这棵树切分与嵌套，
 * 目录层级因此不再被压平。
 */

/** 解包后的「zip 路径 → 字节」表 */
export type EpubFiles = Record<string, Uint8Array>;

/** 目录条目（nav / ncx 统一形态） */
export interface TocEntry {
  /** 目录显示文本（已 trim；可能为空，此时由正文首标题兜底） */
  title: string;
  /** 指向的正文文档 zip 路径（已归一为实际条目名；纯分组标题为空串） */
  docPath: string;
  /** 页内锚点 id（'' 表示指向文档开头） */
  anchor: string;
  /** 子条目（层级由嵌套关系表达） */
  children: TocEntry[];
}

/** 目录计划（`readToc` 产物） */
export interface TocPlan {
  /** 目录来源：`nav`（EPUB 3）/ `ncx`（EPUB 2）/ `none`（两者皆无） */
  source: 'nav' | 'ncx' | 'none';
  /** 目录文件自身路径（解析其内部 href 的基准；`none` 时为空串） */
  file: string;
  /** 目录树（根层条目） */
  entries: TocEntry[];
  /** 目录引用了但 zip 内不存在的文件（已去重；正文侧据此报告丢失） */
  missing: string[];
}

/** 导入诊断报告（经 `EpubToHtmlOptions.onReport` 透出，不参与正文产物） */
export interface EpubImportReport {
  /** 实际采用的目录来源 */
  tocSource: 'nav' | 'ncx' | 'none';
  /** 目录条目总数（含各级子条目） */
  tocEntries: number;
  /** 目录/正文引用了 zip 内不存在的文件（丢失的正文，供排查坏书） */
  missingFiles: string[];
  /** 目录条目的锚点在对应文档里找不到（该条目退化为空容器，内容不丢） */
  unlocatedAnchors: string[];
}

/**
 * 深度 → 结构容器类名
 *
 * 与 `@bibliotype/editor` 的 `div.bt-volume` / `div.bt-chapter` / `div.bt-section`
 * parseDOM 规则一一对应；更深层级继续用 section 嵌套表达（reader 目录支持任意深度）。
 */
export const STRUCTURE_CLASSES = ['bt-volume', 'bt-chapter', 'bt-section'] as const;
