/**
 * 存储层透明加密装饰器
 *
 * 设计：**装饰而非改造**——`createEncryptedStorageAdapter` 包在任意
 * `StorageAdapter` 外面，在 `save` / `load` 边界做加解密；底层适配器
 * （IndexedDB / SQLite / HTTP）只见密文，不需要感知加密。
 *
 * 加密态的记录仍是合法 `BookDocument`（`schemaVersion` 标记为 sealed、
 * 正文为空、信封存在 `metadata.extra`），因此底层无需特殊分支。
 *
 * 已知限制（有意为之）：
 * - 加密态的 `list()` 只给出占位标题（无法在未解锁时解密书目）；
 * - 因此加密适配器不实现 `BookLibraryStore`，书架在加密开启时退化为
 *   「解锁后才能检索」；
 * - 摘要字数 / 作者不可用（避免泄露）。
 */
import type { BookDocument } from '../ir/document.js';
import { isBookDocument } from '../ir/document.js';
import { NODE_TYPES } from '../ir/node-types.js';
import type { AssetPayload, AssetRef, AssetStore } from '../storage/asset.js';
import type { DocumentSummary, SaveOptions, StorageAdapter } from '../storage/types.js';
import type { ByteCipher, EncryptedEnvelope, StringCipher } from './aes-gcm.js';
import {
  base64ToBytes,
  bytesToBase64,
  decodeEnvelope,
  encodeEnvelope,
  isEncryptedEnvelope,
} from './aes-gcm.js';
import { CRYPTO_ERROR_CODES, CryptoError } from './errors.js';

/** 加密态文档的 schemaVersion 标记 */
export const SEALED_DOCUMENT_SCHEMA = 'sealed-v1';
/** 信封在 `metadata.extra` 中的键名 */
export const SEALED_DOCUMENT_KEY = '__btSealedDocument';
/** 加密态列表的占位标题 */
export const SEALED_DOCUMENT_TITLE = '已加密文档';
/** 加密资产的 MIME 标记（底层只看到这一种类型） */
export const SEALED_ASSET_MEDIA_TYPE = 'application/x-bt-sealed';

/** 加密存储适配器选项 */
export interface EncryptedStorageAdapterOptions {
  /** 被装饰的适配器 */
  inner: StorageAdapter;
  /** 字符串加解密器（同一 `CryptoKey` 派生） */
  cipher: StringCipher;
  /** 列表占位标题（默认「已加密文档」） */
  placeholderTitle?: string;
}

/** 加密资产端口选项 */
export interface EncryptedAssetStoreOptions {
  /** 被装饰的资产端口 */
  inner: AssetStore;
  /** 字节加解密器 */
  cipher: ByteCipher;
}

/** 取出文档内的信封（非加密态返回 undefined） */
export function readSealedEnvelope(document: BookDocument): EncryptedEnvelope | undefined {
  if (document.schemaVersion !== SEALED_DOCUMENT_SCHEMA) {
    return undefined;
  }
  const value = document.metadata.extra?.[SEALED_DOCUMENT_KEY];
  return isEncryptedEnvelope(value) ? value : undefined;
}

/** 运行期判定文档是否为加密态 */
export function isSealedDocument(document: BookDocument): boolean {
  return readSealedEnvelope(document) !== undefined;
}

/** 构造加密态占位文档 */
function createSealedDocument(envelope: EncryptedEnvelope, title: string): BookDocument {
  return {
    schemaVersion: SEALED_DOCUMENT_SCHEMA,
    metadata: { title, extra: { [SEALED_DOCUMENT_KEY]: envelope } },
    root: { type: NODE_TYPES.BOOK, children: [] },
  };
}

/**
 * 创建加密存储适配器
 *
 * `save` 加密整本 IR，`load` 解密；`delete` / `clear` / `close` 直接透传。
 */
