/**
 * 目录/正文的路径解析与顺序校正（纯函数，可独立测试）
 *
 * 三件事：
 * 1. `resolveHref`：把目录文件里的相对 href 解析为 zip 内路径（去掉锚点与查询、
 *    规范化 `.` 与 `..`、尝试 URL 解码）；
 * 2. `lookupEntry`：按实际 zip 条目名查文件（大小写与转义形态容错）——
 *    zip 条目名大小写敏感，OPF / 目录里的 href 却常有出入，不归一就会静默丢正文；
 * 3. `orderContentPaths`：用目录顺序校正正文顺序（目录即真实阅读顺序）。
 */
import type { EpubFiles, TocEntry } from './toc-types.js';

/** 目录部分（保留尾斜杠；无目录返回空串） */
export function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx + 1) : '';
}

/** URL 解码（非法转义原样返回，不阻断解析） */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 锚点 id 解码（目录里的 `#%E4%B8%80` 与文档 `id="一"` 需能对上） */
export function decodeAnchor(anchor: string): string {
  return safeDecode(anchor);
}

/**
 * 相对基准目录解析 href
 *
 * @param baseDir 基准目录（含尾斜杠，通常为「目录文件 / OPF 文件」自身所在目录）
 * @param href 原始引用（可带 `#锚点` / `?查询`，可含 `../` 与 URL 转义）
 * @returns zip 内路径（不含锚点与查询，已去掉 `.` 段并折叠 `..`）
 */
export function resolveHref(baseDir: string, href: string): string {
  const clean = safeDecode(href.split('#')[0]?.split('?')[0] ?? href);
  const segments: string[] = [];
  for (const seg of (baseDir + clean).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  return segments.join('/');
}

/**
 * 按 zip 实际条目名查文件
 *
 * 顺序：精确命中 → 解码后命中 → 忽略大小写命中 → 双方都解码后忽略大小写命中。
 * 返回**实际条目名**（后续拼接 id / 查表都用它，避免同一条目出现两种写法）。
 *
 * @param files 解包后的条目表
 * @param path 待查路径（通常来自 `resolveHref`）
 * @returns 实际条目名；zip 内不存在时为 `undefined`
 */
export function lookupEntry(files: EpubFiles, path: string): string | undefined {
  if (files[path] !== undefined) return path;

  const decoded = safeDecode(path);
  if (files[decoded] !== undefined) return decoded;

  const lower = decoded.toLowerCase();
  for (const name of Object.keys(files)) {
    if (name.toLowerCase() === lower || safeDecode(name).toLowerCase() === lower) {
      return name;
    }
  }
  return undefined;
}

/** 目录树先序收集「文档 → 条目」映射（同一文档多条目 = 该文件内含多章） */
export function groupEntriesByDoc(entries: readonly TocEntry[]): Map<string, TocEntry[]> {
  const byDoc = new Map<string, TocEntry[]>();
  const visit = (list: readonly TocEntry[]): void => {
    for (const entry of list) {
      if (entry.docPath !== '') {
        const bucket = byDoc.get(entry.docPath);
        if (bucket === undefined) byDoc.set(entry.docPath, [entry]);
        else bucket.push(entry);
      }
      visit(entry.children);
    }
  };
  visit(entries);
  return byDoc;
}

/**
 * 用目录顺序校正正文文档顺序
 *
 * 目录树先序里 `docPath` 的首次出现顺序即阅读顺序；spine 中未被目录收录的文档
 * （封面 / 版权页 / 后记等辅助页）插到「spine 中位于它之前、且已出现在主序中」的文档之后，
 * 无前驱则置顶。目录指向但 spine 未声明的文档被丢弃（不作为正文）。
 *
 * @param contentPaths spine 解析出的正文文档（保序）
 * @param entries 目录树
 * @returns 校正后的正文文档顺序（与 `contentPaths` 同集合，仅顺序可能不同）
 */
export function orderContentPaths(
  contentPaths: readonly string[],
  entries: readonly TocEntry[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const visit = (list: readonly TocEntry[]): void => {
    for (const entry of list) {
      if (entry.docPath !== '' && !seen.has(entry.docPath)) {
        seen.add(entry.docPath);
        ordered.push(entry.docPath);
      }
      visit(entry.children);
    }
  };
  visit(entries);

  for (const [index, path] of contentPaths.entries()) {
    if (seen.has(path)) continue;
    let insertAt = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const prev = contentPaths[cursor];
      const position = prev === undefined ? -1 : ordered.indexOf(prev);
      if (position >= 0) {
        insertAt = position + 1;
        break;
      }
    }
    ordered.splice(insertAt, 0, path);
    seen.add(path);
  }

  const allowed = new Set(contentPaths);
  return ordered.filter((path) => allowed.has(path));
}
