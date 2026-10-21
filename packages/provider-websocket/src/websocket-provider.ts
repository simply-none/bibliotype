/**
 * WebSocket 协同 Provider（G2）
 *
 * 生命周期：
 * 1. `bind(ydoc)`：挂上本地更新监听（此后断线编辑会进离线队列）；
 * 2. `connect()`：建 socket → 发 `join` → 收 `joined` + `sync` → 合并服务端状态；
 * 3. 同步完成后进入 `connected`，此后本地更新直发、远端更新按 provider 自身为 origin 应用；
 * 4. 连接断开：保持本地文档，按指数退避自动重连（手动断开不重连）；
 * 5. 重连成功后先补发离线队列；队列超限则改发全量状态，靠 Yjs 幂等合并避免重复。
 *
 * 协议版本不匹配 / 帧非法 / 握手超时都视为连接失败：记录错误、断开并进入重连。
 */
import {
  PROVIDER_STATUS,
  type CollabProvider,
  type ProviderStatus,
} from '@bibliotype/collab';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import type { Doc } from 'yjs';
import { nextReconnectDelay, type BackoffOptions } from './backoff.js';
import { OfflineUpdateQueue } from './offline-queue.js';
import {
  COLLAB_PROTOCOL_ERRORS,
  COLLAB_PROTOCOL_VERSION,
  decodeUpdate,
  encodeClientFrame,
  encodeUpdate,
  parseServerFrame,
} from './protocol.js';
import {
  SOCKET_READY_STATE,
  attachSocketHandlers,
  defaultSocketFactory,
  type SocketFactory,
  type WebSocketLike,
} from './socket.js';

/** 握手超时（毫秒，缺省 10s） */
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;

/** WebSocket Provider 选项 */
export interface WebSocketProviderOptions {
  /** 服务端地址（`ws://` / `wss://`） */
  url: string;
  /** 书目 / 文档 id（服务端按此分房间） */
  docId: string;
  /** 客户端标识（缺省按随机源生成） */
  clientId?: string;
  /** socket 工厂（缺省取全局 WebSocket；Node 可注入 ws 的 WebSocket） */
  socketFactory?: SocketFactory;
  /** 是否自动重连（缺省 true；手动 `disconnect()` 永不重连） */
  autoReconnect?: boolean;
  /** 退避参数（基准 / 上限 / 抖动 / 随机源） */
  backoff?: BackoffOptions;
  /** 离线队列体积上限（字节，缺省 1 MiB；超限转全量同步） */
  maxQueueBytes?: number;
  /** 最大重连次数（缺省不限） */
  maxReconnectAttempts?: number;
  /** 握手超时（毫秒，缺省 10s） */
  handshakeTimeoutMs?: number;
  /** 时间源（缺省 Date.now；测试注入固定值） */
  now?: () => number;
  /** 随机源（缺省 Math.random；测试注入固定值） */
  random?: () => number;
}

/** 连接内部状态（含远端标识与错误） */
export interface WebSocketProviderDiagnostics {
  /** 累计重连次数（连接成功后清零） */
  readonly reconnectAttempts: number;
  /** 最近一次错误描述（连接成功后不清空，便于排查） */
  readonly lastError: string | undefined;
  /** 服务端分配的客户端标识（握手后可得） */
  readonly serverClientId: string | undefined;
}

/** WebSocket 协同 Provider */
export class WebSocketProvider implements CollabProvider {
  readonly name = 'websocket';

  private readonly url: string;
  private readonly docId: string;
  private readonly clientIdValue: string;
  private readonly socketFactory: SocketFactory;
  private readonly autoReconnect: boolean;
  private readonly backoff: BackoffOptions;
  private readonly maxReconnectAttempts: number;
  private readonly handshakeTimeoutMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly queue: OfflineUpdateQueue;
  private readonly statusHandlers = new Set<(status: ProviderStatus) => void>();

