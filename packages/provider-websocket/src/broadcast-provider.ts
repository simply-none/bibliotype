/**
 * BroadcastChannel 多标签 Provider（G2）
 *
 * 同源多标签页之间直接同步，无需服务端：
 * - 连上后广播 `hello` 索取既有状态，先到的标签回一条定向 `state`；
 * - 本地更新以 `update` 广播，来源标记为 provider 自身，应用后不再回播；
 * - 自己是发送者的消息按 `from` 过滤（浏览器不会回投自身，Node 同样如此，双保险）；
 * - 频道不可用（无 BroadcastChannel / 名称非法）时 connect 抛错，不静默降级。
 *
 * 与 WebSocket Provider 的差异：本地总线没有“断线重连”，频道关闭期间的更新
 * 由迟到加入时的全量 `state` 补上，因此不维护离线队列。
 */
import {
  PROVIDER_STATUS,
  type CollabProvider,
  type ProviderStatus,
} from '@bibliotype/collab';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import type { Doc } from 'yjs';
import { decodeUpdate, encodeUpdate } from './protocol.js';

/** BroadcastChannel 最小接口（浏览器原生 / Node 全局 / 测试假实现） */
export interface BroadcastChannelLike {
  /** 广播消息 */
  postMessage(message: unknown): void;
  /** 关闭频道 */
  close(): void;
  /** DOM 风格监听 */
  addEventListener?: (type: 'message', listener: (event: unknown) => void) => void;
  /** DOM 风格解绑 */
  removeEventListener?: (type: 'message', listener: (event: unknown) => void) => void;
  /** 单回调风格 */
  onmessage?: ((event: unknown) => void) | null;
}

/** 频道工厂（测试注入假实现） */
export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

/** 广播消息版本 */
const BROADCAST_MESSAGE_VERSION = 1;

/** 广播消息 */
type BroadcastMessage =
  | { bt: number; from: string; kind: 'hello' }
  | { bt: number; from: string; kind: 'state'; to: string; update: string }
  | { bt: number; from: string; kind: 'update'; update: string };

/** BroadcastChannel Provider 选项 */
export interface BroadcastProviderOptions {
  /** 频道名（同源多标签用同一个名字，如 `bt:lunyu`） */
  channelName: string;
  /** 客户端标识（缺省按随机源生成） */
  clientId?: string;
  /** 频道工厂（缺省取全局 BroadcastChannel） */
  channelFactory?: BroadcastChannelFactory;
  /** 随机源（缺省 Math.random；测试注入固定值） */
  random?: () => number;
}

/** 消息结构校验（非法消息直接忽略，不断开本地总线） */
function parseMessage(raw: unknown): BroadcastMessage | undefined {
  const value =
    typeof raw === 'object' && raw !== null && 'data' in raw
      ? (raw as { data: unknown }).data
      : raw;
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record['bt'] !== BROADCAST_MESSAGE_VERSION) return undefined;
  const from = record['from'];
  const kind = record['kind'];
  if (typeof from !== 'string' || from === '') return undefined;
  if (kind === 'hello') {
    return { bt: BROADCAST_MESSAGE_VERSION, from, kind };
  }
  const update = record['update'];
  if (typeof update !== 'string' || update === '') return undefined;
  if (kind === 'state') {
    const to = record['to'];
    if (typeof to !== 'string' || to === '') return undefined;
    return { bt: BROADCAST_MESSAGE_VERSION, from, kind, to, update };
  }
  if (kind === 'update') {
    return { bt: BROADCAST_MESSAGE_VERSION, from, kind, update };
  }
  return undefined;
}

/** 默认频道工厂 */
function defaultChannelFactory(name: string): BroadcastChannelLike {
  const ctor = (globalThis as { BroadcastChannel?: new (channelName: string) => unknown })
    .BroadcastChannel;
  if (typeof ctor !== 'function') {
    throw new Error('当前环境没有 BroadcastChannel，请改用 WebSocket Provider 或注入 channelFactory。');
  }
  return new ctor(name) as BroadcastChannelLike;
}

/** BroadcastChannel 协同 Provider */
export class BroadcastProvider implements CollabProvider {
  readonly name = 'broadcast';

  private readonly channelName: string;
  private readonly clientIdValue: string;
  private readonly channelFactory: BroadcastChannelFactory;
  private readonly statusHandlers = new Set<(status: ProviderStatus) => void>();

  private ydoc: Doc | undefined;
  private channel: BroadcastChannelLike | undefined;
  private detachChannel: (() => void) | undefined;
  private lastErrorValue: string | undefined;
  private destroyed = false;
  private _status: ProviderStatus = PROVIDER_STATUS.DISCONNECTED;