export function createEncryptedStorageAdapter(
  options: EncryptedStorageAdapterOptions,
): StorageAdapter {
  const title = options.placeholderTitle ?? SEALED_DOCUMENT_TITLE;

  return {
    name: `${options.inner.name}-encrypted`,

    async save(id: string, document: BookDocument, saveOptions: SaveOptions = {}): Promise<void> {
      if (!isBookDocument(document)) {
        throw new CryptoError(
          CRYPTO_ERROR_CODES.INVALID_PARAMETER,
          '加密保存失败：传入的 document 不是合法 IR。',
        );
      }
      const envelope = await options.cipher.encrypt(JSON.stringify(document));
      await options.inner.save(id, createSealedDocument(envelope, title), saveOptions);
    },

    async load(id: string): Promise<BookDocument | undefined> {
      const stored = await options.inner.load(id);
      if (stored === undefined) {
        return undefined;
      }
      const envelope = readSealedEnvelope(stored);
      if (envelope === undefined) {
        throw new CryptoError(
          CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
          `文档 ${id} 不是加密态记录；请先关闭加密或从备份恢复，混合状态会导致数据不可读。`,
        );
      }
      const plaintext = await options.cipher.decrypt(envelope);
      let parsed: unknown;
      try {
        parsed = JSON.parse(plaintext);
      } catch {
        throw new CryptoError(
          CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
          `文档 ${id} 解密后不是合法 JSON，数据可能已损坏。`,
        );
      }
      if (!isBookDocument(parsed)) {
        throw new CryptoError(
          CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
          `文档 ${id} 解密后不是合法 IR（缺 schemaVersion / metadata.title / root）。`,
        );
      }
      return parsed;
    },

    async list(): Promise<DocumentSummary[]> {
      const summaries = await options.inner.list();
      // 底层摘要本就只含占位标题；这里再兜一层，避免自定义实现泄露正文元信息
      return summaries.map((summary) => ({
        id: summary.id,
        title: title,
        updatedAt: summary.updatedAt,
      }));
    },

    delete(id: string): Promise<boolean> {
      return options.inner.delete(id);
    },

    clear(): Promise<void> {
      return options.inner.clear();
    },

    close(): Promise<void> {
      return options.inner.close();
    },
  };
}

/** 资产明文包装（媒体类型等元信息跟密文一起保存，避免泄露） */
interface SealedAssetPayload {
  mediaType: string;
  name?: string;
  data: string;
}

/**
 * 创建加密资产端口
 *
 * 资产字节整体加密；`mediaType` / 文件名随密文一起保存，底层只看到
 * `application/x-bt-sealed`。未加密的历史资产读取会抛 `CORRUPT_PAYLOAD`。
 */
export function createEncryptedAssetStore(options: EncryptedAssetStoreOptions): AssetStore {
  return {
    name: `${options.inner.name}-encrypted`,

    async putAsset(id: string, payload: AssetPayload): Promise<AssetRef> {
      const sealed: SealedAssetPayload = {
        mediaType: payload.mediaType,
        data: bytesToBase64(payload.data),
      };
      if (payload.name !== undefined) {
        sealed.name = payload.name;
      }
      const envelope = await options.cipher.encrypt(new TextEncoder().encode(JSON.stringify(sealed)));
      const stored: AssetPayload = {
        mediaType: SEALED_ASSET_MEDIA_TYPE,
        data: encodeEnvelope(envelope),
      };
      return options.inner.putAsset(id, stored);
    },

    async getAsset(id: string): Promise<AssetPayload | undefined> {
      const stored = await options.inner.getAsset(id);
      if (stored === undefined) {
        return undefined;
      }
      if (stored.mediaType !== SEALED_ASSET_MEDIA_TYPE) {
        throw new CryptoError(
          CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
          `资产 ${id} 不是加密态记录（mediaType=${stored.mediaType}），请先关闭加密或从备份恢复。`,
        );
      }
      const plain = await options.cipher.decrypt(decodeEnvelope(stored.data));
      let sealed: SealedAssetPayload;
      try {
        sealed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as SealedAssetPayload;
      } catch {
        throw new CryptoError(
          CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
          `资产 ${id} 解密后不是合法结构，数据可能已损坏。`,
        );
      }
      const payload: AssetPayload = {
        mediaType: sealed.mediaType,
        data: base64ToBytes(sealed.data),
      };
      if (sealed.name !== undefined) {
        payload.name = sealed.name;
      }
      return payload;
    },

    listAssets(): Promise<AssetRef[]> {
      return options.inner.listAssets();
    },

    deleteAsset(id: string): Promise<boolean> {
      return options.inner.deleteAsset(id);
    },
  };
}
