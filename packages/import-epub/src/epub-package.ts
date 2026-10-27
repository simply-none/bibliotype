/**
 * EPUB 包结构读取（副作用层：解 zip + 解析 XML，均**无需浏览器 DOM**，浏览器与 Node 同构）
 *
 * 依赖方向：import-epub → fflate（解包）、@xmldom/xmldom（XML 结构读取）。
 * 本模块只做「字节 → 结构 → 正文 HTML 片段」的编排：解 zip → container.xml 定位 OPF →
 * OPF 的 manifest + spine 解析出内容文档集合 → 交给目录源（toc-read）与结构重建
 * （structured-html）产出带层级的正文。
 *
 * 职责已按原子化拆分：XML 基础读写（xml）、媒体内联（media）、路径与顺序（toc-path）、
 * 目录解析（toc-nav / toc-ncx / toc-read）、正文切分（body-split）、结构渲染（structured-html）。
 * 本文件只保留「解包 / OPF / 正文序列化 / 对外编排」。
 */
import { unzipSync } from 'fflate';
import { XMLSerializer } from '@xmldom/xmldom';
import { attrAt, decode, parseXml } from './xml.js';
import { inlineBodyImages, readMediaTypes } from './media.js';
import { dirOf, lookupEntry, resolveHref } from './toc-path.js';
import { readToc } from './toc-read.js';
import { buildStructuredHtml } from './structured-html.js';
import type { EpubFiles, EpubImportReport } from './toc-types.js';

export type { EpubFiles };
export { readMediaTypes };

/** epub 原始字节：浏览器 `File.arrayBuffer()` / Node `fs` 读得的 `Uint8Array` 统一入口 */
export type EpubInput = ArrayBuffer | Uint8Array;

/** 正文抽取选项 */
export interface ExtractBodiesOptions {
  /**
   * 是否把图片内联为 data URI（默认 false）
   *
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

/**
 * 依 OPF 的 manifest + spine 解析出内容文档的 zip 路径（按 spine 顺序）
 *
 * 这里只回答「哪些文件算正文」；阅读顺序由 `readToc` + `orderContentPaths` 校正
 * （部分 epub 的 spine 顺序是文件名字母序，真实顺序写在目录里）。
 */
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
    if (href === undefined) continue;
    const resolved = resolveHref(opfDir, href);
    const actual = lookupEntry(files, resolved) ?? resolved;
    if (!paths.includes(actual)) paths.push(actual);
  }
  if (paths.length === 0) {
    throw new RangeError('epub 的 spine 未解析出任何内容文档：无法导入正文。');
  }
  return paths;
}

/**
 * 序列化单个内容文档的 `<body>` 内层为 HTML 片段
 *
 * 文档缺失 / 无 body / 空 body 返回空串（由调用方决定是否跳过）。
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
  return serializeBodyChildren(body as Element);
}

/** 按文档序序列化 `<body>` 的全部子节点 */
function serializeBodyChildren(body: Element): string {
  let html = '';
  const serializer = new XMLSerializer();
  for (let i = 0; i < body.childNodes.length; i += 1) {
    const node = body.childNodes.item(i);
    if (node === null) continue;
    html += serializer.serializeToString(node);
  }
  return html;
}

/**
 * 逐个内容文档取 `<body>` 内层，序列化为 HTML 片段并按给定顺序拼接（扁平，无结构包裹）
 *
 * 无目录（nav / ncx 都没有）时的回退路径：正文保持平铺，目录由标题重建。
 */
export function extractBodiesHtml(
  files: EpubFiles,
  contentPaths: readonly string[],
  options: ExtractBodiesOptions = {},
): string {
  const inline = options.inlineImages ?? false;
  const mediaTypes = options.mediaTypes ?? new Map<string, string>();
  const parts: string[] = [];
  for (const path of contentPaths) {
    const actual = lookupEntry(files, path) ?? path;
    const html = serializeOneBody(files, actual, inline, mediaTypes);
    if (html.trim() !== '') {
      parts.push(html);
    }
  }
  if (parts.length === 0) {
    throw new RangeError('epub 未解析出任何正文内容：文件可能为空或结构不受支持。');
  }
  return parts.join('\n');
}

/** 端到端（DOM 无关部分）的选项 */
export interface EpubToHtmlOptions {
  /**
   * 是否内联图片为 data URI（默认 **true**）
   *
   * epub 的图片是包内独立文件，不内联则往返导出后全部成为死链。
   */
  inlineImages?: boolean;
  /**
   * 导入诊断回调（默认不收集）
   *
   * 透出目录来源、条目数与被丢弃的引用（缺失文件 / 未定位锚点），
   * 便于调用方提示「这本书的目录没能完全对上」，而不是静默降级。
   */
  onReport?: (report: EpubImportReport) => void;
}

/**
 * 端到端（DOM 无关部分）：`.epub` 字节 → 合并后的正文 HTML 片段
 *
 * 纯同步、浏览器与 Node 同构，不触碰浏览器 DOM；产物可交给 `htmlToBookDocument` 或自行处理。
 *
 * 有目录（nav.xhtml / toc.ncx）时走**结构化重建**：目录树的层级 → `bt-volume` /
 * `bt-chapter` / `bt-section` 嵌套容器，一个文件内的多章按锚点切开，正文顺序以目录为准；
 * 无目录时回退扁平抽取，行为与旧版一致。
 */
export function epubToHtml(input: EpubInput, options: EpubToHtmlOptions = {}): string {
  const inlineImages = options.inlineImages ?? true;
  const files = unzipEpub(input);
  const opfPath = findOpfPath(files);
  const contentPaths = readContentPaths(files, opfPath);
  const mediaTypes = inlineImages ? readMediaTypes(files, opfPath) : new Map<string, string>();
  const toc = readToc(files, opfPath);

  if (toc.source !== 'none') {
    return buildStructuredHtml(files, contentPaths, toc, {
      inlineImages,
      mediaTypes,
      ...(options.onReport === undefined ? {} : { onReport: options.onReport }),
    });
  }

  const html = extractBodiesHtml(files, contentPaths, { inlineImages, mediaTypes });
  options.onReport?.({
    tocSource: 'none',
    tocEntries: 0,
    missingFiles: [],
    unlocatedAnchors: [],
  });
  return html;
}
