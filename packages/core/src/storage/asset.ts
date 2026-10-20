/**
 * 资产（Asset）存储端口
 *
 * 正文只存引用（`asset:<id>`），二进制另存——这是「编辑器插图 → EPUB / PDF 打包」
 * 链路的共同底座，也服务封面、内嵌字体与朗读音频。
 *
 * 与 `StorageAdapter`（文档端口）并列：适配器可实现其中一个或两者，
 * 用 `isAssetStore` 做运行期探测，避免强制所有适配器实现资产能力。
 */

/** 资产种类常量 */
export const ASSET_KINDS = {
  /** 图片 / 插图 / 封面 */
  IMAGE: 'image',
  /** 字体文件 */
  FONT: 'font',
  /** 音频（朗读、配乐） */
  AUDIO: 'audio',
  /** 其他二进制 */
  OTHER: 'other',
} as const;

/** 资产种类联合 */
export type AssetKind = (typeof ASSET_KINDS)[keyof typeof ASSET_KINDS];

/** 资产二进制载荷 */
export interface AssetPayload {
  /** MIME 类型，如 `image/png` */
  mediaType: string;
  /** 字节内容（不复制语义：适配器可直接持有） */
  data: Uint8Array;
  /** 原始文件名（可选，便于导出时还原扩展名） */
  name?: string;
}

/** 资产元信息（列表 / 引用用，不含字节） */
export interface AssetRef {
  /** 资产标识（由调用方给定，建议内容哈希） */
  id: string;
  /** 资产种类 */
  kind: AssetKind;
  /** MIME 类型 */
  mediaType: string;
  /** 字节长度 */
  byteLength: number;
  /** 原始文件名（若有） */
  name?: string;
  /** 内容哈希（FNV-1a 32 位十六进制，用于去重；适配器写入时计算） */
  hash?: string;
}

/** 写入资产的附加选项 */
export interface PutAssetOptions {
  /** 资产种类（缺省按 MIME 前缀推断） */
  kind?: AssetKind;
}

/**
 * 资产存储端口
 *
 * 约定：
 * - `putAsset` 为覆盖语义（同 id 覆盖），返回元信息；
 * - `getAsset` 未命中返回 undefined（不抛错）；
 * - `listAssets` 顺序不作保证，调用方自行排序；
 * - `deleteAsset` 返回是否删除成功。
 */
export interface AssetStore {
  /** 适配器名称（如 'indexeddb' / 'http'） */
  readonly name: string;
  /** 写入资产并返回元信息 */
  putAsset(id: string, payload: AssetPayload, options?: PutAssetOptions): Promise<AssetRef>;
  /** 读取资产（未命中返回 undefined） */
  getAsset(id: string): Promise<AssetPayload | undefined>;
  /** 列出全部资产元信息 */
  listAssets(): Promise<AssetRef[]>;
  /** 删除资产 */
  deleteAsset(id: string): Promise<boolean>;
}

/** 按 MIME 前缀推断资产种类 */
export function resolveAssetKind(mediaType: string): AssetKind {
  if (mediaType.startsWith('image/')) {
    return ASSET_KINDS.IMAGE;
  }
  if (mediaType.startsWith('font/') || mediaType.includes('font')) {
    return ASSET_KINDS.FONT;
  }
  if (mediaType.startsWith('audio/')) {
    return ASSET_KINDS.AUDIO;
  }
  return ASSET_KINDS.OTHER;
}

/** 计算字节的 FNV-1a 32 位哈希（确定性，用于内容去重命名） */
export function hashAssetBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 由载荷构造元信息（适配器写入时复用，保证 hash 口径一致） */
export function toAssetRef(
  id: string,
  payload: AssetPayload,
  options: PutAssetOptions = {},
): AssetRef {
  const ref: AssetRef = {
    id,
    kind: options.kind ?? resolveAssetKind(payload.mediaType),
    mediaType: payload.mediaType,
    byteLength: payload.data.byteLength,
    hash: hashAssetBytes(payload.data),
  };
  if (payload.name !== undefined) {
    ref.name = payload.name;
  }
  return ref;
}

/** 运行期判定对象是否实现了资产端口 */
export function isAssetStore(value: unknown): value is AssetStore {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<AssetStore>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.putAsset === 'function' &&
    typeof candidate.getAsset === 'function' &&
    typeof candidate.listAssets === 'function' &&
    typeof candidate.deleteAsset === 'function'
  );
}
