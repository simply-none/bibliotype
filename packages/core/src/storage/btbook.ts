/**
 * `.btbook` 单文件书档：文件规划、清单校验与解包
 *
 * 定位：一本书的「可搬运」形态——manifest + IR + 资产 + 注记。
 * 压缩由宿主注入（`BookPackCodec`），core 不引入任何压缩库：
 * 浏览器 / Electron 宿主可用 `fflate`，Node 宿主可用 `zlib`，测试可用空实现。
 *
 * 包内路径约定（全部为 ASCII，避免 ZIP 编码差异）：
 * ```text
 * manifest.json     清单（格式版本、书目摘要、资产 id 列表）
 * document.json    IR 文档
 * annotations.json 注记集合（可选）
 * assets/<id>      资产二进制（可选，id 做百分号编码）
 * ```
 */
import type { BookDocument } from '../ir/document.js';
import { isBookDocument } from '../ir/document.js';
import type { AssetPayload } from './asset.js';
import { buildDocumentSummary, isDocumentSummary } from './library.js';
import type { DocumentSummary } from './types.js';

/** 书档格式标识 */
export const BTBOOK_FORMAT = 'btbook';
/** 书档格式版本（结构不兼容变更时递增） */
export const BTBOOK_FORMAT_VERSION = '1';
/** 包内固定文件名 */
export const BTBOOK_FILES = {
  MANIFEST: 'manifest.json',
  DOCUMENT: 'document.json',
  ANNOTATIONS: 'annotations.json',
  /** 资产目录前缀 */
  ASSETS_PREFIX: 'assets/',
} as const;

/** 书档错误码 */
export const BOOK_PACK_ERROR_CODES = {
  /** manifest 缺失或不是合法 JSON */
  INVALID_MANIFEST: 'INVALID_MANIFEST',
  /** 格式标识不是 btbook */
  INVALID_FORMAT: 'INVALID_FORMAT',
  /** 格式版本不受支持 */
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  /** 缺少 / 非法 IR 文档 */
  INVALID_DOCUMENT: 'INVALID_DOCUMENT',
  /** manifest 声明的资产在包内缺失 */
  MISSING_ASSET: 'MISSING_ASSET',
} as const;

/** 书档错误码联合 */
export type BookPackErrorCode =
  (typeof BOOK_PACK_ERROR_CODES)[keyof typeof BOOK_PACK_ERROR_CODES];

/** 书档解析错误（中文信息 + 稳定错误码） */
export class BookPackError extends Error {
  /** 稳定错误码 */
  readonly code: BookPackErrorCode;

  constructor(code: BookPackErrorCode, message: string) {
    super(message);
    this.name = 'BookPackError';
    this.code = code;
  }
}

/** 书档清单 */
export interface BookPackManifest {
  /** 固定为 `btbook` */
  format: typeof BTBOOK_FORMAT;
  /** 格式版本 */
  formatVersion: string;
  /** IR schema 版本（便于导入时判断是否需要迁移） */
  schemaVersion: string;
  /** 文档标识 */
  id: string;
  /** 标题（冗余，便于不解包展示） */
  title: string;
  /** 书架摘要 */
  summary: DocumentSummary;
  /** 打包时间（epoch ms，由调用方注入） */
  createdAt: number;
  /** 资产元信息（按写入顺序；二进制在 `assets/<id>`） */
  assets: BookPackAssetMeta[];
  /** 是否包含 annotations.json */
  hasAnnotations: boolean;
}

/** 书档内的资产元信息（不含字节） */
export interface BookPackAssetMeta {
  /** 资产标识 */
  id: string;
  /** MIME 类型 */
  mediaType: string;
  /** 原始文件名 */
  name?: string;
}

/** 包内一个文件 */
export interface BookPackFile {
  /** 包内相对路径（POSIX 分隔符） */
  path: string;
  /** 文件字节 */
  data: Uint8Array;
}

/** 压缩 / 解压端口（由宿主注入） */
export interface BookPackCodec {
  /** 把文件列表压成单文件字节 */
  zip(files: readonly BookPackFile[]): Promise<Uint8Array>;
  /** 解开单文件字节 */
  unzip(data: Uint8Array): Promise<BookPackFile[]>;
}

/** 运行期判定对象是否实现了压缩端口 */
export function isBookPackCodec(value: unknown): value is BookPackCodec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<BookPackCodec>;
  return typeof candidate.zip === 'function' && typeof candidate.unzip === 'function';
}

