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

/** 逐个内容文档取 `<body>` 内层，序列化为 HTML 片段并按 spine 顺序拼接 */
export function extractBodiesHtml(
  files: EpubFiles,
  contentPaths: readonly string[],
  options: ExtractBodiesOptions = {},
): string {
  const inline = options.inlineImages ?? false;
  const mediaTypes = options.mediaTypes ?? new Map<string, string>();
  const serializer = new XMLSerializer();
  const parts: string[] = [];
  for (const path of contentPaths) {
    const bytes = files[path];
    if (bytes === undefined) continue; // 容忍缺失引用：跳过而非中断
    const doc = parseXml(decode(bytes), `内容文档 ${path}`);
    const body = doc.getElementsByTagName('body').item(0);
    if (body === null) continue;
    if (inline) inlineBodyImages(doc, path, files, mediaTypes);
    let html = '';
    for (let i = 0; i < body.childNodes.length; i += 1) {
      const node = body.childNodes.item(i);
      if (node === null) continue;
      html += serializer.serializeToString(node);
    }
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
 * 端到端（DOM 无关部分）：`.epub` 字节 → 合并后的正文 HTML 片段
 *
 * 纯同步、浏览器与 Node 同构，不触碰浏览器 DOM；产物可交给 `htmlToBookDocument` 或自行处理。
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
  return extractBodiesHtml(files, contentPaths, {
    inlineImages,
    mediaTypes,
  });
}
