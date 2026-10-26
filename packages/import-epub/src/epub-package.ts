/**
 * EPUB 包结构读取（副作用层：解 zip + 解析 XML，均**无需浏览器 DOM**，浏览器与 Node 同构）
 *
 * 依赖方向：import-epub → fflate（解包）、@xmldom/xmldom（XML 结构读取）。
 * 本模块只做「字节 → 结构 → 正文 HTML 片段」：解 zip → container.xml 定位 OPF → OPF 的
 * manifest + spine 解析出内容文档顺序 → 逐个 XHTML 取 `<body>` 内层序列化拼接。
 * 之所以用 `@xmldom/xmldom` 而非浏览器 `DOMParser`：这些是纯 XML 结构读取（getAttribute /
 * getElementsByTagName），xmldom 自足、不依赖运行环境，保证 Node 同构（决策 D2）。
 * XHTML → IR 的最终转换仍复用 `@bibliotype/import` 的 HTML 通路（需 DOM），与 docx 通路一致。
 */
import { DOMParser as XmlDomParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync } from 'fflate';

/** epub 原始字节：浏览器 `File.arrayBuffer()` / Node `fs` 读得的 `Uint8Array` 统一入口 */
export type EpubInput = ArrayBuffer | Uint8Array;

/**
 * 单张图片的内联上限（字节）
 *
 * 内联是把图片字节以 base64 写进 IR（`img.src`），换取「IR 自包含、导出侧无需媒体表即可复原」。
 * 代价是 IR 体积放大约 4/3 倍；超过此上限的图退化处理（保留原相对 `src`），
 * 避免单张扫描图 / 高清插画把整份文档撑爆（demo 的草稿自动保存会连带写入）。
 */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

/** 扩展名 → 媒体类型兜底表（OPF manifest 未给出类型时按路径后缀推断） */
const EXT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

/** 解包后的「zip 路径 → 字节」表 */
export type EpubFiles = Record<string, Uint8Array>;

/** 正文抽取选项 */
export interface ExtractBodiesOptions {
  /**
   * 是否把图片内联为 data URI（默认 false）
   *
   * 见 §D4 资源策略（与 `import-docx` 同源讨论，此处取值范围与默认值不同）：
   * epub 的图片是**包内独立文件**，「导入 → 导出」往返若不把字节带出来，
   * 导出产物里的 `<img>` 全是**指向不存在文件的死链**（书籍本身仍能打开，但插图全丢），
   * 故 `epubToHtml` / `epubToBookDocument` 默认开启；仅需轻量 IR 时可显式关闭。
   */
  inlineImages?: boolean;
  /** 「zip 路径 → 媒体类型」表（由 readMediaTypes 产出；缺省按扩展名推断） */
  mediaTypes?: ReadonlyMap<string, string>;
}

/** 归一为字节视图并解 zip；空 / 非 zip / 损坏均抛中文 RangeError */
export function unzipEpub(input: EpubInput): EpubFiles {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) {
    throw new RangeError('epub 数据为空：请传入有效的 .epub 文件字节（ArrayBuffer 或 Uint8Array）。');
  }
  try {
    return unzipSync(bytes);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new RangeError(`epub 解包失败（非合法 .epub / zip 或文件已损坏）：${detail}`);
  }
}

/** UTF-8 解码（TextDecoder 在浏览器 / Node / happy-dom 均为全局） */
function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** 解析 XML；致命错误收敛为带标签的中文 RangeError，非致命告警静默（外部 epub 常有噪声） */
function parseXml(xml: string, label: string): Document {
  const parser = new XmlDomParser({
    errorHandler: {
      warning: () => {},
      error: () => {},
      fatalError: (message: unknown) => {
        throw new Error(String(message));
      },
    },
  });
  try {
    return parser.parseFromString(xml, 'application/xml');
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new RangeError(`${label} 解析失败（XML 非法或已损坏）：${detail}`);
  }
}

/** 取集合中第 i 个元素的属性（兼容 noUncheckedIndexedAccess 的 null / undefined） */
function attrAt(collection: { length: number; item(i: number): Element | null }, i: number, name: string): string {
  return collection.item(i)?.getAttribute(name) ?? '';
}

