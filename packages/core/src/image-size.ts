/**
 * 内嵌图片尺寸嗅探（data URI → 宽高）
 *
 * 用途：字图识别（`normalizeGlyphImages`）在节点**无尺寸元数据**时，从
 * data URI 头部直接读出真实宽高——句首 / 句尾的字图没有「切断句子」位置
 * 信号，尺寸是唯一硬证据。只解 data URI 前缀（PNG/GIF 头部定长；SVG 根
 * 元素的 width/height 必在开头），不解整图，大图零成本。
 *
 * 支持格式与口径：PNG（IHDR 大端）、GIF（逻辑屏幕小端）、SVG（base64 后
 * 根元素 width/height 属性）。**不支持 JPEG / WebP**：JPEG 需扫描 SOF 段、
 * WebP 头在 VP8 载荷内，且两者是照片插图的主流形态（字图罕见）——嗅探
 * 失败返回 `undefined`，调用方回退原有保守判定，绝不误判。
 *
 * 纯函数、零依赖、Node 与浏览器同构（`atob` 为两端全局）。
 */

/** SVG 根元素属性嗅探的 base64 前缀长度（根元素开标签必在其内） */
const MAX_BASE64_CHARS = 1024;

/** base64 前缀 → 字节数组（非法字符 / atob 不可用返回空） */
function decodePrefix(dataUri: string, bytes: number): Uint8Array {
  if (typeof atob !== 'function') return new Uint8Array(0);
  try {
    const decoded = atob(dataUri.slice(0, Math.ceil(bytes / 3) * 4));
    const out = new Uint8Array(Math.min(bytes, decoded.length));
    for (let i = 0; i < out.length; i += 1) out[i] = decoded.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/** 大端 32 位无符号读 */
function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/** 小端 16 位无符号读 */
function u16le(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)) >>> 0;
}

/** PNG 签名（8 字节） */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** base64 前缀 → 可打印文本（SVG 根元素属性用；非 ASCII 字节容错为空格） */
function decodeText(dataUri: string): string {
  if (typeof atob !== 'function') return '';
  try {
    return atob(dataUri.slice(0, MAX_BASE64_CHARS)).replace(/[^\x20-\x7e]/g, ' ');
  } catch {
    return '';
  }
}

/** SVG 根元素 width/height 属性 → px 数值（百分百 / auto / 缺省 → undefined） */
function svgSizeOf(text: string): { width: number; height: number } | undefined {
  const root = /<svg\b[^>]*>/i.exec(text);
  if (root === null) return undefined;
  const attr = (name: string): number | undefined => {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)\\s*(?:px)?["']`, 'i').exec(root[0]!);
    if (match === null) return undefined;
    const value = Number.parseFloat(match[1]!);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const width = attr('width');
  const height = attr('height');
  return width !== undefined && height !== undefined ? { width, height } : undefined;
}

/**
 * 嗅探 data URI 图片的宽高
 *
 * @param src `data:image/...;base64,...` 形式的图片地址
 * @returns 宽高；非 base64 data URI、格式不支持或头部不完整时 `undefined`
 */
export function sniffEmbeddedImageSize(
  src: string,
): { width: number; height: number } | undefined {
  const match = /^data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]+)/i.exec(src);
  if (match === null) return undefined;
  const mime = (match[1] ?? '').toLowerCase();
  const payload = match[2] ?? '';

  if (mime === 'png') {
    /* 8 签名 + 4 长度 + 4 'IHDR'，宽高各 4 字节大端（偏移 16 / 20） */
    const bytes = decodePrefix(payload, 24);
    if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return undefined;
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (mime === 'gif') {
    /* 'GIF8' + 版本 2 字节，逻辑屏幕宽高各 2 字节小端（偏移 6 / 8） */
    const bytes = decodePrefix(payload, 10);
    if (
      bytes.length < 10 ||
      bytes[0] !== 0x47 ||
      bytes[1] !== 0x49 ||
      bytes[2] !== 0x46 ||
      bytes[3] !== 0x38
    ) {
      return undefined;
    }
    const width = u16le(bytes, 6);
    const height = u16le(bytes, 8);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (mime === 'svg+xml') {
    return svgSizeOf(decodeText(payload));
  }
  return undefined;
}
