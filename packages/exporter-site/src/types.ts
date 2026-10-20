/**
 * 静态站点导出类型
 *
 * 产物是「可上传到任意静态托管」的文件集合：`index.html`（目录）+ 每节一页 +
 * `style.css` + `search-index.json`（可选）+ `book.json`（IR 原文，可选）。
 * 全部为文本文件，输出确定性（无时间戳、路径按节序编号）。
 */
import type { LayoutOptions } from '@bibliotype/layout';

/** 站点文件（全部为文本） */
export interface SiteFile {
  /** 相对路径（如 `section-1.html`） */
  path: string;
  /** MIME 类型 */
  mediaType: string;
  /** 文本内容 */
  text: string;
}

/** 站点目录项（每项对应一个页面） */
export interface SiteSection {
  /** 节标识（取节点 id，缺失时用序号） */
  id: string;
  /** 页面相对路径 */
  path: string;
  /** 标题 */
  title: string;
  /** 层级（用于目录缩进） */
  level: number;
  /** 源节点类型 */
  type: string;
}

/** 搜索索引条目 */
export interface SiteSearchEntry {
  /** 节标识 */
  id: string;
  /** 标题 */
  title: string;
  /** 页面路径 */
  path: string;
  /** 正文纯文本 */
  text: string;
}

/** 导出选项 */
export interface SiteExportOptions {
  /** 站点标题（缺省 metadata.title） */
  siteTitle?: string;
  /** 语言标记（缺省 metadata.language 或 `zh-Hans`） */
  language?: string;
  /** 布局选项（缺省 layout 的 DEFAULT_LAYOUT_OPTIONS） */
  layout?: LayoutOptions;
  /** 主题令牌（缺省 core 的 DEFAULT_THEME） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 样式作用域容器选择器（缺省 `.bt-reader-page`） */
  containerSelector?: string;
  /** 是否输出 `book.json`（IR 原文，缺省 true） */
  includeBookJson?: boolean;
  /** 是否输出 `search-index.json`（缺省 true） */
  searchIndex?: boolean;
  /** 导出的最大节数保护（缺省 2000，防误导出超长书） */
  maxSections?: number;
}

/** 导出结果 */
export interface SiteExportResult {
  /** 文件列表（按路径升序） */
  files: SiteFile[];
  /** 目录项（按页面顺序） */
  sections: SiteSection[];
  /** 告警（不阻断导出） */
  warnings: string[];
}