/** 从 container.xml 定位 OPF 路径（首个 rootfile 的 full-path） */
export function findOpfPath(files: EpubFiles): string {
  const container = files['META-INF/container.xml'];
  if (container === undefined) {
    throw new RangeError('epub 缺少 META-INF/container.xml：不符合 OCF 规范，无法定位包文档。');
  }
  const doc = parseXml(decode(container), 'container.xml');
  const rootfiles = doc.getElementsByTagName('rootfile');
  for (let i = 0; i < rootfiles.length; i += 1) {
    const path = attrAt(rootfiles, i, 'full-path');
    if (path !== '') {
      return path;
    }
  }
  throw new RangeError('container.xml 未声明有效 rootfile：epub 可能损坏或结构不受支持。');
}

/** 目录部分（去尾斜杠后的父目录，含尾斜杠；无目录返回空串） */
function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx + 1) : '';
}

/** 相对 OPF 目录解析 href（去锚点 / 查询、规范化 `.` 与 `..`、尝试 URL 解码） */
function resolvePath(baseDir: string, href: string): string {
  let clean = href.split('#')[0]?.split('?')[0] ?? href;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* 保留原值：非标准转义不阻断解析 */
  }
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

/** 依 OPF 的 manifest + spine 解析出内容文档的 zip 路径（按 spine 顺序） */
export function readContentPaths(files: EpubFiles, opfPath: string): string[] {
  const opf = files[opfPath];
  if (opf === undefined) {
    throw new RangeError(`epub 缺少包文档 "${opfPath}"（container.xml 指向的文件不存在）。`);
  }
  const doc = parseXml(decode(opf), 'content.opf');

  const hrefById = new Map<string, string>();
  const items = doc.getElementsByTagName('item');
  for (let i = 0; i < items.length; i += 1) {
    const id = attrAt(items, i, 'id');
    const href = attrAt(items, i, 'href');
    if (id !== '' && href !== '') {
      hrefById.set(id, href);
    }
  }

  const opfDir = dirOf(opfPath);
  const paths: string[] = [];
  const refs = doc.getElementsByTagName('itemref');
  for (let i = 0; i < refs.length; i += 1) {
    const idref = attrAt(refs, i, 'idref');
    const href = idref !== '' ? hrefById.get(idref) : undefined;
    if (href !== undefined) {
      paths.push(resolvePath(opfDir, href));
    }
  }
  if (paths.length === 0) {
    throw new RangeError('epub 的 spine 未解析出任何内容文档：无法导入正文。');
  }
  return paths;
}

/**
 * 序列化单个内容文档的 `<body>` 内层为 HTML 片段
 *
 * 与 `extractBodiesHtml` 共用：取出 `<body>` 下全部子节点序列化拼接，
 * 可选内联图片；文档缺失 / 无 body / 空 body 返回空串（由调用方决定是否跳过）。
 */
function serializeOneBody(
  files: EpubFiles,
  path: string,
  inline: boolean,
  mediaTypes: ReadonlyMap<string, string>,
): string {
  const bytes = files[path];
  if (bytes === undefined) return '';
  const doc = parseXml(decode(bytes), `内容文档 ${path}`);
  const body = doc.getElementsByTagName('body').item(0);
  if (body === null) return '';
  if (inline) inlineBodyImages(doc, path, files, mediaTypes);
  const serializer = new XMLSerializer();
  let html = '';
  for (let i = 0; i < body.childNodes.length; i += 1) {
    const node = body.childNodes.item(i);
    if (node === null) continue;
    html += serializer.serializeToString(node);
  }
  return html;
}

/** 逐个内容文档取 `<body>` 内层，序列化为 HTML 片段并按 spine 顺序拼接（扁平，无结构包裹） */
export function extractBodiesHtml(
  files: EpubFiles,
  contentPaths: readonly string[],
  options: ExtractBodiesOptions = {},
): string {
  const inline = options.inlineImages ?? false;
  const mediaTypes = options.mediaTypes ?? new Map<string, string>();
  const parts: string[] = [];
  for (const path of contentPaths) {
    const html = serializeOneBody(files, path, inline, mediaTypes);
    if (html.trim() !== '') {
      parts.push(html);
    }
  }
  if (parts.length === 0) {
    throw new RangeError('epub 未解析出任何正文内容：文件可能为空或结构不受支持。');
  }
  return parts.join('\n');
}

