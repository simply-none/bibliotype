/**
 * 字体格式常量与文件名（E3）
 *
 * 格式 → MIME / CSS format() 关键字 / 扩展名；文件名按「族名 + 字重 + 内容哈希」
 * 生成，同一输入逐字节确定，便于缓存与测试断言。
 */
import { hashAssetBytes } from '@bibliotype/core';
import type { FontAssetInput, FontFormat, PreparedFontFace } from './types.js';

/** 格式 → MIME 类型（EPUB manifest / 站点文件） */
const MEDIA_TYPES: Readonly<Record<FontFormat, string>> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** 格式 → CSS `format()` 关键字 */
const FORMAT_KEYWORDS: Readonly<Record<FontFormat, string>> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

/** 格式 → 扩展名 */
const EXTENSIONS: Readonly<Record<FontFormat, string>> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'ttf',
  otf: 'otf',
};

/** 字体 MIME 类型 */
export function fontMediaType(format: FontFormat): string {
  return MEDIA_TYPES[format];
}

/** CSS `format()` 关键字 */
export function fontFormatKeyword(format: FontFormat): string {
  return FORMAT_KEYWORDS[format];
}

/** 字体文件扩展名（不含点） */
export function fontFileExtension(format: FontFormat): string {
  return EXTENSIONS[format];
}

/**
 * 按魔术字节嗅探字体格式
 *
 * - `wOF2` → woff2；`wOFF` → woff；`OTTO` → otf；
 * - `\0\1\0\0` / `true` / `typ1` → ttf。
 *
 * 无法识别返回 undefined（调用方回退 ttf）。
 */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | undefined {
  if (bytes.length >= 4) {
    const tag = String.fromCharCode(bytes[0] as number, bytes[1] as number, bytes[2] as number, bytes[3] as number);
    if (tag === 'wOF2') return 'woff2';
    if (tag === 'wOFF') return 'woff';
    if (tag === 'OTTO') return 'otf';
    if (tag === 'true' || tag === 'typ1') return 'ttf';
    if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return 'ttf';
  }
  return undefined;
}

/** 族名 → 文件名安全段（小写、非字母数字转 `-`、压缩连字符、限长） */
export function sanitizeFontSlug(family: string, maxLength = 24): string {
  const slug = family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(1, maxLength))
    .replace(/-+$/g, '');
  return slug === '' ? 'font' : slug;
}

/** 字重 → 文件名段（区间串压成 `var`） */
function weightSegment(weight: number | string): string {
  const text = String(weight).trim();
  if (/^[1-9]00$/.test(text)) return text;
  return 'var';
}

/**
 * 生成字体文件名：`bt-<族名>-<字重><i>-<哈希>.<扩展名>`
 *
 * 哈希取子集字节内容（FNV-1a 32 位），保证内容变化即换名、缓存不串。
 */
export function buildFontFileName(
  face: Pick<PreparedFontFace, 'family' | 'weight' | 'style' | 'format' | 'bytes'>,
  options: { prefix?: string; slugLength?: number } = {},
): string {
  const prefix = options.prefix ?? 'bt-';
  const slug = sanitizeFontSlug(face.family, options.slugLength ?? 24);
  const italic = face.style === 'normal' ? '' : 'i';
  const hash = hashAssetBytes(face.bytes);
  return `${prefix}${slug}-${weightSegment(face.weight)}${italic}-${hash}.${fontFileExtension(face.format)}`;
}

/** 组装字体面的通用字段（文件名 / href / MIME） */
export function createPreparedFace(
  input: FontAssetInput,
  bytes: Uint8Array,
  format: FontFormat,
  options: { fontDirectory?: string; fileNamePrefix?: string; slugLength?: number } = {},
): PreparedFontFace {
  const face: PreparedFontFace = {
    id: input.id,
    family: input.family,
    weight: input.weight ?? 400,
    style: input.style ?? 'normal',
    format,
    mediaType: fontMediaType(format),
    fileName: '',
    href: '',
    bytes,
  };
  face.fileName = buildFontFileName(face, {
    prefix: options.fileNamePrefix,
    slugLength: options.slugLength,
  });
  face.href = `${normalizeFontDirectory(options.fontDirectory)}${face.fileName}`;
  if (input.license !== undefined) face.license = input.license;
  return face;
}

/** 字体目录规范化（补尾斜杠；空串表示 CSS 同级） */
export function normalizeFontDirectory(directory: string | undefined): string {
  const value = (directory ?? 'fonts/').trim();
  if (value === '') return '';
  return value.endsWith('/') ? value : `${value}/`;
}