  constructor(options: BroadcastProviderOptions) {
    if (typeof options.channelName !== 'string' || options.channelName === '') {
      throw new Error('BroadcastProvider 需要非空的 channelName。');
    }
    this.channelName = options.channelName;
    const random = options.random ?? Math.random;
    this.clientIdValue = options.clientId ?? `bt-${Math.floor(random() * 0xffffffff).toString(36)}`;
    this.channelFactory = options.channelFactory ?? defaultChannelFactory;
  }

  /** 本地更新广播（按 provider 自身 origin 过滤远端回播） */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return;
    if (this._status !== PROVIDER_STATUS.CONNECTED) return;
    this.post({ kind: 'update', update: encodeUpdate(update) });
  };

  get status(): ProviderStatus {
    return this._status;
  }

  /** 本地客户端标识 */
  get clientId(): string {
    return this.clientIdValue;
  }

  /** 最近一次错误（非法消息 / 应用失败） */
  get lastError(): string | undefined {
    return this.lastErrorValue;
  }

  bind(ydoc: Doc): void {
    if (this.ydoc !== undefined && this.ydoc !== ydoc) {
      throw new Error('BroadcastProvider 已绑定其他文档，不能重复绑定。');
    }
    if (this.ydoc === ydoc) return;
    this.ydoc = ydoc;
    ydoc.on('update', this.onDocUpdate);
  }

  connect(): void {
    if (this.destroyed) {
      throw new Error('BroadcastProvider 已销毁，不能再连接。');
    }
    if (this._status === PROVIDER_STATUS.CONNECTED) return;
    if (this.ydoc === undefined) {
      throw new Error('BroadcastProvider 未绑定文档，请先 bind(ydoc) 或经 CollabSession 构造。');
    }
    this.setStatus(PROVIDER_STATUS.CONNECTING);
    let channel: BroadcastChannelLike;
    try {
      channel = this.channelFactory(this.channelName);
    } catch (error) {
      this.lastErrorValue = error instanceof Error ? error.message : '创建 BroadcastChannel 失败。';
      this.setStatus(PROVIDER_STATUS.DISCONNECTED);
      throw error;
    }
    this.channel = channel;
    this.detachChannel = this.attach(channel);
    this.setStatus(PROVIDER_STATUS.CONNECTED);
    /* 迟到加入：向已在线标签索取全量状态 */
    this.post({ kind: 'hello' });
  }

  disconnect(): void {
    this.detachChannel?.();
    this.detachChannel = undefined;
    const channel = this.channel;
    this.channel = undefined;
    if (channel !== undefined) {
      try {
        channel.close();
      } catch {
        /* 忽略关闭失败 */
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
    this.statusHandlers.clear();
  }

  /** 绑定频道消息监听（兼容 addEventListener 与 onmessage 两种形态） */
  private attach(channel: BroadcastChannelLike): () => void {
    if (typeof channel.addEventListener === 'function') {
      const listener = (event: unknown): void => this.handleMessage(event);
      channel.addEventListener('message', listener);
      return () => {
        channel.removeEventListener?.('message', listener);
      };
    }
    const listener = (event: unknown): void => this.handleMessage(event);
    channel.onmessage = listener;
    return () => {
      if (channel.onmessage === listener) channel.onmessage = null;
    };
  }

  /** 处理频道消息 */
  private handleMessage(raw: unknown): void {
    const message = parseMessage(raw);
    if (message === undefined) return;
    if (message.from === this.clientIdValue) return;
    if (message.kind === 'hello') {
      const ydoc = this.ydoc;
      if (ydoc === undefined) return;
      this.post(
        {
          kind: 'state',
          to: message.from,
          update: encodeUpdate(encodeStateAsUpdate(ydoc)),
        },
      );
      return;
    }
    if (message.kind === 'state' && message.to !== this.clientIdValue) return;
    this.applyRemote(message.update);
  }

  /** 应用远端更新（origin 为 provider 自身） */
  private applyRemote(payload: string): void {
    const ydoc = this.ydoc;
    if (ydoc === undefined) return;
    try {
      applyUpdate(ydoc, decodeUpdate(payload), this);
    } catch (error) {
      this.lastErrorValue = error instanceof Error ? error.message : '应用广播更新失败。';
    }
  }

  /** 广播一条消息 */
  private post(message: { kind: 'hello' } | { kind: 'state'; to: string; update: string } | { kind: 'update'; update: string }): void {
    const channel = this.channel;
    if (channel === undefined) return;
    const payload = { bt: BROADCAST_MESSAGE_VERSION, from: this.clientIdValue, ...message };
    try {
      channel.postMessage(payload);
    } catch (error) {
      this.lastErrorValue = error instanceof Error ? error.message : '广播消息失败。';
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
}

/** 创建 BroadcastChannel Provider（语法糖） */
export function createBroadcastProvider(options: BroadcastProviderOptions): BroadcastProvider {
  return new BroadcastProvider(options);
}
