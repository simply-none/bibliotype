/**
 * 图片内联与媒体类型表（import-epub 的媒体副作用层）
 *
 * epub 的图片是包内独立文件：导入不把字节带出来，导出后 `<img>` 全是死链。
 * 本模块负责「包内相对引用 → data URI」的改写与「路径 → 媒体类型」查表，
 * 与正文抽取、目录重建解耦，互不依赖。
 */
import { attrAt, decode, parseXml } from './xml.js';
import { dirOf, lookupEntry, resolveHref } from './toc-path.js';
import type { EpubFiles } from './toc-types.js';

/**
 * 单张图片的内联上限（字节）
 *
 * 内联以 base64 写进 IR，体积放大约 4/3；超限图退化处理（保留原相对 `src`），
 * 避免扫描图 / 高清插画把整份文档撑爆。
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

/** 按路径后缀推断媒体类型（未知后缀退化为通用二进制类型） */
export function guessMediaType(path: string): string {
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
 * 把单个内容文档内的 `<img src>` 改写为 data URI（内联图片字节）
 *
 * 只处理「相对路径 + 包内存在且未超限」的图：绝对 URL（http[s]:）、
 * 已是 data URI、缺失文件、超限文件一律原样保留（不静默吞掉引用信息）。
 *
 * @param doc 已解析的内容文档
 * @param contentPath 内容文档的 zip 路径（相对 href 的解析基准）
 * @param files 解包后的条目表
 * @param mediaTypes 路径 → 媒体类型表（缺省按扩展名推断）
 */
export function inlineBodyImages(
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
    /* 外链 / 协议相对地址不内联（属原书意图，也避免把整本书变成在线依赖） */
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;

    const target = lookupEntry(files, resolveHref(baseDir, src));
    if (target === undefined) continue;
    const bytes = files[target];
    if (bytes === undefined || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) continue;

    const type = mediaTypes.get(target) ?? guessMediaType(target);
    el.setAttribute('src', `data:${type};base64,${toBase64(bytes)}`);
  }
}

/**
 * 依 OPF 的 manifest 解析「zip 路径 → 媒体类型」表（仅收图片类条目）
 *
 * 以 OPF 所在目录为基准解析 href，得到 zip 内的实际路径（与正文文档查表口径一致）。
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
    const target = lookupEntry(files, resolveHref(opfDir, href));
    if (target !== undefined) mediaTypes.set(target, type);
  }
  return mediaTypes;
}
