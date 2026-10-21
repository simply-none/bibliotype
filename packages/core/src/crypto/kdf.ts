/**
 * 密钥派生（可插拔）
 *
 * 默认实现为 PBKDF2-SHA256（WebCrypto 原生支持，零依赖）。
 * Argon2 等更强 KDF 由宿主注入（`KeyDerivation` 端口），core 不内置
 * 需要 WASM / 原生模块的算法。
 *
 * 盐与迭代次数一律由调用方注入或显式生成，测试使用固定值保证确定性。
 */
import { CRYPTO_ERROR_CODES, CryptoError } from './errors.js';

/** 默认迭代次数（OWASP 2023 对 PBKDF2-SHA256 的建议量级） */
export const DEFAULT_PBKDF2_ITERATIONS = 210_000;

/** 盐长度（字节） */
export const KDF_SALT_BYTES = 16;

/** PBKDF2 参数 */
export interface Pbkdf2Options {
  /** 用户口令（非空） */
  password: string;
  /** 盐（至少 8 字节；建议 16 字节随机） */
  salt: Uint8Array;
  /** 迭代次数（默认 210000；测试可调小） */
  iterations?: number;
  /** 摘要算法（默认 SHA-256） */
  hash?: 'SHA-256' | 'SHA-512';
}

/** 密钥派生端口（宿主可注入 Argon2 等实现） */
export interface KeyDerivation {
  /** 派生一个 AES-GCM 用的 `CryptoKey` */
  derive(password: string, salt: Uint8Array): Promise<CryptoKey>;
}

/** 取 WebCrypto 的 SubtleCrypto（不可用时给出可操作提示） */
export function resolveSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.NOT_SUPPORTED,
      '当前环境没有 WebCrypto（crypto.subtle）。请使用 Node 19+ 或 HTTPS / localhost 下的浏览器。',
    );
  }
  return subtle;
}

/** 生成随机字节（缺省用 WebCrypto；测试可传入确定性来源） */
export function randomBytes(length: number, source?: (length: number) => Uint8Array): Uint8Array {
  if (source !== undefined) {
    return source(length);
  }
  const webCrypto = globalThis.crypto;
  if (webCrypto === undefined || typeof webCrypto.getRandomValues !== 'function') {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.NOT_SUPPORTED,
      '当前环境没有 crypto.getRandomValues，无法生成盐或 IV，请注入确定性来源。',
    );
  }
  const bytes = new Uint8Array(length);
  webCrypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 用 PBKDF2 派生 AES-GCM 256 位密钥
 *
 * 密钥不可导出（`extractable: false`），只能用于加解密，降低泄露面。
 */
export async function deriveKeyPbkdf2(options: Pbkdf2Options): Promise<CryptoKey> {
  if (options.password === '') {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.INVALID_PARAMETER,
      '口令不能为空，请设置一个至少 8 位的口令。',
    );
  }
  if (options.salt.byteLength < 8) {
    throw new CryptoError(
      CRYPTO_ERROR_CODES.INVALID_PARAMETER,
      '盐长度不足（至少 8 字节），请检查密钥派生参数。',
    );
  }
  const subtle = resolveSubtle();
  // 复制成独立 Uint8Array：既避免调用方后续改动盐，也规避 BufferSource 的泛型差异
  const salt = new Uint8Array(options.salt);
  const params: Pbkdf2Params = {
    name: 'PBKDF2',
    salt,
    iterations: options.iterations ?? DEFAULT_PBKDF2_ITERATIONS,
    hash: options.hash ?? 'SHA-256',
  };
  const derived: AesDerivedKeyParams = { name: 'AES-GCM', length: 256 };
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(options.password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(params, baseKey, derived, false, ['encrypt', 'decrypt']);
}

/** 默认的 PBKDF2 派生器（供 `KeyDerivation` 端口直接使用） */
export function createPbkdf2Derivation(options: {
  iterations?: number;
  hash?: 'SHA-256' | 'SHA-512';
} = {}): KeyDerivation {
  return {
    derive(password: string, salt: Uint8Array): Promise<CryptoKey> {
      const params: Pbkdf2Options = { password, salt };
      if (options.iterations !== undefined) {
        params.iterations = options.iterations;
      }
      if (options.hash !== undefined) {
        params.hash = options.hash;
      }
      return deriveKeyPbkdf2(params);
    },
  };
}
