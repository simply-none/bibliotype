/**
 * EPUB 2 目录（toc.ncx）→ 目录树
 *
 * NCX 的 `navPoint` 本身是嵌套结构，depth 天然表达层级；旧实现把它压成
 * 「depth 0 = 卷、其余 = 章」两层并丢掉 anchor，导致多级目录被拍平、
 * 一个文档里的多章无法分开。此处完整保留嵌套与锚点。
 *
 * 关键修正：`content src` 按规范**相对于 toc.ncx 自身所在目录**解析
 * （旧实现错误地按 OPF 目录解析，NCX 放在子目录时全部匹配失败）。
 */
import { parseXml } from './xml.js';
import { decodeAnchor, resolveHref } from './toc-path.js';
import type { TocEntry } from './toc-types.js';

/** 取直接子元素中的指定标签名（忽略大小写） */
function childElement(parent: Element, tagName: string): Element | undefined {
  const lower = tagName.toLowerCase();
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const child = parent.childNodes.item(i);
    if (child === null || child.nodeType !== 1) continue;
    if ((child.nodeName || '').toLowerCase() === lower) return child as Element;
  }
  return undefined;
}

/** navPoint 的显示标题：`<navLabel><text>` 文本（压缩空白） */
function titleOf(point: Element): string {
  const label = childElement(point, 'navLabel');
  const text = label === undefined ? undefined : childElement(label, 'text');
  return (text?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** navPoint 的 `content src` 拆为「文档路径 + 锚点」 */
function targetOf(point: Element, baseDir: string): { docPath: string; anchor: string } {
  const src = childElement(point, 'content')?.getAttribute('src') ?? '';
  const hash = src.indexOf('#');
  if (hash < 0) return { docPath: src === '' ? '' : resolveHref(baseDir, src), anchor: '' };
  return {
    docPath: resolveHref(baseDir, src.slice(0, hash)),
    anchor: decodeAnchor(src.slice(hash + 1)),
  };
}

/** 解析一层 navPoint 序列（父节点下的直接 navPoint 子元素） */
function parsePoints(parent: Element, baseDir: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const node = parent.childNodes.item(i);
    if (node === null || node.nodeType !== 1) continue;
    if ((node.nodeName || '').toLowerCase() !== 'navpoint') continue;
    const point = node as Element;
    const target = targetOf(point, baseDir);
    entries.push({
      title: titleOf(point),
      docPath: target.docPath,
      anchor: target.anchor,
      children: parsePoints(point, baseDir),
    });
  }
  return entries;
}

/**
 * 解析 toc.ncx 为目录树
 *
 * @param xmlText toc.ncx 全文
 * @param baseDir ncx 文件自身所在目录（其 `content src` 的解析基准）
 * @returns 目录树；缺 `navMap` 时返回空数组
 */
export function parseNcxToc(xmlText: string, baseDir: string): TocEntry[] {
  const doc = parseXml(xmlText, 'toc.ncx');
  const navMap = doc.getElementsByTagName('navMap').item(0);
  if (navMap === null) return [];
  return parsePoints(navMap as Element, baseDir);
}
