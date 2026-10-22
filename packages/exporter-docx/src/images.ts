/**
 * 图片解码、尺寸计算与 ImageRun 构建
 *
 * Word 只认 PNG / JPEG / GIF / BMP 四种常规位图（docx 包不写 SVG、WebP），
 * 而 IR 里的图片既可能是 data URI，也可能是外链 / 相对路径。本模块负责：
 * - 只接受 data URI（随文件携带），其余情况按问题码回传；
 * - 从文件头嗅探真实格式与像素尺寸（不信 MIME，防止扩展名骗人）；
 * - 按版心宽度等比缩放（Word 的 `transformation` 单位是 96dpi 像素）。
 */
import { ImageRun } from 'docx';
import type { BookNode } from '@bibliotype/core';
import type { ExportContext } from './context.js';

/** Word 支持的位图格式 */
export type SupportedImageType = 'jpg' | 'png' | 'gif' | 'bmp';

/** 解码后的图片 */
export interface DecodedImage {
  /** 实际格式（按文件头嗅探） */
  type: SupportedImageType;
  /** 原始字节 */
  bytes: Uint8Array;
  /** 像素宽（嗅探得到时） */
  width?: number;
  /** 像素高（嗅探得到时） */
  height?: number;
}

/** 图片解码失败码 */
export type ImageProblemCode = 'external-src' | 'relative-src' | 'unsupported-image' | 'oversize-src';

/** 解码结果 */
export type ImageDecodeResult =
  | { ok: true; image: DecodedImage }
  | { ok: false; code: ImageProblemCode; message: string };

/** data URI 前缀（`data:<mime>[;base64],<payload>`） */
const DATA_URI_RE = /^data:([^,]*),([\s\S]*)$/;

/**
 * 解码图片 src
 *
 * @param src IR `image.attrs.src`
 * @param maxBytes 字节上限
 */
export function decodeImageSrc(src: string, maxBytes: number): ImageDecodeResult {
  const value = src.trim();
  if (value === '') return fail('unsupported-image', '图片缺少 src');

  if (/^https?:\/\//i.test(value)) {
    return fail('external-src', '图片为外部链接，未嵌入 docx');
  }
  if (/^(blob|filesystem):/i.test(value)) {
    return fail('external-src', '图片为运行时对象地址，导出时无法读取');
  }
  if (!value.startsWith('data:')) {
    return fail('relative-src', '图片为相对 / 本地路径，未嵌入 docx');
  }

  const match = DATA_URI_RE.exec(value);
  if (match === null) return fail('unsupported-image', 'data URI 格式非法');
  const meta = match[1] ?? '';
  const payload = match[2] ?? '';
  if (!/;\s*base64\s*$/i.test(meta) && !/;\s*base64;/i.test(`${meta};`)) {
    return fail('unsupported-image', '仅支持 base64 编码的 data URI');
  }

  const bytes = base64ToBytes(payload);
  if (bytes === undefined) return fail('unsupported-image', 'data URI 的 base64 内容无法解码');
  if (bytes.length > maxBytes) {
    const mib = (bytes.length / 1024 / 1024).toFixed(1);
    return fail('oversize-src', `图片体积 ${mib} MiB 超过上限，未嵌入 docx`);
  }

  const sniffed = sniffImage(bytes);
  if (sniffed === undefined) {
    return fail('unsupported-image', '仅支持 PNG / JPEG / GIF / BMP 位图（SVG、WebP 等未嵌入）');
  }
  return { ok: true, image: sniffed };
}

/** 构造失败结果 */
function fail(code: ImageProblemCode, message: string): ImageDecodeResult {
  return { ok: false, code, message };
}

