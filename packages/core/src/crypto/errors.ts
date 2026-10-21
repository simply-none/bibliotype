/**
 * 加密相关错误
 *
 * 约束：错误信息用中文并给出修复指向；错误码稳定，供宿主做分支处理
 * （如「口令错误」提示重试、「未解锁」引导输入口令）。
 */

/** 加密错误码 */
export const CRYPTO_ERROR_CODES = {
  /** 当前环境没有 WebCrypto（需 Node ≥ 19 或安全上下文浏览器） */
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  /** 口令或参数不合法（空口令、盐过短等） */
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  /** 口令错误 / 密钥不匹配（AES-GCM 认证失败） */
  WRONG_KEY: 'WRONG_KEY',
  /** 密文结构损坏（缺字段、版本不符、base64 非法） */
  CORRUPT_PAYLOAD: 'CORRUPT_PAYLOAD',
} as const;

/** 加密错误码联合 */
export type CryptoErrorCode = (typeof CRYPTO_ERROR_CODES)[keyof typeof CRYPTO_ERROR_CODES];

/** 加密错误（带稳定 code，便于宿主分支处理） */
export class CryptoError extends Error {
  /** 稳定错误码 */
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

/** 运行期判定是否为加密错误 */
export function isCryptoError(value: unknown): value is CryptoError {
  return value instanceof CryptoError;
}
