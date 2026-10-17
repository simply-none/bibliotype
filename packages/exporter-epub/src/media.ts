/**
 * EPUB 导出媒体收集器（data URI → 包内独立文件）
 *
 * 背景（京东读书 / 微信读书兼容）：
 * - 导入侧 `inlineImages` 默认把包内图片内联为 data URI 写进 IR，导出侧若原样透传，
 *   单内容文档会被 base64（≈×1.37）撑爆，且 Adobe RMSDK 对 `data:` URI 支持不可靠；
 * - 主流工具（InDesign / Sigil / Calibre）一律「媒体独立文件 + manifest 登记 +
 *   相对路径引用」，本收集器把 IR 里的图片归一到该形态。
 *
 * 处理规则：
 * - `data:` URI：解码 base64 → 登记为 `OEBPS/media/img-<hash>.<ext>`，src 改写为
 *   相对内容文档的路径（内容文档在 `OEBPS/text/` 下，故为 `../media/...`）；
 * - `http(s):` / `//` 外链：原样保留（零后端同构原则，导出不下载），记 WARNING；
 * - `blob:` / `file:` 等会话本地地址：原样保留，记 WARNING（导出时已失效）；
 * - 其余相对路径：原样保留，记 WARNING（包内不存在即死链，由校验器报 ERROR）；
 * - 同一 src 只登记一份（按内容散列去重），manifest 不重复。
 */
import { escapeXml } from '@bibliotype/layout/html';

/** 单图大小上限（与导入侧 MAX_INLINE_IMAGE_BYTES 对齐，2 MiB） */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

/** 媒体条目（进入 OPF manifest） */
export interface MediaItem {
  /** manifest item id（如 'media-1'） */
  id: string;
  /** OEBPS 内相对路径（如 'media/img-1.jpeg'） */
  href: string;
  /** 媒体类型（如 'image/jpeg'） */
  mediaType: string;
  /** 文件字节 */
  bytes: Uint8Array;
}

/** 媒体收集告警（非致命，导出继续） */
export interface MediaProblem {
  /** 严重级别：外链/blob 为 warning，超限为 warning */
  severity: 'warning';
  /** 机器可读码 */
  code: 'external-src' | 'volatile-src' | 'relative-src' | 'oversize-src';
  /** 原始 src（截断展示） */
  src: string;
  /** 说明 */
  message: string;
}

/** data URI 解析结果 */
export interface ParsedDataUri {
  mediaType: string;
  bytes: Uint8Array;
}

/** data URI 头（mediatype 可缺省；仅支持 base64，与导入侧写入形态一致） */
const DATA_URI_RE = /^data:([^;,]*)?(?:;base64)?,(.*)$/s;

/** 常见图片扩展名 → 媒体类型（导入侧 EXT_MEDIA_TYPES 的口径镜像） */
const EXT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
};

/**
 * data URI → 字节 + 媒体类型
 *
 * 非 data URI / 非 base64 / 超限返回 undefined（调用方按原样透传）。
 * base64 解码不依赖 Node `Buffer`：浏览器与 Node 同构（atob 为两端全局）。
 */
export function parseDataImageUri(src: string): ParsedDataUri | undefined {
  const match = DATA_URI_RE.exec(src);
  if (match === null) return undefined;
  const raw = match[2] ?? '';
  if (raw === '') return undefined;
  /* 仅处理 base64 形态（导入侧只写 base64；百分号编码形态不猜） */
  if (!src.includes(';base64,')) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(raw);
  } catch {
    return undefined;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) return undefined;
  const declared = (match[1] ?? '').trim();
  const mediaType = declared !== '' ? declared : 'application/octet-stream';
  return { mediaType, bytes };
}

/** base64 → 字节（8K 分片，避免 `fromCharCode(...bytes)` 大图爆栈） */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const CHUNK = 0x2000;
  const bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, binary.length);
    for (let i = offset; i < end; i += 1) bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** FNV-1a 32 位（对字节内容散列；与 identifier.ts 的字符串版同族，独立实现避免循环依赖） */
function fnv1aBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 路径 → 扩展名（小写，无点；无扩展名返回空串） */
function extOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

/**
 * 媒体收集器
 *
 * 用法：序列化前构造，经 `SerializeNodeOptions.rewriteSrc` 接入；
 * 序列化结束后读 `items`（manifest）与 `problems`（告警）。
 */
export class MediaCollector {
  private readonly items: MediaItem[] = [];
  private readonly bySrc = new Map<string, MediaItem>();
  private readonly byContentHash = new Map<string, MediaItem>();
  private readonly problems: MediaProblem[] = [];
  private counter = 0;

