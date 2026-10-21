/**
 * 加密标注存储（H5：注记独立密钥）
 *
 * 与正文加密**分开派生密钥**：可以只锁笔记、不解锁正文（反之亦然）。
 * 本模块只负责「标注集合 ↔ 密文载荷」的转换，实际落盘由宿主提供的三个
 * 读写函数完成（localStorage / IndexedDB / 远端均可），因此不绑定具体存储。
 *
 * 密文载荷为 JSON 信封字符串；未加密的历史标注读取会抛 `CORRUPT_PAYLOAD`，
 * 提示先关闭加密或从备份恢复（不静默返回明文）。
 */
import { CRYPTO_ERROR_CODES, CryptoError, isEncryptedEnvelope } from '@bibliotype/core';
import type { EncryptedEnvelope, StringCipher } from '@bibliotype/core';
import type { AnnotationSet, AnnotationStorage } from './types.js';

/** 加密标注存储选项 */
export interface EncryptedAnnotationStorageOptions {
  /** 读取某本书的密文载荷（未命中返回 undefined） */
  read(bookId: string): Promise<string | undefined>;
  /** 写入密文载荷（整体覆盖） */
  write(bookId: string, payload: string): Promise<void>;
  /** 删除某本书的密文载荷 */
  remove(bookId: string): Promise<void>;
  /** **注记专用**加解密器（与正文密钥分开派生） */
  cipher: StringCipher;
  /** 适配器名称（默认 `annotations-encrypted`） */
  name?: string;
}

/** 把任意值解析为标注集合（结构不符抛错） */
function asAnnotationSet(value: unknown): AnnotationSet {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as AnnotationSet).schemaVersion !== 'string' ||
    !Array.isArray((value as AnnotationSet).annotations)
  ) {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
      '标注密文解密后不是合法集合（缺 schemaVersion / annotations），数据可能已损坏。',
    );
  }
  return value as AnnotationSet;
}

/**
 * 创建加密标注存储
 *
 * @example
 * ```ts
 * const storage = createEncryptedAnnotationStorage({
 *   read: (bookId) => localStorage.getItem(`bt:ann:${bookId}`) ?? Promise.resolve(undefined),
 *   write: async (bookId, payload) => localStorage.setItem(`bt:ann:${bookId}`, payload),
 *   remove: async (bookId) => localStorage.removeItem(`bt:ann:${bookId}`),
 *   cipher: notesCipher,
 * });
 * ```
 */
export function createEncryptedAnnotationStorage(
  options: EncryptedAnnotationStorageOptions,
): AnnotationStorage {
  return {
    name: options.name ?? 'annotations-encrypted',

    async loadAnnotations(bookId: string): Promise<AnnotationSet | undefined> {
      const payload = await options.read(bookId);
      if (payload === undefined || payload === '') {
        return undefined;
      }
      let envelope: EncryptedEnvelope;
      try {
        const parsed: unknown = JSON.parse(payload);
        if (!isEncryptedEnvelope(parsed)) {
          throw new CryptoError(
            CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
            `标注 ${bookId} 的载荷不是密文信封，可能未加密或被改写。`,
          );
        }
        envelope = parsed;
      } catch (error) {
        if (error instanceof CryptoError) {
          throw error;
        }
        // 历史明文（JSON 对象而非信封）会走到这里
        throw new CryptoError(
          CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
          `标注 ${bookId} 的载荷不是合法密文，请关闭注记加密或从备份恢复。`,
        );
      }
      const plaintext = await options.cipher.decrypt(envelope);
      let parsedPlain: unknown;
      try {
        parsedPlain = JSON.parse(plaintext);
      } catch {
        throw new CryptoError(
          CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
          `标注 ${bookId} 解密后不是合法 JSON，数据可能已损坏。`,
        );
      }
      return asAnnotationSet(parsedPlain);
    },

    async saveAnnotations(bookId: string, set: AnnotationSet): Promise<void> {
      const envelope = await options.cipher.encrypt(JSON.stringify(set));
      await options.write(bookId, JSON.stringify(envelope));
    },

    clearAnnotations(bookId: string): Promise<void> {
      return options.remove(bookId);
    },
  };
}