/** 资产 id → 包内路径（百分号编码，避免 `/` 与空格破坏 ZIP 目录） */
export function assetPackPath(id: string): string {
  return `${BTBOOK_FILES.ASSETS_PREFIX}${encodeURIComponent(id)}`;
}

/** 包内路径 → 资产 id（非法编码返回 undefined） */
export function assetIdFromPath(path: string): string | undefined {
  if (!path.startsWith(BTBOOK_FILES.ASSETS_PREFIX)) {
    return undefined;
  }
  const encoded = path.slice(BTBOOK_FILES.ASSETS_PREFIX.length);
  if (encoded === '') {
    return undefined;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** 待打包资产（id + 载荷） */
export interface BookPackAsset {
  /** 资产标识 */
  id: string;
  /** 资产载荷 */
  payload: AssetPayload;
}

/** 打包输入 */
export interface BuildBookPackInput {
  /** 文档标识 */
  id: string;
  /** IR 文档 */
  document: BookDocument;
  /** 打包时间（epoch ms） */
  createdAt: number;
  /** 书架摘要（缺省由文档元数据即时构建） */
  summary?: DocumentSummary;
  /** 资产列表（缺省无） */
  assets?: readonly BookPackAsset[];
  /** 注记集合（任意可 JSON 序列化结构，缺省不写 annotations.json） */
  annotations?: unknown;
}

/** UTF-8 编码 */
function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** UTF-8 解码（非法字节抛 BookPackError，而不是返回乱码） */
function decodeText(data: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_MANIFEST,
      `书档文件 ${path} 不是合法 UTF-8 文本，请确认压缩包未被破坏。`,
    );
  }
}

/** 构建书档文件列表（纯函数：不做压缩、不读写存储） */
export function buildBookPackFiles(input: BuildBookPackInput): BookPackFile[] {
  if (!isBookDocument(input.document)) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_DOCUMENT,
      '打包失败：document 不是合法 IR（缺 schemaVersion / metadata.title / root）。',
    );
  }
  const assets = input.assets ?? [];
  const summary =
    input.summary ??
    buildDocumentSummary({
      id: input.id,
      metadata: input.document.metadata,
      updatedAt: input.createdAt,
    });
  const manifest: BookPackManifest = {
    format: BTBOOK_FORMAT,
    formatVersion: BTBOOK_FORMAT_VERSION,
    schemaVersion: input.document.schemaVersion,
    id: input.id,
    title: input.document.metadata.title,
    summary,
    createdAt: input.createdAt,
    assets: assets.map((asset) => {
      const meta: BookPackAssetMeta = {
        id: asset.id,
        mediaType: asset.payload.mediaType,
      };
      if (asset.payload.name !== undefined) {
        meta.name = asset.payload.name;
      }
      return meta;
    }),
    hasAnnotations: input.annotations !== undefined,
  };

  const files: BookPackFile[] = [
    { path: BTBOOK_FILES.MANIFEST, data: encodeText(JSON.stringify(manifest)) },
    { path: BTBOOK_FILES.DOCUMENT, data: encodeText(JSON.stringify(input.document)) },
  ];
  if (input.annotations !== undefined) {
    files.push({
      path: BTBOOK_FILES.ANNOTATIONS,
      data: encodeText(JSON.stringify(input.annotations)),
    });
  }
  for (const asset of assets) {
    files.push({ path: assetPackPath(asset.id), data: asset.payload.data });
  }
  return files;
}

/** 解包结果 */
export interface UnpackedBookPack {
  /** 清单 */
  manifest: BookPackManifest;
  /** IR 文档 */
  document: BookDocument;
  /** 书架摘要（旧包缺 summary 时由元数据补） */
  summary: DocumentSummary;
  /** 注记集合（未包含时为 undefined） */
  annotations?: unknown;
  /** 资产列表（按 manifest 声明顺序，缺失项抛错） */
  assets: BookPackAsset[];
}

