/**
 * WebSocket 鸭子类型与事件归一化（G2）
 *
 * 浏览器原生 `WebSocket` 用 `addEventListener` + `MessageEvent`，
 * Node 的 `ws` 用 `on('message', data)` 且数据是 Buffer。
 * Provider 只依赖这里的最小接口，测试可注入假 socket。
 */

/** WebSocket 就绪状态（与 DOM 常量一致） */
export const SOCKET_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/** 传输层最小接口（浏览器 WebSocket / ws / 假 socket 均可） */
export interface WebSocketLike {
  /** 就绪状态（DOM 语义） */
  readonly readyState: number;
  /** 发送文本帧 */
  send(data: string): void;
  /** 关闭连接 */
  close(code?: number, reason?: string): void;
  /** DOM 风格事件绑定 */
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  /** DOM 风格事件解绑 */
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
  /** Node 风格事件绑定（ws） */
  on?: (type: string, listener: (...args: unknown[]) => void) => void;
  /** Node 风格事件解绑（ws） */
  off?: (type: string, listener: (...args: unknown[]) => void) => void;
}

/** 传输层事件回调 */
export interface SocketHandlers {
  /** 连接建立 */
  onOpen: () => void;
  /** 收到文本帧（无法解码时返回 undefined） */
  onMessage: (text: string | undefined) => void;
  /** 连接错误（含错误描述） */
  onError: (message: string) => void;
  /** 连接关闭（含关闭码） */
  onClose: (code: number) => void;
}

/** 创建 socket 的工厂（测试注入假实现） */
export type SocketFactory = (url: string) => WebSocketLike;

/** 文本解码器（浏览器 / Node 共用） */
const textDecoder = new TextDecoder();

/**
 * 把任意消息数据归一化为文本
 *
 * 依次处理：字符串 → ArrayBufferView（Buffer / Uint8Array）→ ArrayBuffer →
 * DOM `MessageEvent`（取 `.data`）。其余形态返回 undefined（由调用方按坏帧断开）。
 */
export function normalizeSocketText(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (ArrayBuffer.isView(data)) {
    return textDecoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (data instanceof ArrayBuffer) {
    return textDecoder.decode(new Uint8Array(data));
  }
  if (typeof data === 'object' && data !== null && 'data' in data) {
    return normalizeSocketText((data as { data: unknown }).data);
  }
  return undefined;
}

/** 从事件对象里提取错误描述 */
function errorText(event: unknown): string {
  if (event instanceof Error) return event.message;
  if (typeof event === 'object' && event !== null) {
    const inner = (event as { error?: unknown; message?: unknown }).error;
    if (inner instanceof Error) return inner.message;
    const message = (event as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return 'WebSocket 连接出错。';
}

/** 从关闭事件里提取关闭码 */
function closeCode(event: unknown): number {
  if (typeof event === 'number' && Number.isFinite(event)) return event;
  if (typeof event === 'object' && event !== null) {
    const code = (event as { code?: unknown }).code;
    if (typeof code === 'number' && Number.isFinite(code)) return code;
  }
  return 1006;
}

/**
 * 绑定 socket 事件
 *
 * @returns 解绑函数（幂等，可重复调用）
 */
export function attachSocketHandlers(
  socket: WebSocketLike,
  handlers: SocketHandlers,
): () => void {
  /* DOM 风格优先：浏览器原生与多数 polyfill 都实现 addEventListener */
  if (typeof socket.addEventListener === 'function') {
    const onOpen = (): void => handlers.onOpen();
    const onMessage = (event: unknown): void => {
      handlers.onMessage(normalizeSocketText(event));
    };
    const onError = (event: unknown): void => handlers.onError(errorText(event));
    const onClose = (event: unknown): void => handlers.onClose(closeCode(event));
    socket.addEventListener('open', onOpen);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    return () => {
      socket.removeEventListener?.('open', onOpen);
      socket.removeEventListener?.('message', onMessage);
      socket.removeEventListener?.('error', onError);
      socket.removeEventListener?.('close', onClose);
    };
  }

  if (typeof socket.on === 'function') {
    /* Node 风格（ws）：message 回调直接给数据，close 给 (code, reason) */
    const onOpen = (): void => handlers.onOpen();
    const onMessage = (...args: unknown[]): void => handlers.onMessage(normalizeSocketText(args[0]));
    const onError = (...args: unknown[]): void => handlers.onError(errorText(args[0]));
    const onClose = (...args: unknown[]): void => handlers.onClose(closeCode(args[0]));
    socket.on('open', onOpen);
    socket.on('message', onMessage);
    socket.on('error', onError);
    socket.on('close', onClose);
    return () => {
      socket.off?.('open', onOpen);
      socket.off?.('message', onMessage);
      socket.off?.('error', onError);
      socket.off?.('close', onClose);
    };
  }

  throw new Error('WebSocket 实现既没有 addEventListener 也没有 on，无法绑定事件。');
}

/** 默认 socket 工厂（取全局 WebSocket；缺失时给出明确错误） */
export function defaultSocketFactory(url: string): WebSocketLike {
  const ctor = (globalThis as { WebSocket?: new (target: string) => unknown }).WebSocket;
  if (typeof ctor !== 'function') {
    throw new Error(
      '当前环境没有 WebSocket，请注入 socketFactory（Node 可安装 ws 并传入其 WebSocket）。',
    );
  }
  return new ctor(url) as WebSocketLike;
}
