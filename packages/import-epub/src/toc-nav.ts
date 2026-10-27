/**
 * EPUB 3 导航文档（nav.xhtml）→ 目录树
 *
 * EPUB 3 以 `<nav epub:type="toc">` 为目录的权威来源（嵌套 `ol > li > a` 天然表达
 * 任意层级），而不少书籍**没有** toc.ncx。只读 NCX 会让这类书退化为「全文标题平铺」，
 * 故此处优先解析 nav。
 *
 * 产出只做 href → zip 路径的解析，路径是否真实存在由 `toc-read` 统一归一（一处容错）。
 */
import { parseXml } from './xml.js';
import { decodeAnchor, resolveHref } from './toc-path.js';
import type { TocEntry } from './toc-types.js';

/** 目录导航块（`<nav>`）的 epub:type 标记值 */
const NAV_TOC_TYPE = 'toc';

/** 取直接子元素中的指定标签名（忽略命名空间前缀大小写） */
function childElement(parent: Element, tagName: string): Element | undefined {
  const lower = tagName.toLowerCase();
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes.item(i);
    if (child === null || child.nodeType !== 1) continue;
    if ((child.nodeName || '').toLowerCase() === lower) return child as Element;
  }
  return undefined;
}

/** 是否目录型 `<nav>`：优先看 epub:type / type，其次看是否含 `<ol>` */
function isTocNav(element: Element): boolean {
  const type = element.getAttribute('epub:type') ?? element.getAttribute('type') ?? '';
  if (type !== '') {
    return type
      .split(/\s+/)
      .some((token) => token.toLowerCase() === NAV_TOC_TYPE);
  }
  return element.getElementsByTagName('ol').length > 0;
}

/** 取文本并压缩空白（目录标签里的换行 / 缩进不属于标题） */
function labelOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** 拆分 `href` 为「文档路径 + 锚点」 */
function splitHref(baseDir: string, href: string): { docPath: string; anchor: string } {
  const hash = href.indexOf('#');
  if (hash < 0) return { docPath: resolveHref(baseDir, href), anchor: '' };
  return {
    docPath: resolveHref(baseDir, href.slice(0, hash)),
    anchor: decodeAnchor(href.slice(hash + 1)),
  };
}

/** 解析一层 `<ol>`（每个 `<li>` 一个条目，可带嵌套 `<ol>`） */
function parseList(list: Element, baseDir: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (let i = 0; i < list.childNodes.length; i += 1) {
    const node = list.childNodes.item(i);
    if (node === null || node.nodeType !== 1) continue;
    if ((node.nodeName || '').toLowerCase() !== 'li') continue;
    const item = node as Element;

    const link = childElement(item, 'a') ?? childElement(item, 'span');
    const href = link?.getAttribute('href') ?? '';
    /* 无 href 的条目（`<span>`）是纯分组标题：自身不指向任何文档，
       归属文档由子条目决定，故不做 href 继承（否则父子会抢同一个锚点）。 */
    const target = href === '' ? { docPath: '', anchor: '' } : splitHref(baseDir, href);

    const nested = childElement(item, 'ol');
    entries.push({
      title: link === undefined ? '' : labelOf(link),
      docPath: target.docPath,
      anchor: target.anchor,
      children: nested === undefined ? [] : parseList(nested, baseDir),
    });
  }
  return entries;
}

/**
 * 解析 nav.xhtml 为目录树
 *
 * @param xmlText nav.xhtml 全文
 * @param baseDir nav 文件自身所在目录（其内部 href 的解析基准）
 * @returns 目录树；文档里找不到目录型 `<nav>` 时返回空数组
 */
export function parseNavToc(xmlText: string, baseDir: string): TocEntry[] {
  const doc = parseXml(xmlText, 'nav.xhtml');
  const navs = doc.getElementsByTagName('nav');
  let tocNav: Element | undefined;
  for (let i = 0; i < navs.length; i += 1) {
    const candidate = navs.item(i);
    if (candidate === null) continue;
    if (isTocNav(candidate)) {
      tocNav = candidate;
      break;
    }
  }
  if (tocNav === undefined) return [];

  const list = childElement(tocNav, 'ol') ?? tocNav.getElementsByTagName('ol').item(0);
  if (list === null || list === undefined) return [];
  return parseList(list as Element, baseDir);
}