/** 读取 manifest（缺失 / 非法 JSON / 版本不符均抛 BookPackError） */
export function parseBookPackManifest(files: readonly BookPackFile[]): BookPackManifest {
  const manifestFile = files.find((file) => file.path === BTBOOK_FILES.MANIFEST);
  if (manifestFile === undefined) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_MANIFEST,
      '书档缺少 manifest.json，无法识别格式。',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(manifestFile.data, BTBOOK_FILES.MANIFEST));
  } catch (error) {
    if (error instanceof BookPackError) {
      throw error;
    }
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_MANIFEST,
      '书档 manifest.json 不是合法 JSON，请重新导出。',
    );
  }
  const manifest = parsed as Partial<BookPackManifest>;
  if (manifest.format !== BTBOOK_FORMAT) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_FORMAT,
      `书档格式标识为 ${String(manifest.format)}，不是 ${BTBOOK_FORMAT}。`,
    );
  }
  if (manifest.formatVersion !== BTBOOK_FORMAT_VERSION) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.UNSUPPORTED_VERSION,
      `书档格式版本 ${String(manifest.formatVersion)} 不受支持（当前支持 ${BTBOOK_FORMAT_VERSION}）。`,
    );
  }
  if (typeof manifest.id !== 'string' || typeof manifest.schemaVersion !== 'string') {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_MANIFEST,
      '书档 manifest.json 缺少 id 或 schemaVersion 字段。',
    );
  }
  return {
    format: BTBOOK_FORMAT,
    formatVersion: BTBOOK_FORMAT_VERSION,
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    title: typeof manifest.title === 'string' ? manifest.title : manifest.id,
    summary: isDocumentSummary(manifest.summary)
      ? { ...manifest.summary }
      : {
          id: manifest.id,
          title: typeof manifest.title === 'string' ? manifest.title : manifest.id,
          updatedAt: typeof manifest.createdAt === 'number' ? manifest.createdAt : 0,
        },
    createdAt: typeof manifest.createdAt === 'number' ? manifest.createdAt : 0,
    assets: Array.isArray(manifest.assets)
      ? manifest.assets
          .filter(
            (meta): meta is BookPackAssetMeta =>
              typeof meta === 'object' &&
              meta !== null &&
              typeof (meta as BookPackAssetMeta).id === 'string' &&
              typeof (meta as BookPackAssetMeta).mediaType === 'string',
          )
          .map((meta) => ({ ...meta }))
      : [],
    hasAnnotations: manifest.hasAnnotations === true,
  };
}

/** 解析书档文件列表（结构校验；IR 语义校验由调用方决定是否执行） */
export function parseBookPackFiles(files: readonly BookPackFile[]): UnpackedBookPack {
  const manifest = parseBookPackManifest(files);

  const documentFile = files.find((file) => file.path === BTBOOK_FILES.DOCUMENT);
  if (documentFile === undefined) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_DOCUMENT,
      '书档缺少 document.json，无法还原正文。',
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(decodeText(documentFile.data, BTBOOK_FILES.DOCUMENT));
  } catch (error) {
    if (error instanceof BookPackError) {
      throw error;
    }
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_DOCUMENT,
      '书档 document.json 不是合法 JSON，请重新导出。',
    );
  }
  if (!isBookDocument(document)) {
    throw new BookPackError(
      BOOK_PACK_ERROR_CODES.INVALID_DOCUMENT,
      '书档正文不是合法 IR（缺 schemaVersion / metadata.title / root）。',
    );
  }

  const assets: BookPackAsset[] = [];
  for (const meta of manifest.assets) {
    const file = files.find((item) => item.path === assetPackPath(meta.id));
    if (file === undefined) {
      throw new BookPackError(
        BOOK_PACK_ERROR_CODES.MISSING_ASSET,
        `书档声明的资产 ${meta.id} 在包内缺失，请重新导出。`,
      );
    }
    const payload: AssetPayload = { mediaType: meta.mediaType, data: file.data };
    if (meta.name !== undefined) {
      payload.name = meta.name;
    }
    assets.push({ id: meta.id, payload });
  }

  const annotationsFile = files.find((file) => file.path === BTBOOK_FILES.ANNOTATIONS);
  const unpacked: UnpackedBookPack = { manifest, document, summary: manifest.summary, assets };
  if (annotationsFile !== undefined) {
    unpacked.annotations = JSON.parse(
      decodeText(annotationsFile.data, BTBOOK_FILES.ANNOTATIONS),
    );
  }
  return unpacked;
}

/** 打包成单文件字节 */
export async function packBookArchive(
  input: BuildBookPackInput,
  codec: BookPackCodec,
): Promise<Uint8Array> {
  return codec.zip(buildBookPackFiles(input));
}

/** 从单文件字节解包 */
export async function unpackBookArchive(
  data: Uint8Array,
  codec: BookPackCodec,
): Promise<UnpackedBookPack> {
  return parseBookPackFiles(await codec.unzip(data));
}