/**
 * 把单个内容文档内的 `<img src>` 改写为 data URI（内联图片字节）
 *
 * 只处理「相对路径 + 包内存在且未超限」的图：绝对 URL（http[s]:）、
 * 已是 data URI、缺失文件、超限文件一律原样保留（不静默吞掉引用信息）。
 * 路径解析复用 `resolvePath`（相对内容文档所在目录，支持 `../` 与 URL 转义）。
 */
function inlineBodyImages(
  doc: Document,
  contentPath: string,
  files: EpubFiles,
  mediaTypes: ReadonlyMap<string, string>,
): void {
  const baseDir = dirOf(contentPath);
  const images = doc.getElementsByTagName('img');
  for (let i = 0; i < images.length; i += 1) {
    const el = images.item(i);
    if (el === null) continue;
    const src = el.getAttribute('src') ?? '';
    if (src === '' || src.startsWith('data:')) continue;
    /* 外链 / 协议相对地址不内联（属于原书意图，也避免把整本书拖成在线依赖除外） */
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;

    const target = resolvePath(baseDir, src);
    const bytes = files[target];
    if (bytes === undefined || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) continue;

    const type = mediaTypes.get(target) ?? guessMediaType(target);
    el.setAttribute('src', `data:${type};base64,${toBase64(bytes)}`);
  }
}

/** 按路径后缀推断媒体类型（未知后缀退化为通用二进制类型） */
function guessMediaType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return EXT_MEDIA_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Uint8Array → base64（不依赖 Node `Buffer`，浏览器与 Node 同构）
 *
 * `btoa` 只接受「每个字符 < U+0100」的二进制串；直接 `fromCharCode(...bytes)` 摊开会
 * 在大图上爆栈，故按 8K 分片拼接。
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x2000;
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * 依 OPF 的 manifest 解析「zip 路径 → 媒体类型」表（仅收图片类条目）
 *
 * 与 readContentPaths 一样以 OPF 所在目录为基准解析 href，得到 zip 内的实际路径。
 */
export function readMediaTypes(files: EpubFiles, opfPath: string): Map<string, string> {
  const opf = files[opfPath];
  if (opf === undefined) return new Map();

  const doc = parseXml(decode(opf), 'content.opf');
  const opfDir = dirOf(opfPath);
  const mediaTypes = new Map<string, string>();
  const items = doc.getElementsByTagName('item');
  for (let i = 0; i < items.length; i += 1) {
    const href = attrAt(items, i, 'href');
    const type = attrAt(items, i, 'media-type');
    if (href === '' || !type.startsWith('image/')) continue;
    mediaTypes.set(resolvePath(opfDir, href), type);
  }
  return mediaTypes;
}

/**
 * 单个 NCX 目录项（navPoint）
 *
 * depth 为嵌套层级（0 = 卷 / 书，1 = 章 / 序，2 = 部分，3 = 节…）；parentIndex 指向父项在
 * `points` 数组中的下标（根项 -1）；docPath / anchor 由 `content src` 相对 OPF 目录解析得到。
 */
interface NcxPoint {
  /** 目录显示文本（章节标题） */
  title: string;
  /** 指向的内容文档 zip 路径（去锚点） */
  docPath: string;
  /** 指向的页内锚点（无则为 ''） */
  anchor: string;
  /** 嵌套层级（根 = 0） */
  depth: number;
  /** 父项下标（-1 为根） */
  parentIndex: number;
}

/**
 * NCX 目录计划：把原始 navMap 规整为「内容文档路径 → 卷 / 章标题」的查询表
 *
 * 解析 `toc.ncx` 的嵌套 navPoint 后，对外提供 `matchForDoc(path)`：取指向该文档、层级**最深**
 * 的目录项作为章标题（同一文档被多个目录项指向时，最深者最具体），并沿父链上溯到首个
 * `depth=0` 项作为所属「卷 / 书」标题。无匹配（封面 / 自动目录页等辅助文档）返回 undefined。
 */
class NcxPlan {
  constructor(private readonly points: NcxPoint[]) {}

  matchForDoc(docPath: string): { volumeTitle?: string; chapterTitle?: string } | undefined {
    let best: NcxPoint | undefined;
    for (const p of this.points) {
      if (p.docPath !== docPath) continue;
      if (best === undefined || p.depth > best.depth) best = p;
    }
    if (best === undefined) return undefined;
    /* 文档直接挂在卷 / 书根（depth 0）：自身即卷标题，章标题回退到文档内首个标题 */
    if (best.depth === 0) {
      return { volumeTitle: best.title || undefined, chapterTitle: undefined };
    }
    let volumeTitle: string | undefined;
    let cursor = best;
    while (cursor.parentIndex >= 0) {
      cursor = this.points[cursor.parentIndex]!;
      if (cursor.depth === 0) {
        volumeTitle = cursor.title || undefined;
        break;
      }
    }
    return { volumeTitle, chapterTitle: best.title || undefined };
  }
}

