/**
 * AES-GCM 加解密与密文信封
 *
 * 信封结构（JSON 友好，可直接落 IndexedDB / 写进文档属性）：
 * ```json
 * { "v": 1, "iv": "<base64>", "data": "<base64 密文+认证标签>" }
 * ```
 * IV 由调用方注入来源（默认 WebCrypto 随机 12 字节）：**同一密钥下 IV 不得重复**，
 * 测试可传确定性来源，生产必须随机。
 */
import { CRYPTO_ERROR_CODES, CryptoError } from './errors.js';
import { randomBytes, resolveSubtle } from './kdf.js';

/** 信封版本 */
export const ENCRYPTED_ENVELOPE_VERSION = 1;
/** 缺省 IV 长度（字节，AES-GCM 推荐 12） */
export const DEFAULT_IV_BYTES = 12;

/** 密文信封 */
export interface EncryptedEnvelope {
  /** 信封版本（当前为 1） */
  v: number;
  /** 初始化向量（base64） */
  iv: string;
  /** 密文 + 认证标签（base64） */
  data: string;
}

/** 字符串加解密端口 */
export interface StringCipher {
  /** 加密 UTF-8 字符串 */
  encrypt(plaintext: string): Promise<EncryptedEnvelope>;
  /** 解密为 UTF-8 字符串 */
  decrypt(envelope: EncryptedEnvelope): Promise<string>;
}

/** 字节加解密端口（资产 BLOB 用） */
export interface ByteCipher {
  /** 加密字节 */
  encrypt(bytes: Uint8Array): Promise<EncryptedEnvelope>;
  /** 解密字节 */
  decrypt(envelope: EncryptedEnvelope): Promise<Uint8Array>;
}

/** 字节 → base64（分块拼接，避免大数组参数溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** base64 → 字节（非法输入抛 CORRUPT_PAYLOAD） */
export function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
      '密文不是合法 base64，数据可能已损坏，请从备份恢复。',
    );
  }
}

/** 运行期判定是否为密文信封 */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<EncryptedEnvelope>;
  return (
    typeof candidate.v === 'number' &&
    typeof candidate.iv === 'string' &&
    typeof candidate.data === 'string'
  );
}

/** 校验信封版本（未知版本直接拒绝，避免误解密） */
function assertSupportedEnvelope(envelope: EncryptedEnvelope): void {
  if (envelope.v !== ENCRYPTED_ENVELOPE_VERSION) {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
      `密文信封版本 ${envelope.v} 不受支持（当前支持 ${ENCRYPTED_ENVELOPE_VERSION}），请升级客户端。`,
    );
  }
}

/** 加解密共用参数 */
export interface AesGcmOptions {
  /** IV 来源（默认随机 12 字节；测试注入固定值） */
  ivSource?: (length: number) => Uint8Array;
  /** 附加认证数据（AAD，可选；绑定用途标签可防密文串用） */
  additionalData?: Uint8Array;
}

/** 生成 IV */
function nextIv(options: AesGcmOptions): Uint8Array {
  const iv = options.ivSource?.(DEFAULT_IV_BYTES) ?? randomBytes(DEFAULT_IV_BYTES);
  if (iv.byteLength !== DEFAULT_IV_BYTES) {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.INVALID_PARAMETER,
      `IV 长度必须为 ${DEFAULT_IV_BYTES} 字节（当前 ${iv.byteLength}），请检查注入的随机源。`,
    );
  }
  return iv;
}

/**
 * 组装 AES-GCM 算法参数
 *
 * IV / AAD 复制为独立 `Uint8Array`：既防止调用方复用同一缓冲区导致 IV 重复，
 * 也规避 `BufferSource` 的泛型差异（TS 5.9 的 `Uint8Array<ArrayBufferLike>`）。
 */
function gcmParams(iv: Uint8Array, options: AesGcmOptions): AesGcmParams {
  const params: AesGcmParams = { name: 'AES-GCM', iv: new Uint8Array(iv) };
  if (options.additionalData !== undefined) {
    params.additionalData = new Uint8Array(options.additionalData);
  }
  return params;
}

/** 解密失败统一归因为口令 / 密钥不匹配 */
function wrapDecryptError(error: unknown): CryptoError {
  if (error instanceof CryptoError) {
    return error;
  }
  return new CryptoError(
    CRYPTO_ERROR_CODES.WRONG_KEY,
    '解密失败：口令错误或数据已损坏。请确认口令后重试。',
  );
}

/** 创建字符串加解密器 */
export function createStringCipher(key: CryptoKey, options: AesGcmOptions = {}): StringCipher {
  return {
    async encrypt(plaintext: string): Promise<EncryptedEnvelope> {
      const subtle = resolveSubtle();
      const iv = nextIv(options);
      const plain = new TextEncoder().encode(plaintext);
      const cipher = await subtle.encrypt(gcmParams(iv, options), key, plain);
      return {
        v: ENCRYPTED_ENVELOPE_VERSION,
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(cipher)),
      };
    },

    async decrypt(envelope: EncryptedEnvelope): Promise<string> {
      assertSupportedEnvelope(envelope);
      const subtle = resolveSubtle();
      const iv = base64ToBytes(envelope.iv);
      const cipher = base64ToBytes(envelope.data);
      try {
        const plain = await subtle.decrypt(gcmParams(iv, options), key, new Uint8Array(cipher));
        return new TextDecoder('utf-8', { fatal: true }).decode(plain);
      } catch (error) {
        throw wrapDecryptError(error);
      }
    },
  };
}

/** 创建字节加解密器（资产 BLOB） */
export function createByteCipher(key: CryptoKey, options: AesGcmOptions = {}): ByteCipher {
  return {
    async encrypt(bytes: Uint8Array): Promise<EncryptedEnvelope> {
      const subtle = resolveSubtle();
      const iv = nextIv(options);
      const cipher = await subtle.encrypt(gcmParams(iv, options), key, new Uint8Array(bytes));
      return {
        v: ENCRYPTED_ENVELOPE_VERSION,
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(cipher)),
      };
    },

    async decrypt(envelope: EncryptedEnvelope): Promise<Uint8Array> {
      assertSupportedEnvelope(envelope);
      const subtle = resolveSubtle();
      const iv = base64ToBytes(envelope.iv);
      const cipher = base64ToBytes(envelope.data);
      try {
        const plain = await subtle.decrypt(gcmParams(iv, options), key, new Uint8Array(cipher));
        return new Uint8Array(plain);
      } catch (error) {
        throw wrapDecryptError(error);
      }
    },
  };
}

/** 信封 → 单文件字节（写入资产端口时用） */
export function encodeEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

/** 单文件字节 → 信封（结构非法抛 CORRUPT_PAYLOAD） */
export function decodeEnvelope(bytes: Uint8Array): EncryptedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
      '密文不是合法信封（JSON 解析失败），数据可能已损坏。',
    );
  }
  if (!isEncryptedEnvelope(parsed)) {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.CORRUPT_PAYLOAD,
      '密文信封缺少 v / iv / data 字段，数据可能已损坏。',
    );
  }
  return parsed;
}