/** base64 → 字节（分片解码，避免 `String.fromCharCode` 参数过多） */
function base64ToBytes(payload: string): Uint8Array | undefined {
  try {
    const binary = atob(payload.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/** 按文件头嗅探格式与尺寸 */
export function sniffImage(bytes: Uint8Array): DecodedImage | undefined {
  const type = sniffImageType(bytes);
  if (type === undefined) return undefined;
  const size = imagePixelSize(bytes, type);
  return size === undefined ? { type, bytes } : { type, bytes, width: size.width, height: size.height };
}

/** 按魔术字节判断格式 */
export function sniffImageType(bytes: Uint8Array): SupportedImageType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'gif';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp';
  }
  return undefined;
}

/** 像素尺寸嗅探（GIF / BMP / PNG 读头，JPEG 找 SOF 段） */
function imagePixelSize(
  bytes: Uint8Array,
  type: SupportedImageType,
): { width: number; height: number } | undefined {
  switch (type) {
    case 'png': {
      if (bytes.length < 24) return undefined;
      const width = readU32be(bytes, 16);
      const height = readU32be(bytes, 20);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    case 'gif': {
      if (bytes.length < 10) return undefined;
      const width = bytes[6]! + (bytes[7]! << 8);
      const height = bytes[8]! + (bytes[9]! << 8);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    case 'bmp': {
      if (bytes.length < 26) return undefined;
      const width = Math.abs(readI32le(bytes, 18));
      const height = Math.abs(readI32le(bytes, 22));
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    case 'jpg':
      return jpegPixelSize(bytes);
    default:
      return undefined;
  }
}

/** JPEG：跳过段头找 SOF0/1/2 取尺寸 */
function jpegPixelSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    /* 无长度的独立标记（SOI/EOI/RSTn/TEM） */
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    /* 填充字节 0xFF 自身 */
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
    if (length < 2) return undefined;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[offset + 5]! << 8) + bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) + bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += 2 + length;
  }
  return undefined;
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readI32le(bytes: Uint8Array, offset: number): number {
  const value =
    bytes[offset]! +
    (bytes[offset + 1]! << 8) +
    (bytes[offset + 2]! << 16) +
    bytes[offset + 3]! * 0x1000000;
  return value >= 0x80000000 ? value - 0x100000000 : value;
}

/** 显示尺寸（像素，96dpi） */
export interface ImageDisplaySize {
  width: number;
  height: number;
}

/** 96dpi 下毫米 → 像素 */
function mmToPx(mm: number): number {
  return Math.round((mm * 96) / 25.4);
}

/**
 * 按版心宽度等比缩放
 *
 * 无尺寸信息时按 120×90mm 的占位比例输出，保证图不撑破版心；
 * 缩小时只缩不放（小图保持原始像素，避免发虚）。
 */
export function displaySize(image: DecodedImage, maxWidthMm: number, maxHeightMm = 180): ImageDisplaySize {
  const naturalWidth = image.width ?? 0;
  const naturalHeight = image.height ?? 0;
  let widthMm = naturalWidth > 0 ? (naturalWidth * 25.4) / 96 : 120;
  let heightMm = naturalHeight > 0 ? (naturalHeight * 25.4) / 96 : 90;
  if (naturalWidth <= 0 || naturalHeight <= 0) heightMm = widthMm * 0.75;

  const scale = Math.min(1, maxWidthMm / widthMm, maxHeightMm / heightMm);
  return {
    width: Math.max(1, Math.round(widthMm * scale * (96 / 25.4))),
    height: Math.max(1, Math.round(heightMm * scale * (96 / 25.4))),
  };
}

/**
 * 图片节点 → ImageRun
 *
 * 解码失败时记录问题并返回 `undefined`，由调用方决定替代呈现
 * （块级：居中输出替代文字；行内：输出斜体替代文字）。
 */
export function buildImageRun(node: BookNode, ctx: ExportContext): ImageRun | undefined {
  const src = typeof node.attrs?.['src'] === 'string' ? node.attrs.src : '';
  const alt = typeof node.attrs?.['alt'] === 'string' ? node.attrs.alt : '';
  const result = decodeImageSrc(src, ctx.options.maxImageBytes);
  if (!result.ok) {
    ctx.reportOnce(`${result.code}:${src.slice(0, 48)}`, result.code, result.message, node.id);
    return undefined;
  }

  const size = displaySize(result.image, ctx.options.imageMaxWidthMm);
  return new ImageRun({
    type: result.image.type,
    data: result.image.bytes,
    transformation: size,
    altText: { name: alt === '' ? '插图' : alt, description: alt },
  });
}

/** 图片替代文字（解码失败时的降级文案） */
export function imageAltText(node: BookNode): string {
  const alt = node.attrs?.['alt'];
  return typeof alt === 'string' && alt.trim() !== '' ? alt : '[图片]';
}