/** 定位 toc.ncx：优先 OPF manifest 的 `application/x-dtbncx+xml`，否则回退任意 .ncx */
function findNcxName(files: EpubFiles, opfPath: string): string | undefined {
  const opf = files[opfPath];
  if (opf !== undefined) {
    const doc = parseXml(decode(opf), 'content.opf');
    const items = doc.getElementsByTagName('item');
    for (let i = 0; i < items.length; i += 1) {
      if (attrAt(items, i, 'media-type') === 'application/x-dtbncx+xml') {
        const href = attrAt(items, i, 'href');
        if (href !== '') {
          return resolvePath(dirOf(opfPath), href);
        }
      }
    }
  }
  return Object.keys(files).find((n) => n.toLowerCase().endsWith('.ncx'));
}

/** 解析 toc.ncx 为目录计划（无 ncx 返回 null） */
export function readNcx(files: EpubFiles, opfPath: string): NcxPlan | null {
  const ncxName = findNcxName(files, opfPath);
  if (ncxName === undefined) return null;
  const data = files[ncxName];
  if (data === undefined) return null;
  const doc = parseXml(decode(data), 'toc.ncx');
  const navMap = doc.getElementsByTagName('navMap').item(0);
  if (navMap === null) return null;
  const opfDir = dirOf(opfPath);
  const points: NcxPoint[] = [];
  const walk = (parent: Element, depth: number, parentIndex: number): void => {
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      const child = children.item(i);
      if (child === null || child.nodeType !== 1) continue;
      if (child.nodeName.toLowerCase() !== 'navpoint') continue;
      const el = child as Element;
      const text = el.getElementsByTagName('text').item(0)?.textContent ?? '';
      const src = el.getElementsByTagName('content').item(0)?.getAttribute('src') ?? '';
      const hashIdx = src.indexOf('#');
      const docRaw = hashIdx >= 0 ? src.slice(0, hashIdx) : src;
      const anchor = hashIdx >= 0 ? src.slice(hashIdx + 1) : '';
      const docPath = resolvePath(opfDir, docRaw);
      const idx = points.length;
      points.push({ title: text.trim(), docPath, anchor, depth, parentIndex });
      walk(el, depth + 1, idx);
    }
  };
  walk(navMap as Element, 0, -1);
  return new NcxPlan(points);
}

/** HTML 属性值转义（标题写入 data-title 前） */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 从序列化 body 中截取首个标题文本（无则 undefined） */
function firstHeadingText(html: string): string | undefined {
  const match = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i.exec(html);
  if (match === null) return undefined;
  const text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : undefined;
}

/** 是否接近纯图（封面）：含 svg/image 且几乎无文本 */
function looksLikeCover(html: string): boolean {
  if (!html.includes('<svg') && !html.includes('<image')) return false;
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
  return text < 20;
}

/** 是否为自动生成的内联目录页（Kindle 等转换产物；内容与 NCX 重复，导入时丢弃） */
function isAutoTocBody(html: string): boolean {
  return html.includes('kindle-cn-toc-title') || /class="[^"]*\bbt-toc\b/.test(html);
}

/** 卷 / 书 包裹：把若干章节点序列收进 `div.bt-volume` 并写入标题 */
function volumeOpen(title: string, chapters: readonly string[]): string {
  return `<div class="bt-volume" data-title="${escapeAttr(title)}">\n${chapters.join('\n')}\n</div>`;
}

/**
 * 结构化抽取：把每个 spine 内容文档包成 `div.bt-chapter`（标题取自 NCX 或文档首标题），
 * 再按 NCX 的卷 / 书归属收进 `div.bt-volume`。
 *
 * 与 `extractBodiesHtml` 的差异：产出**带层级的正文 HTML**，使 `htmlToBookDocument` 经
 * schema 的 `div.bt-volume` / `div.bt-chapter` parseDOM 规则回收为「卷 → 章」结构节点，
 * 而非把所有文档摊平到 book 根下（后者会使目录面板退化为数百条平铺标题、且跨文件重复的
 * `calibre_pb_*` id 在分页 / 锚点定位时碰撞）。自动生成的内联目录页（如 Kindle 的
 * `kindle-cn-toc-title`）内容与 NCX 重复，直接丢弃避免目录冗余。
 *
 * 卷归属采用「沿 spine 顺序继承」：某文档在 NCX 无卷归属（NCX 未收录的散页）时归入
 * 上一文档所在的卷，避免同一卷被中途未收录文档截断成多个重复卷节点。
 */
