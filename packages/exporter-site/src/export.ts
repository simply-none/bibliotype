/**
 * 静态站点导出编排
 *
 * 纯函数：IR + 选项 → `SiteFile[]`，不触磁盘 / 网络（写入由调用方决定，
 * 浏览器可打包 ZIP，Node 可 `fs.writeFile`）。产物确定性：无时间戳、按节序编号。
 */
import { DEFAULT_THEME, NODE_TYPES } from '@bibliotype/core';
import type { BookDocument, BookNode } from '@bibliotype/core';
import { DEFAULT_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { serializeNode } from '@bibliotype/layout/html';
import { planSections } from './plan.js';
import { buildSiteCss, renderIndexPage, renderSectionPage } from './render.js';
import { buildSearchEntry, serializeSearchIndex } from './search.js';
import type { SiteExportOptions, SiteExportResult, SiteFile, SiteSearchEntry } from './types.js';

/** 缺省作用域容器（与书册样式约定一致） */
export const DEFAULT_SITE_CONTAINER = '.bt-reader-page';

/** 缺省节数上限（防误导出超长书；超限请显式提高） */
export const DEFAULT_MAX_SECTIONS = 2000;

function jsonFile(path: string, value: unknown): SiteFile {
  return { path, mediaType: 'application/json', text: JSON.stringify(value) };
}

/**
 * 导出静态站点
 *
 * @throws RangeError 节数超过 `maxSections`（不静默截断）
 */
export function exportSite(
  document: BookDocument,
  options: SiteExportOptions = {},
): SiteExportResult {
  const plan = planSections(document);
  const warnings = [...plan.warnings];

  /* 评论聚合：导出期追加「读者评论」页，不改动原文档 */
  if (options.includeComments === true && options.comments !== undefined && options.comments.length > 0) {
    const commentNodes: BookNode[] = options.comments.map((comment, index) => ({
      type: NODE_TYPES.PARAGRAPH,
      id: `comment-${index}`,
      children: [{ type: 'text', text: `${comment.author ?? '匿名'}：${comment.body}` }],
    }));
    plan.sections.push({
      section: { id: 'comments', path: 'comments.html', title: '读者评论', level: 1, type: NODE_TYPES.CHAPTER },
      node: { type: NODE_TYPES.CHAPTER, id: '__comments__', children: commentNodes },
    });
  }

  const maxSections = options.maxSections ?? DEFAULT_MAX_SECTIONS;
  if (plan.sections.length > maxSections) {
    throw new RangeError(
      `导出失败：节数 ${plan.sections.length} 超过上限 ${maxSections}，请提高 maxSections 或先拆分书籍。`,
    );
  }

  const siteTitle = options.siteTitle ?? document.metadata.title;
  const language = options.language ?? document.metadata.language ?? 'zh-Hans';
  const selector = options.containerSelector ?? DEFAULT_SITE_CONTAINER;
  const layout = options.layout ?? DEFAULT_LAYOUT_OPTIONS;
  const tokens = options.tokens ?? DEFAULT_THEME;

  const files: SiteFile[] = [];
  const searchEntries: SiteSearchEntry[] = [];
  const sections = plan.sections.map((item) => item.section);

  plan.sections.forEach((item, index) => {
    const bodyHtml = (item.node.children ?? [])
      .map((child) => serializeNode(child))
      .join('\n');
    const prev = index > 0 ? sections[index - 1] : undefined;
    const next = index < sections.length - 1 ? sections[index + 1] : undefined;

    files.push({
      path: item.section.path,
      mediaType: 'text/html',
      text: renderSectionPage({
        siteTitle,
        title: item.section.title,
        language,
        bodyHtml,
        prev: prev ? { title: prev.title, path: prev.path } : undefined,
        next: next ? { title: next.title, path: next.path } : undefined,
      }),
    });

    searchEntries.push(
      buildSearchEntry(item.section.id, item.section.title, item.section.path, item.node),
    );
  });

  files.push({
    path: 'index.html',
    mediaType: 'text/html',
    text: renderIndexPage({ siteTitle, language, sections }),
  });
  files.push({
    path: 'style.css',
    mediaType: 'text/css',
    text: buildSiteCss({ layout, tokens, containerSelector: selector }),
  });

  if (options.searchIndex !== false) {
    files.push({
      path: 'search-index.json',
      mediaType: 'application/json',
      text: serializeSearchIndex(searchEntries),
    });
  }
  if (options.includeBookJson !== false) {
    files.push(jsonFile('book.json', document));
  }

  if (sections.length === 0) {
    warnings.push('已生成空站点：仅含目录页与样式。');
  }

  return {
    files: [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    sections,
    warnings,
  };
}
