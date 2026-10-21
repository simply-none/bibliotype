/**
 * 协同传输协议（G2）
 *
 * 传输层只搬运 Yjs 更新，不关心 IR 结构：
 * - 文本帧 = JSON 信封 + base64 载荷，浏览器与 Node 共用同一编解码；
 * - 客户端帧：`join` / `update` / `ping`；
 * - 服务端帧：`joined` / `sync` / `update` / `pong` / `error`；
 * - 版本不匹配与结构非法都返回结构化错误，调用方据此断开，不静默吞帧。
 *
 * Awareness（远端光标，G3）暂缓，仅在客户端帧上预留 `awareness` 类型位。
 */
import { base64ToBytes, bytesToBase64 } from '@bibliotype/core';

/** 协议版本（不兼容变更时递增） */
export const COLLAB_PROTOCOL_VERSION = 1;

/** 单帧字节上限（缺省 8 MiB；解析前先按长度拒绝） */
export const COLLAB_MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** 协议错误码 */
export const COLLAB_PROTOCOL_ERRORS = {
  /** 协议版本不匹配 */
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  /** 帧结构非法 */
  BAD_FRAME: 'BAD_FRAME',
} as const;

/** 协议错误码联合 */
export type CollabProtocolErrorCode =
  (typeof COLLAB_PROTOCOL_ERRORS)[keyof typeof COLLAB_PROTOCOL_ERRORS];

/** 客户端 → 服务端帧 */
export type ClientFrame =
  | { t: 'join'; protocol: number; docId: string; clientId: string }
  | { t: 'update'; update: string }
  | { t: 'ping'; at: number };

/** 服务端 → 客户端帧 */
export type ServerFrame =
  | { t: 'joined'; protocol: number; clientId: string }
  | { t: 'sync'; update: string }
  | { t: 'update'; update: string }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: CollabProtocolErrorCode; message: string };

/** 帧解析结果 */
export type FrameParseResult<T> =
  | { ok: true; frame: T }
  | { ok: false; code: CollabProtocolErrorCode; message: string };

/** 是否为非空字符串 */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** 是否为有限数字 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 客户端帧编码（产出文本帧） */
export function encodeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

/** 服务端帧编码（产出文本帧） */
export function encodeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

/** 解析前的输入归一化（字符串 / 已解析对象都接受） */
function toObject(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    if (raw.length === 0) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined;
}

/**
 * 校验更新载荷
 *
 * base64 解码失败同样视为非法帧；此处只做“能解出字节”的最低校验，
 * Yjs 更新本身的合法性由 `Y.applyUpdate` 兜底（失败时调用方断开连接）。
 */
function isUpdatePayload(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    base64ToBytes(value);
    return true;
  } catch {
    return false;
  }
}

/** 解析客户端帧（参考服务端使用） */
export function parseClientFrame(raw: unknown): FrameParseResult<ClientFrame> {
  const value = toObject(raw);
  if (value === undefined) {
    return {
      ok: false,
      code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
      message: '协同帧不是合法 JSON 对象。',
    };
  }
  const type = value['t'];
  if (type === 'join') {
    const protocol = value['protocol'];
    if (!isFiniteNumber(protocol) || !isText(value['docId']) || !isText(value['clientId'])) {
      return {
        ok: false,
        code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
        message: 'join 帧缺少 protocol（数字）/ docId / clientId。',
      };
    }
    if (protocol !== COLLAB_PROTOCOL_VERSION) {
      return {
        ok: false,
        code: COLLAB_PROTOCOL_ERRORS.PROTOCOL_MISMATCH,
        message: `协同协议版本不匹配：客户端 ${protocol}，服务端 ${COLLAB_PROTOCOL_VERSION}。`,
      };
    }
    return {
      ok: true,
      frame: { t: 'join', protocol, docId: value['docId'], clientId: value['clientId'] },
    };
  }
  if (type === 'update') {
    if (!isUpdatePayload(value['update'])) {
      return {
        ok: false,
        code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
        message: 'update 帧的 update 必须是合法 base64 字符串。',
      };
    }
    return { ok: true, frame: { t: 'update', update: value['update'] } };
  }
  if (type === 'ping') {
    if (!isFiniteNumber(value['at'])) {
      return { ok: false, code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME, message: 'ping 帧缺少 at。' };
    }
    return { ok: true, frame: { t: 'ping', at: value['at'] } };
  }
  return {
    ok: false,
    code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
    message: `未知的协同帧类型：${String(type)}。`,
  };
}

/** 解析服务端帧（客户端 Provider 使用） */
export function parseServerFrame(raw: unknown): FrameParseResult<ServerFrame> {
  const value = toObject(raw);
  if (value === undefined) {
    return {
      ok: false,
      code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
      message: '协同帧不是合法 JSON 对象。',
    };
  }
  const type = value['t'];
  if (type === 'joined') {
    const protocol = value['protocol'];
    if (!isFiniteNumber(protocol)) {
      return { ok: false, code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME, message: 'joined 帧缺少 protocol。' };
    }
    if (protocol !== COLLAB_PROTOCOL_VERSION) {
      return {
        ok: false,
        code: COLLAB_PROTOCOL_ERRORS.PROTOCOL_MISMATCH,
        message: `协同协议版本不匹配：服务端 ${protocol}，客户端 ${COLLAB_PROTOCOL_VERSION}。`,
      };
    }
    return {
      ok: true,
      frame: { t: 'joined', protocol, clientId: isText(value['clientId']) ? value['clientId'] : '' },
    };
  }
  if (type === 'sync' || type === 'update') {
    if (!isUpdatePayload(value['update'])) {
      return {
        ok: false,
        code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
        message: `${type} 帧的 update 必须是合法 base64 字符串。`,
      };
    }
    return { ok: true, frame: { t: type, update: value['update'] } };
  }
  if (type === 'pong') {
    if (!isFiniteNumber(value['at'])) {
      return { ok: false, code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME, message: 'pong 帧缺少 at。' };
    }
    return { ok: true, frame: { t: 'pong', at: value['at'] } };
  }
  if (type === 'error') {
    const code = value['code'];
    if (code !== 'PROTOCOL_MISMATCH' && code !== 'BAD_FRAME') {
      return { ok: false, code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME, message: 'error 帧的 code 非法。' };
    }
    return {
      ok: true,
      frame: {
        t: 'error',
        code,
        message: isText(value['message']) ? value['message'] : '协同连接被服务端拒绝。',
      },
    };
  }
  return {
    ok: false,
    code: COLLAB_PROTOCOL_ERRORS.BAD_FRAME,
    message: `未知的协同帧类型：${String(type)}。`,
  };
}

/** Yjs 更新 → base64 帧载荷 */
export function encodeUpdate(update: Uint8Array): string {
  return bytesToBase64(update);
}

/** base64 帧载荷 → Yjs 更新 */
export function decodeUpdate(payload: string): Uint8Array {
  return base64ToBytes(payload);
}
