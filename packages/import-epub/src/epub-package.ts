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

/** 解包后的「zip 路径 → 字节」表 */
type EpubFiles = Record<string, Uint8Array>;

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
export function extractBodiesHtml(files: EpubFiles, contentPaths: readonly string[]): string {
  const serializer = new XMLSerializer();
  const parts: string[] = [];
  for (const path of contentPaths) {
    const bytes = files[path];
    if (bytes === undefined) continue; // 容忍缺失引用：跳过而非中断
    const doc = parseXml(decode(bytes), `内容文档 ${path}`);
    const body = doc.getElementsByTagName('body').item(0);
    if (body === null) continue;
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
 * 端到端（DOM 无关部分）：`.epub` 字节 → 合并后的正文 HTML 片段
 *
 * 纯同步、浏览器与 Node 同构，不触碰浏览器 DOM；产物可交给 `htmlToBookDocument` 或自行处理。
 */
export function epubToHtml(input: EpubInput): string {
  const files = unzipEpub(input);
  const opfPath = findOpfPath(files);
  const contentPaths = readContentPaths(files, opfPath);
  return extractBodiesHtml(files, contentPaths);
}
