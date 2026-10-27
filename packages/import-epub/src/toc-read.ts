/**
 * 目录源门面：定位并解析 epub 的目录（`nav.xhtml` 优先，`toc.ncx` 次之）
 *
 * 为什么 nav 优先：EPUB 3 以 `<nav epub:type="toc">` 为权威目录，NCX 只是向后兼容；
 * 不少 EPUB 3 书根本没有 ncx，只读 ncx 会让这类书退化为「全文标题平铺」。
 *
 * 本模块统一做两件收尾工作（两种目录源共用，避免各自复制容错逻辑）：
 * 1. 条目里的 docPath 归一为**实际 zip 条目名**（大小写 / 转义容错），
 *    归一失败的记入 `missing`，由正文侧报告而不静默丢弃；
 * 2. 统计不了层级之外的额外信息一律不猜——目录树原样交出去。
 */
import { attrAt, decode, parseXml } from './xml.js';
import { dirOf, lookupEntry, resolveHref } from './toc-path.js';
import { parseNcxToc } from './toc-ncx.js';
import { parseNavToc } from './toc-nav.js';
import type { EpubFiles, TocEntry, TocPlan } from './toc-types.js';

/** 目录媒体类型（OPF manifest 声明值） */
const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';

/** 从 OPF manifest 找满足条件的条目路径（相对 OPF 目录解析） */
function findManifestItem(
  files: EpubFiles,
  opfPath: string,
  matches: (attrs: { href: string; mediaType: string; properties: string }) => boolean,
): string | undefined {
  const opf = files[opfPath];
  if (opf === undefined) return undefined;
  const doc = parseXml(decode(opf), 'content.opf');
  const items = doc.getElementsByTagName('item');
  for (let i = 0; i < items.length; i += 1) {
    const href = attrAt(items, i, 'href');
    if (href === '') continue;
    const attrs = {
      href,
      mediaType: attrAt(items, i, 'media-type'),
      properties: attrAt(items, i, 'properties'),
    };
    if (matches(attrs)) {
      const target = lookupEntry(files, resolveHref(dirOf(opfPath), href));
      if (target !== undefined) return target;
    }
  }
  return undefined;
}

/** 定位 nav.xhtml：优先 manifest 的 `properties~=nav`，否则按文件名兜底 */
function findNavPath(files: EpubFiles, opfPath: string): string | undefined {
  const declared = findManifestItem(files, opfPath, (attrs) => attrs.properties.includes('nav'));
  if (declared !== undefined) return declared;
  return Object.keys(files).find((name) => name.toLowerCase().endsWith('nav.xhtml'));
}

/** 定位 toc.ncx：优先 manifest 的 ncx 媒体类型，否则按扩展名兜底 */
function findNcxPath(files: EpubFiles, opfPath: string): string | undefined {
  const declared = findManifestItem(files, opfPath, (attrs) => attrs.mediaType === NCX_MEDIA_TYPE);
  if (declared !== undefined) return declared;
  return Object.keys(files).find((name) => name.toLowerCase().endsWith('.ncx'));
}

/** 把条目里的 docPath 归一为实际条目名；归一失败的进 `missing` */
function normalizeEntries(
  entries: TocEntry[],
  files: EpubFiles,
  missing: string[],
): TocEntry[] {
  return entries.map((entry) => {
    let docPath = entry.docPath;
    if (docPath !== '') {
      const actual = lookupEntry(files, docPath);
      if (actual === undefined) {
        if (!missing.includes(docPath)) missing.push(docPath);
      } else {
        docPath = actual;
      }
    }
    return {
      title: entry.title,
      docPath,
      anchor: entry.anchor,
      children: normalizeEntries(entry.children, files, missing),
    };
  });
}

/**
 * 解析 epub 目录
 *
 * @param files 解包后的条目表
 * @param opfPath OPF 包文档路径（定位 nav / ncx 的入口）
 * @returns 目录计划；nav 与 ncx 都不存在时 `source: 'none'`（调用方走扁平回退）
 */
export function readToc(files: EpubFiles, opfPath: string): TocPlan {
  const navPath = findNavPath(files, opfPath);
  if (navPath !== undefined) {
    const data = files[navPath];
    if (data !== undefined) {
      const missing: string[] = [];
      const entries = normalizeEntries(
        parseNavToc(decode(data), dirOf(navPath)),
        files,
        missing,
      );
      if (entries.length > 0) return { source: 'nav', file: navPath, entries, missing };
    }
  }

  const ncxPath = findNcxPath(files, opfPath);
  if (ncxPath !== undefined) {
    const data = files[ncxPath];
    if (data !== undefined) {
      const missing: string[] = [];
      const entries = normalizeEntries(
        parseNcxToc(decode(data), dirOf(ncxPath)),
        files,
        missing,
      );
      if (entries.length > 0) return { source: 'ncx', file: ncxPath, entries, missing };
    }
  }

  return { source: 'none', file: '', entries: [], missing: [] };
}