  /** 已登记媒体（按登记序；manifest 用） */
  get mediaItems(): readonly MediaItem[] {
    return this.items;
  }

  /** 收集过程告警（外链 / 易失地址 / 相对路径 / 超限） */
  get mediaProblems(): readonly MediaProblem[] {
    return this.problems;
  }

  /** 已收集媒体总字节（体积预算用） */
  get totalBytes(): number {
    return this.items.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  }

  /**
   * 处理一个 img src，返回应写入 XHTML 的值
   *
   * data URI → 包内相对路径（`../media/img-<hash>.<ext>`）；
   * 其余 → 原样返回并记告警。同一 src 重复调用返回同一改写值（去重）。
   */
  rewrite(src: string): string {
    const item = this.register(src);
    return item !== undefined ? `../${item.href}` : src;
  }

  /**
   * 登记一个 src 并返回媒体条目（供封面等需要先拿 manifest id 的场景）
   *
   * 返回 undefined 表示「未打包」：外链 / 易失地址 / 相对路径 / 超限，
   * 调用方应原样透传 src（告警已记入 mediaProblems）。
   */
  register(src: string): MediaItem | undefined {
    if (src === '') return undefined;

    const existing = this.bySrc.get(src);
    if (existing !== undefined) return existing;

    /* 外链：零后端同构，不下载 */
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('data:')) {
      if (/^(?:https?|ftp):/i.test(src) || src.startsWith('//')) {
        this.warn('external-src', src, '外链图片：阅读端需联网，平台审核可能要求包内资源');
        return undefined;
      }
      this.warn('volatile-src', src, '会话本地地址（blob:/file:）：导出后在阅读端必然失效');
      return undefined;
    }

    /* data URI：解码入库 */
    const parsed = parseDataImageUri(src);
    if (parsed === undefined) {
      if (src.startsWith('data:')) {
        this.warn('oversize-src', src, `data URI 图片超过 ${MAX_MEDIA_BYTES} 字节上限或非 base64，未打包`);
        return undefined;
      }
      this.warn('relative-src', src, '相对路径图片：导出包内不存在该文件，阅读端为死链');
      return undefined;
    }

    this.counter += 1;
    const ext = extOf(src) || guessExt(parsed.mediaType);
    /* 嗅探优先：data URI 声明的类型可能缺失 / 错误，manifest 与字节不一致时严格阅读器拒载 */
    const sniffed = sniffImageMediaType(parsed.bytes);
    const mediaType = sniffed ?? normalizeMediaType(parsed.mediaType, ext);
    const hash = fnv1aBytes(parsed.bytes);
    /* 内容散列去重：同一字节内容的不同 src 只登记一份 */
    const byHash = this.byContentHash.get(hash);
    if (byHash !== undefined) {
      this.bySrc.set(src, byHash);
      return byHash;
    }
    const item: MediaItem = {
      id: `media-${this.counter}`,
      href: `media/img-${hash}${ext === '' ? '' : `.${ext}`}`,
      mediaType,
      bytes: parsed.bytes,
    };
    this.items.push(item);
    this.bySrc.set(src, item);
    this.byContentHash.set(hash, item);
    return item;
  }

  private warn(code: MediaProblem['code'], src: string, message: string): void {
    this.problems.push({
      severity: 'warning',
      code,
      src: src.length > 80 ? `${src.slice(0, 77)}...` : src,
      message,
    });
  }
}

/** 媒体类型规范化：缺扩展名线索时按嗅探结果回退（PNG/JPEG/GIF 魔术字节） */
function normalizeMediaType(declared: string, ext: string): string {
  if (declared.startsWith('image/')) return declared;
  const byExt = EXT_MEDIA_TYPES[ext];
  return byExt ?? declared;
}

/** 扩展名推断（data URI 无文件名时；仅覆盖常见格式） */
function guessExt(mediaType: string): string {
  for (const [ext, type] of Object.entries(EXT_MEDIA_TYPES)) {
    if (type === mediaType) return ext;
  }
  return '';
}

/**
 * 按魔术字节嗅探图片真实类型（data URI 的声明可能缺失或错误）
 *
 * 导出以嗅探为准更稳：manifest 的 media-type 与字节不一致时严格阅读器会拒载。
 */
export function sniffImageMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/** manifest item 行（OPF 生成用；保持与 opf.ts 的输出格式一致） */
export function mediaManifestItem(item: MediaItem, cover: boolean): string {
  const properties = cover ? ' properties="cover-image"' : '';
  return (
    `<item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}"` +
    ` media-type="${escapeXml(item.mediaType)}"${properties}/>`
  );
}
