/**
 * 站点页面渲染（纯函数：输入数据 → HTML 字符串）
 *
 * 安全约定：所有来自 IR 的文本都经 `escapeHtml` 转义；正文 HTML 由
 * `@bibliotype/layout/html` 的序列化器产出（唯一允许的 HTML 拼接入口）。
 * 样式只作用于 `.bt-reader-page` / `.bt-site-*`，不产生全局选择器。
 */
import { escapeHtml } from '@bibliotype/layout/html';
import { buildBookCss } from '@bibliotype/layout/html';
import type { LayoutOptions } from '@bibliotype/layout';
import type { SiteSection } from './types.js';

/** 页面导航目标 */
export interface NavTarget {
  /** 标题 */
  title: string;
  /** 相对路径 */
  path: string;
}

/** 章节页渲染输入 */
export interface SectionPageInput {
  /** 站点标题 */
  siteTitle: string;
  /** 本页标题 */
  title: string;
  /** 语言标记 */
  language: string;
  /** 正文 HTML（序列化器输出） */
  bodyHtml: string;
  /** 上一页 */
  prev?: NavTarget;
  /** 下一页 */
  next?: NavTarget;
}

/** 目录页渲染输入 */
export interface IndexPageInput {
  /** 站点标题 */
  siteTitle: string;
  /** 语言标记 */
  language: string;
  /** 目录项 */
  sections: readonly SiteSection[];
}

function renderNavLink(target: NavTarget | undefined, direction: 'prev' | 'next'): string {
  if (!target) {
    return '';
  }
  const label = direction === 'prev' ? '上一节' : '下一节';
  return `<a class="bt-site-nav-${direction}" rel="${direction}" href="${escapeHtml(target.path)}">${label}：${escapeHtml(target.title)}</a>`;
}

/** 渲染章节页 */
export function renderSectionPage(input: SectionPageInput): string {
  const prev = renderNavLink(input.prev, 'prev');
  const next = renderNavLink(input.next, 'next');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(input.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} · ${escapeHtml(input.siteTitle)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<nav class="bt-site-nav" aria-label="站点导航">
<a class="bt-site-nav-home" href="index.html">目录</a>
${prev}
${next}
</nav>
<main class="bt-reader-page" id="content">
${input.bodyHtml}
</main>
</body>
</html>
`;
}

/** 渲染目录页 */
export function renderIndexPage(input: IndexPageInput): string {
  const items = input.sections
    .map(
      (section) =>
        `<li class="bt-site-toc-item" data-level="${section.level}"><a href="${escapeHtml(section.path)}">${escapeHtml(section.title)}</a></li>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="${escapeHtml(input.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.siteTitle)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="bt-site-header"><h1>${escapeHtml(input.siteTitle)}</h1></header>
<nav class="bt-site-toc" aria-label="目录">
<ol>
${items}
</ol>
</nav>
</body>
</html>
`;
}

/** 站点样式输入 */
export interface SiteCssInput {
  /** 布局选项 */
  layout: LayoutOptions;
  /** 主题令牌 */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 作用域容器选择器 */
  containerSelector: string;
}

/** 站点附加样式（导航 / 目录 / 页面容器，全部局部选择器） */
const SITE_CHROME_CSS = `
.bt-site-header,
.bt-site-nav,
.bt-site-toc {
  max-width: 46rem;
  margin: 0 auto;
  padding: 1rem 1.25rem;
  font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.bt-site-nav {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}
.bt-site-nav a {
  color: inherit;
  text-decoration: none;
  opacity: 0.85;
}
.bt-site-nav a:hover {
  opacity: 1;
  text-decoration: underline;
}
.bt-site-toc ol {
  list-style: none;
  padding: 0;
}
.bt-site-toc-item[data-level='1'] { padding-left: 1.25rem; }
.bt-site-toc-item[data-level='2'] { padding-left: 2.5rem; }
.bt-site-toc-item a {
  display: block;
  padding: 0.35rem 0;
  color: inherit;
  text-decoration: none;
}
.bt-site-toc-item a:hover { text-decoration: underline; }
`;

/** 生成站点样式表（书册样式 + 站点框架样式） */
export function buildSiteCss(input: SiteCssInput): string {
  const bookCss = buildBookCss({
    tokens: input.tokens,
    options: input.layout,
    containerSelector: input.containerSelector,
  });
  return `${bookCss}\n${SITE_CHROME_CSS}`;
}
