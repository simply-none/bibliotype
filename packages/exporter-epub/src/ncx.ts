/**
 * EPUB 2 兼容目录文档生成（toc.ncx）
 *
 * 京东读书等底层为 Adobe RMSDK（EPUB 2 引擎）的阅读器只认 `version="2.0"` 的 OPF
 * 与 `toc.ncx`，不识别 EPUB 3 的 nav.xhtml，缺 ncx 时会一直卡在「加载中」。
 * 因此导出在保留 EPUB 3 nav 的同时，额外生成一份 toc.ncx 并接入 OPF（spine toc="ncx"），
 * 兼顾 EPUB 3 阅读系统与旧版 EPUB 2 阅读系统（EPUB 3 向后兼容推荐做法）。
 */
import { escapeXml } from '@bibliotype/layout/html';
import type { NavItem } from './sections.js';

/** toc.ncx 生成输入 */
export interface NcxInput {
  /** 目录标题（docTitle） */
  title: string;
  /** 语言标记（BCP 47，用于 ncx 根 xml:lang） */
  language: string;
  /** 书籍唯一标识（dc:identifier 内容；写入 ncx head 的 dtb:uid，须与 OPF unique-identifier 一致） */
  uid: string;
  /** 导航条目树（与 nav.xhtml 同源，href 为 OEBPS 相对路径 + 锚点） */
  items: readonly NavItem[];
}

/** 生成 toc.ncx（EPUB 2 NCX 2005-1） */
export function buildNcx(input: NcxInput): string {
  const { title, language, uid, items } = input;
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(language)}">
<head>
  <meta content="${escapeXml(uid)}" name="dtb:uid"/>
  <meta content="2" name="dtb:depth"/>
  <meta content="bibliotype" name="dtb:generator"/>
  <meta content="0" name="dtb:totalPageCount"/>
  <meta content="0" name="dtb:maxPageNumber"/>
</head>
<docTitle>
  <text>${escapeXml(title)}</text>
</docTitle>
<navMap>
${renderNavMap(items)}
</navMap>
</ncx>
`;
}

/**
 * 渲染 navMap：前序遍历，playOrder 全局连续递增、navPoint id 唯一（np-1, np-2, ...）。
 * 每个 navPoint 自包含：父级 <navPoint> 包住其 <navLabel>/<content> 与全部子 <navPoint>，再闭合。
 */
function renderNavMap(items: readonly NavItem[]): string {
  let order = 0;
  const lines: string[] = [];

  const render = (item: NavItem, depth: number): void => {
    order += 1;
    const pad = '  '.repeat(depth);
    lines.push(`${pad}<navPoint id="np-${order}" playOrder="${order}">`);
    lines.push(`${pad}  <navLabel><text>${escapeXml(item.label)}</text></navLabel>`);
    lines.push(`${pad}  <content src="${escapeXml(item.href)}"/>`);
    for (const child of item.children) {
      render(child, depth + 1);
    }
    lines.push(`${pad}</navPoint>`);
  };

  for (const item of items) {
    render(item, 1);
  }
  return lines.join('\n');
}
