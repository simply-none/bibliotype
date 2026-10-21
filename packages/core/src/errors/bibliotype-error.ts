/**
 * 统一错误基类（I8）
 *
 * 全仓错误的共同基类：稳定 `code`（可被宿主分支处理）+ 结构化 `details`
 * （机器可读上下文）+ `hint`（修复建议，中文）+ `cause`（根因链）。
 *
 * 兼容约束：
 * - 既有 5 类错误（HttpAdapterError / PluginConflictError / NodeTypeConflictError /
 *   MigrationPathError / EditorSpecConflictError）及已有稳定码的 CryptoError /
 *   BookPackError 均继承本基类，原 `instanceof` 断言、`name`、message 与 code 值不变；
 * - 错误码统一登记在 `error-codes.ts`（CryptoError / BookPackError 的既有码
 *   分别见 docs/10，不在此重复，避免漂移）。
 */

/** 统一错误构造选项 */
export interface BibliotypeErrorOptions {
  /** 结构化上下文（机器可读，序列化后可还原） */
  details?: Readonly<Record<string, unknown>>;
  /** 修复建议（中文，面向使用者） */
  hint?: string;
  /** 根因（原始错误或任意值） */
  cause?: unknown;
}

/** 跨模块实例去重用的品牌属性（非枚举，不进序列化） */
const ERROR_BRAND = '__bibliotypeError';

/** 统一错误基类 */
export class BibliotypeError extends Error {
  /** 稳定错误码（见 error-codes.ts 与 docs/13） */
  readonly code: string;
  /** 结构化上下文 */
  readonly details?: Readonly<Record<string, unknown>>;
  /** 修复建议 */
  readonly hint?: string;
  /** 根因（lib 为 ES2020，Error 尚无内建 cause，由本类承载） */
  readonly cause?: unknown;

  constructor(code: string, message: string, options: BibliotypeErrorOptions = {}) {
    super(message);
    this.name = 'BibliotypeError';
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.cause !== undefined) this.cause = options.cause;
    Object.defineProperty(this, ERROR_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

/** 运行期判定是否为统一错误（instanceof + 跨实例品牌双通道） */
export function isBibliotypeError(value: unknown): value is BibliotypeError {
  if (value instanceof BibliotypeError) return true;
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record[ERROR_BRAND] === true && typeof record.code === 'string';
}

/** 序列化后的错误形状（可直接 JSON.stringify） */
export interface SerializedBibliotypeError {
  name: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  hint?: string;
  /** 根因：统一错误递归序列化；普通 Error 为 { name, message }；其它值转为 { message } */
  cause?: SerializedBibliotypeError;
}

function serializeCause(cause: unknown): SerializedBibliotypeError | undefined {
  if (cause === undefined) return undefined;
  if (isBibliotypeError(cause)) return serializeBibliotypeError(cause);
  if (cause instanceof Error) {
    return { name: cause.name, code: '', message: cause.message };
  }
  return { name: 'NonError', code: '', message: String(cause) };
}

/** 序列化统一错误（非统一错误抛 TypeError，负例覆盖） */
export function serializeBibliotypeError(error: unknown): SerializedBibliotypeError {
  if (!isBibliotypeError(error)) {
    throw new TypeError('serializeBibliotypeError 仅接受统一错误（isBibliotypeError 判定为真）');
  }
  const payload: SerializedBibliotypeError = {
    name: error.name,
    code: error.code,
    message: error.message,
  };
  if (error.details !== undefined) payload.details = { ...error.details };
  if (error.hint !== undefined) payload.hint = error.hint;
  const cause = serializeCause(error.cause);
  if (cause !== undefined) payload.cause = cause;
  return payload;
}

/** 反序列化校验失败的错误码（本模块自身的错误不进登记表，避免自引用） */
const DESERIALIZE_INVALID = 'DESERIALIZE_INVALID';

/** 从序列化形状还原统一错误（嵌套 cause 同步还原；非法载荷抛错，负例覆盖） */
export function deserializeBibliotypeError(payload: unknown): BibliotypeError {
  if (typeof payload !== 'object' || payload === null) {
    throw new BibliotypeError(DESERIALIZE_INVALID, '反序列化失败：载荷不是对象。', {
      hint: '请传入 serializeBibliotypeError 的输出（或其 JSON 往返结果）。',
    });
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.code !== 'string' || typeof record.message !== 'string') {
    throw new BibliotypeError(DESERIALIZE_INVALID, '反序列化失败：载荷缺少 code / message 字段。', {
      hint: '请检查载荷是否来自 serializeBibliotypeError。',
      details: { code: record.code, message: record.message },
    });
  }
  let cause: unknown;
  if (record.cause !== undefined) {
    const causeRecord = record.cause as Record<string, unknown>;
    if (typeof causeRecord.code === 'string' && causeRecord.code !== '') {
      cause = deserializeBibliotypeError(causeRecord);
    } else {
      cause = new Error(typeof causeRecord.message === 'string' ? causeRecord.message : String(record.cause));
    }
  }
  return new BibliotypeError(record.code, record.message, {
    details: typeof record.details === 'object' && record.details !== null
      ? (record.details as Record<string, unknown>)
      : undefined,
    hint: typeof record.hint === 'string' ? record.hint : undefined,
    cause,
  });
}