export function extractStructuredBodiesHtml(
  files: EpubFiles,
  contentPaths: readonly string[],
  ncx: NcxPlan,
  opfPath: string,
  options: ExtractBodiesOptions = {},
): string {
  const inline = options.inlineImages ?? false;
  const mediaTypes = options.mediaTypes ?? new Map<string, string>();

  const parts: string[] = [];
  let current: { title: string; chapters: string[] } | null = null;
  let currentVolumeTitle: string | undefined;
  let autoCounter = 0;
  for (const path of contentPaths) {
    const html = serializeOneBody(files, path, inline, mediaTypes);
    if (html.trim() === '') continue;
    /* 自动内联目录页：与 NCX 重复，丢弃（不触发卷继承切换） */
    if (isAutoTocBody(html)) continue;
    const match = ncx.matchForDoc(path);
    let chapterTitle = match?.chapterTitle;
    if (chapterTitle === undefined) {
      /* NCX 未覆盖的辅助文档（封面 / 散页）：用文档内首标题，纯图视为封面 */
      chapterTitle = firstHeadingText(html) ?? (looksLikeCover(html) ? '封面' : `第${++autoCounter}节`);
    }
    const chapterHtml = `<div class="bt-chapter" data-title="${escapeAttr(chapterTitle)}">${html}</div>`;
    /* 卷归属：NCX 给出则用（可能是新卷或既有卷），否则继承上一文档的卷 */
    const volumeTitle = match?.volumeTitle ?? currentVolumeTitle;
    if (volumeTitle !== undefined) {
      if (current === null || current.title !== volumeTitle) {
        if (current !== null) parts.push(volumeOpen(current.title, current.chapters));
        current = { title: volumeTitle, chapters: [] };
      }
      current.chapters.push(chapterHtml);
    } else {
      if (current !== null) {
        parts.push(volumeOpen(current.title, current.chapters));
        current = null;
      }
      parts.push(chapterHtml);
    }
    currentVolumeTitle = volumeTitle;
  }
  if (current !== null) parts.push(volumeOpen(current.title, current.chapters));
  if (parts.length === 0) {
    throw new RangeError('epub 未解析出任何正文内容：文件可能为空或结构不受支持。');
  }
  return parts.join('\n');
}

/**
 * 端到端（DOM 无关部分）：`.epub` 字节 → 合并后的正文 HTML 片段
 *
 * 纯同步、浏览器与 Node 同构，不触碰浏览器 DOM；产物可交给 `htmlToBookDocument` 或自行处理。
 * 含 NCX（绝大多数正规 epub）时走**结构化抽取**（卷 → 章层级）；无 NCX 时回退扁平抽取，
 * 行为与旧版一致，保证「导出 → 导入往返」等无 NCX 夹具不回归。
 */
export interface EpubToHtmlOptions {
  /**
   * 是否内联图片为 data URI（默认 **true**）
   *
   * epub 的图片是包内独立文件：不内联则往返导出时全部成为死链，
   * 故此处默认开启（与 docx 通路的「默认空 src 占位」不同，由来见 ExtractBodiesOptions 注释）。
   */
  inlineImages?: boolean;
}

export function epubToHtml(input: EpubInput, options: EpubToHtmlOptions = {}): string {
  const inlineImages = options.inlineImages ?? true;
  const files = unzipEpub(input);
  const opfPath = findOpfPath(files);
  const contentPaths = readContentPaths(files, opfPath);
  const mediaTypes = inlineImages ? readMediaTypes(files, opfPath) : new Map<string, string>();
  const ncx = readNcx(files, opfPath);
  if (ncx !== null) {
    return extractStructuredBodiesHtml(files, contentPaths, ncx, opfPath, {
      inlineImages,
      mediaTypes,
    });
  }
  return extractBodiesHtml(files, contentPaths, {
    inlineImages,
    mediaTypes,
  });
}