  private ydoc: Doc | undefined;
  private socket: WebSocketLike | undefined;
  private detachSocket: (() => void) | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private socketSeq = 0;
  private reconnectAttemptsValue = 0;
  private lastErrorValue: string | undefined;
  private serverClientIdValue: string | undefined;
  private synced = false;
  private connecting = false;
  private manualClose = false;
  private destroyed = false;
  private _status: ProviderStatus = PROVIDER_STATUS.DISCONNECTED;

  constructor(options: WebSocketProviderOptions) {
    if (typeof options.url !== 'string' || options.url === '') {
      throw new Error('WebSocketProvider 需要非空的 url。');
    }
    if (typeof options.docId !== 'string' || options.docId === '') {
      throw new Error('WebSocketProvider 需要非空的 docId。');
    }
    this.url = options.url;
    this.docId = options.docId;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.clientIdValue =
      options.clientId ?? `bt-${Math.floor(this.random() * 0xffffffff).toString(36)}`;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.autoReconnect = options.autoReconnect !== false;
    this.backoff = options.backoff ?? {};
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.queue = new OfflineUpdateQueue({ maxQueueBytes: options.maxQueueBytes });
  }

  /** 本地更新转发：远端来源不回播（与本端发送共用同一 origin 标记） */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return;
    if (this._status === PROVIDER_STATUS.CONNECTED && this.synced) {
      if (this.sendUpdate(update)) return;
    }
    this.queue.push(update);
  };

  get status(): ProviderStatus {
    return this._status;
  }

  /** 客户端标识（本地） */
  get clientId(): string {
    return this.clientIdValue;
  }

  /** 诊断信息（重连次数 / 最近错误 / 服务端分配 id） */
  get diagnostics(): WebSocketProviderDiagnostics {
    return {
      reconnectAttempts: this.reconnectAttemptsValue,
      lastError: this.lastErrorValue,
      serverClientId: this.serverClientIdValue,
    };
  }

  bind(ydoc: Doc): void {
    if (this.ydoc !== undefined && this.ydoc !== ydoc) {
      throw new Error('WebSocketProvider 已绑定其他文档，不能重复绑定。');
    }
    if (this.ydoc === ydoc) return;
    this.ydoc = ydoc;
    ydoc.on('update', this.onDocUpdate);
  }

  connect(): void {
    this.assertUsable();
    if (this._status === PROVIDER_STATUS.CONNECTED || this.connecting) return;
    if (this.ydoc === undefined) {
      throw new Error('WebSocketProvider 未绑定文档，请先 bind(ydoc) 或经 CollabSession 构造。');
    }
    this.manualClose = false;
    this.openSocket();
  }

  disconnect(): void {
    this.manualClose = true;
    this.connecting = false;
    this.synced = false;
    this.clearTimers();
    const socket = this.socket;
    const detach = this.detachSocket;
    this.socket = undefined;
    this.detachSocket = undefined;
    this.socketSeq += 1;
    detach?.();
    if (socket !== undefined) {
      try {
        socket.close(1000, 'client disconnect');
      } catch {
        /* 关闭失败不影响本地状态 */
      }
    }
    this.setStatus(PROVIDER_STATUS.DISCONNECTED);
  }

  onStatusChange(handler: (status: ProviderStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.disconnect();
    this.destroyed = true;
    this.ydoc?.off('update', this.onDocUpdate);
    this.queue.clear();
    this.statusHandlers.clear();
  }

  /** 发送一次心跳（返回是否成功入 socket） */
  ping(): boolean {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== SOCKET_READY_STATE.OPEN) return false;
    try {
      socket.send(encodeClientFrame({ t: 'ping', at: this.now() }));
      return true;
    } catch {
      return false;
    }
  }

  /** 建立连接（每轮 socket 递增序号，旧 socket 的迟到事件直接忽略） */
  private openSocket(): void {
    this.clearTimers();
    this.connecting = true;
    this.synced = false;
    this.socketSeq += 1;
    const seq = this.socketSeq;
    this.setStatus(PROVIDER_STATUS.CONNECTING);

    let socket: WebSocketLike;
    try {
      socket = this.socketFactory(this.url);
    } catch (error) {
      this.connecting = false;
      this.lastErrorValue = error instanceof Error ? error.message : '创建 WebSocket 失败。';
      this.setStatus(PROVIDER_STATUS.DISCONNECTED);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    try {
      this.detachSocket = attachSocketHandlers(socket, {
        onOpen: () => {
          if (seq !== this.socketSeq) return;
          this.sendJoin(seq);
        },
        onMessage: (text) => {
          if (seq !== this.socketSeq) return;
          this.handleFrame(text);
        },
        onError: (message) => {
          if (seq !== this.socketSeq) return;
          this.lastErrorValue = message;
        },
        onClose: (code) => {
          if (seq !== this.socketSeq) return;
          this.handleClose(code);
        },
      });
    } catch (error) {
      this.lastErrorValue = error instanceof Error ? error.message : '绑定 WebSocket 事件失败。';
      this.dropSocket(seq);
      this.scheduleReconnect();
      return;
    }

    /* 假 socket / 已建立的连接：事件可能早于绑定，主动补一次 join */
    if (socket.readyState === SOCKET_READY_STATE.OPEN) {
      this.sendJoin(seq);
    } else {
      this.handshakeTimer = setTimeout(() => {
        if (seq !== this.socketSeq || this.synced) return;
        this.lastErrorValue = `协同握手超时（${this.handshakeTimeoutMs}ms）。`;
        this.dropSocket(seq);
        this.scheduleReconnect();
      }, this.handshakeTimeoutMs);
    }
  }

  /** 发送 join（重复调用幂等：服务端按 docId 重新挂载） */
  private sendJoin(seq: number): void {
    if (seq !== this.socketSeq) return;
    const socket = this.socket;
    if (socket === undefined) return;
    try {
      socket.send(
        encodeClientFrame({
          t: 'join',
          protocol: COLLAB_PROTOCOL_VERSION,
          docId: this.docId,
          clientId: this.clientIdValue,
        }),
      );
    } catch (error) {
      this.lastErrorValue = error instanceof Error ? error.message : '发送 join 失败。';
      this.dropSocket(seq);
      this.scheduleReconnect();
    }
  }

  /** 处理服务端帧（非法帧按协议错误断开） */
  private handleFrame(text: string | undefined): void {
    const parsed = parseServerFrame(text);
    if (!parsed.ok) {
      this.lastErrorValue = parsed.message;
      this.dropSocket(this.socketSeq);
      /* 版本不匹配不重试（重试也不会成功）；坏帧可以重连重试 */
      if (parsed.code === COLLAB_PROTOCOL_ERRORS.PROTOCOL_MISMATCH) {
        this.manualClose = true;
      }
      this.scheduleReconnect();
      return;
    }
    const frame = parsed.frame;
    if (frame.t === 'joined') {
      this.serverClientIdValue = frame.clientId === '' ? undefined : frame.clientId;
      return;
    }
    if (frame.t === 'sync') {
      if (!this.applyRemote(frame.update)) return;
      this.markSynced();
      return;
    }
    if (frame.t === 'update') {
      this.applyRemote(frame.update);
      return;
    }
    if (frame.t === 'error') {
      this.lastErrorValue = `${frame.code}：${frame.message}`;
      this.dropSocket(this.socketSeq);
      this.scheduleReconnect();
    }
    /* pong：心跳回执，暂无状态需要更新 */
  }

  /** 应用远端更新（origin 记为 provider 自身，避免回播） */
  private applyRemote(payload: string): boolean {
    const ydoc = this.ydoc;
    if (ydoc === undefined) return false;
    try {
      applyUpdate(ydoc, decodeUpdate(payload), this);
      return true;
    } catch (error) {
      this.lastErrorValue = error instanceof Error ? error.message : '应用远端更新失败。';
      this.dropSocket(this.socketSeq);
      this.scheduleReconnect();
      return false;
    }
  }

  /** 同步完成：状态置 connected，补发离线队列或全量状态 */
  private markSynced(): void {
    this.synced = true;
    this.connecting = false;
    this.reconnectAttemptsValue = 0;
    this.clearHandshakeTimer();
    this.setStatus(PROVIDER_STATUS.CONNECTED);

    if (this.queue.needsFullSync) {
      /* 队列超限：本地文档是完整状态，整份补发给服务端（Yjs 幂等合并） */
      const ydoc = this.ydoc;
      if (ydoc !== undefined) this.sendUpdate(encodeStateAsUpdate(ydoc));
      this.queue.clear();
      return;
    }
    const pending = this.queue.drain();
    if (pending !== undefined) this.sendUpdate(pending);
  }

  /** 发送一条更新（socket 不可用返回 false，由调用方入队） */
  private sendUpdate(update: Uint8Array): boolean {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== SOCKET_READY_STATE.OPEN) return false;
    try {
      socket.send(encodeClientFrame({ t: 'update', update: encodeUpdate(update) }));
      return true;
    } catch (error) {
      this.lastErrorValue = error instanceof Error ? error.message : '发送更新失败。';
      return false;
    }
  }

  /** socket 关闭：清理并按需重连 */
  private handleClose(code: number): void {
    if (code !== 1000 && code !== 1005) {
      this.lastErrorValue = `协同连接已关闭（code ${code}）。`;
    }
    this.connecting = false;
    this.synced = false;
    this.clearTimers();
    const detach = this.detachSocket;
    this.detachSocket = undefined;
    this.socket = undefined;
    this.socketSeq += 1;
    detach?.();
    this.setStatus(PROVIDER_STATUS.DISCONNECTED);
    this.scheduleReconnect();
  }

  /** 主动丢弃当前 socket（错误路径，不依赖 close 事件） */
  private dropSocket(seq: number): void {
    if (seq !== this.socketSeq) return;
    this.connecting = false;
    this.synced = false;
    this.clearTimers();
    const socket = this.socket;
    const detach = this.detachSocket;
    this.socket = undefined;
    this.detachSocket = undefined;
    this.socketSeq += 1;
    detach?.();
    if (socket !== undefined) {
      try {
        socket.close(1002, 'provider error');
      } catch {
        /* 忽略关闭失败 */
      }
    }
    this.setStatus(PROVIDER_STATUS.DISCONNECTED);
  }

  /** 安排重连（手动断开 / 已销毁 / 达上限 / autoReconnect=false 时不排） */
  private scheduleReconnect(): void {
    if (this.manualClose || this.destroyed || !this.autoReconnect) return;
    if (this.reconnectTimer !== undefined) return;
    if (this.reconnectAttemptsValue >= this.maxReconnectAttempts) return;
    const delay = nextReconnectDelay(this.reconnectAttemptsValue, {
      ...this.backoff,
      random: this.backoff.random ?? this.random,
    });
    this.reconnectAttemptsValue += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.manualClose || this.destroyed) return;
      this.openSocket();
    }, delay);
  }

  /** 清理所有定时器 */
  private clearTimers(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.clearHandshakeTimer();
  }

  /** 只需清握手定时器 */
  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== undefined) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
  }

  /** 状态广播 */
  private setStatus(status: ProviderStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const handler of [...this.statusHandlers]) {
      handler(status);
    }
  }

  /** destroyed 后不允许再连接 */
  private assertUsable(): void {
    if (this.destroyed) {
      throw new Error('WebSocketProvider 已销毁，不能再连接。');
    }
  }
}

/** 创建 WebSocket Provider（语法糖） */
export function createWebSocketProvider(
  options: WebSocketProviderOptions,
): WebSocketProvider {
  return new WebSocketProvider(options);
}
