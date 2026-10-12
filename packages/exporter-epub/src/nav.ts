/**
 * EPUB 3 导航文档生成（nav.xhtml）
 *
 * 由「章节计划 + 锚点」产出的 NavItem 树渲染为嵌套 <ol>；
 * EPUB 3 阅读系统以 nav 文档为目录权威来源（NCX 不再需要）。
 */
import { escapeHtml } from '@bibliotype/layout/html';
import type { NavItem } from './sections.js';
import { renderXhtmlDocument } from './xhtml.js';

/** 导航文档生成输入 */
export interface NavXhtmlInput {
  /** 导航标题（如「目录」） */
  title: string;
  /** 语言标记（BCP 47） */
  language: string;
  items: readonly NavItem[];
}

/** 生成 nav.xhtml（EPUB 3 目录文档） */
export function buildNavXhtml(input: NavXhtmlInput): string {
  const body = `<nav epub:type="toc" id="bt-toc">
<h1>${escapeHtml(input.title)}</h1>
${renderList(input.items)}
</nav>`;
  return renderXhtmlDocument({
    title: input.title,
    language: input.language,
    body,
    cssHref: 'style.css',
  });
}

/** 渲染嵌套列表（空列表输出空 <ol>） */
function renderList(items: readonly NavItem[]): string {
  if (items.length === 0) return '<ol></ol>';
  return `<ol>\n${items.map(renderItem).join('\n')}\n</ol>`;
}

/** 渲染单条目（有子项时嵌套一层 <ol>） */
function renderItem(item: NavItem): string {
  const children = item.children.length > 0 ? `\n${renderList(item.children)}` : '';
  return `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>${children}</li>`;
}
