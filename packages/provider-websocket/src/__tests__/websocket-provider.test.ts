import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { PROVIDER_STATUS } from '@bibliotype/collab';
import {
  COLLAB_PROTOCOL_VERSION,
  decodeUpdate,
  encodeServerFrame,
  encodeUpdate,
  parseClientFrame,
} from '../protocol.js';
import type { WebSocketLike } from '../socket.js';
import { WebSocketProvider } from '../websocket-provider.js';

type Listener = (event: unknown) => void;

/** 假 socket：受 FakeHub 驱动，事件风格与浏览器一致 */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  joined = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly hub: FakeHub) {}

  addEventListener(type: string, listener: Listener): void {
    const bucket = this.listeners.get(type) ?? new Set<Listener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('socket 未打开');
    this.hub.receive(this, data);
  }

  close(code = 1000): void {
    this.fail(code);
  }

  /** 模拟连接建立 */
  openNow(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.emit('open', {});
  }

  /** 模拟连接断开 */
  fail(code: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code });
  }

  /** 模拟收到服务端帧 */
  deliver(text: string): void {
    if (this.readyState !== 1) return;
    this.emit('message', { data: text });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

/** 假服务端：一个房间 Y.Doc + 连接集合 */
class FakeHub {
  readonly doc = new Y.Doc();
  online = true;
  connections = 0;
  protected readonly sockets = new Set<FakeSocket>();

  connect(): WebSocketLike {
    this.connections += 1;
    const socket = new FakeSocket(this);
    this.sockets.add(socket);
    if (this.online) queueMicrotask(() => socket.openNow());
    return socket;
  }

  /** 断开全部连接且后续新连接不再自动打开 */
  goOffline(): void {
    this.online = false;
    for (const socket of [...this.sockets]) socket.fail(1006);
  }

  /** 恢复在线并打开仍在连接中的 socket */
  goOnline(): void {
    this.online = true;
    for (const socket of [...this.sockets]) socket.openNow();
  }

  receive(socket: FakeSocket, raw: string): void {
    if (!this.online) return;
    const parsed = parseClientFrame(raw);
    if (!parsed.ok) return;
    const frame = parsed.frame;
    if (frame.t === 'join') {
      socket.joined = true;
      socket.deliver(
        encodeServerFrame({
          t: 'joined',
          protocol: COLLAB_PROTOCOL_VERSION,
          clientId: 'srv-1',
        }),
      );
      socket.deliver(
        encodeServerFrame({ t: 'sync', update: encodeUpdate(Y.encodeStateAsUpdate(this.doc)) }),
      );
      return;
    }
    if (frame.t === 'update') {
      Y.applyUpdate(this.doc, decodeUpdate(frame.update));
      for (const peer of this.sockets) {
        if (peer !== socket && peer.joined) {
          peer.deliver(encodeServerFrame({ t: 'update', update: frame.update }));
        }
      }
    }
  }

  text(): string {
    return this.doc.getText('body').toString();
  }
}

/** 握手阶段直接回“协议版本不兼容”的服务端 */
class MismatchHub extends FakeHub {
  override receive(socket: FakeSocket, raw: string): void {
    const parsed = parseClientFrame(raw);
    if (parsed.ok && parsed.frame.t === 'join') {
      socket.deliver(
        encodeServerFrame({ t: 'joined', protocol: COLLAB_PROTOCOL_VERSION + 1, clientId: 'x' }),
      );
      return;
    }
    super.receive(socket, raw);
  }
}

/** 构造一个固定退避参数的 Provider */
function buildProvider(hub: FakeHub, overrides: Record<string, unknown> = {}): WebSocketProvider {
  return new WebSocketProvider({
    url: 'ws://fake',
    docId: 'doc-1',
    socketFactory: () => hub.connect(),
    random: () => 0.5,
    backoff: { baseDelayMs: 100, factor: 2, jitterRatio: 0, random: () => 0.5 },
    handshakeTimeoutMs: 5000,
    ...overrides,
  });
}

describe('WebSocketProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('握手后拉取服务端全量状态并置 connected', async () => {
    const hub = new FakeHub();
    hub.doc.getText('body').insert(0, '服务端既有内容');
    const provider = buildProvider(hub);
    const doc = new Y.Doc();
    provider.bind(doc);

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(provider.status).toBe(PROVIDER_STATUS.CONNECTED);
    expect(doc.getText('body').toString()).toBe('服务端既有内容');
    expect(provider.diagnostics.serverClientId).toBe('srv-1');
    provider.destroy();
  });

  it('本地更新实时上行到服务端', async () => {
    const hub = new FakeHub();
    const provider = buildProvider(hub);
    const doc = new Y.Doc();
    provider.bind(doc);
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);

    doc.getText('body').insert(0, '本地改动');
    expect(hub.text()).toBe('本地改动');
    provider.destroy();
  });

  it('断线 10 次编辑后重连：一次补发、内容不重复', async () => {
    const hub = new FakeHub();
    const provider = buildProvider(hub);
    const doc = new Y.Doc();
    provider.bind(doc);
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    doc.getText('body').insert(0, '开头');

    hub.goOffline();
    expect(provider.status).toBe(PROVIDER_STATUS.DISCONNECTED);
    for (let i = 0; i < 10; i += 1) {
      doc.getText('body').insert(doc.getText('body').length, String(i % 10));
    }

    hub.goOnline();
    await vi.advanceTimersByTimeAsync(100);

    expect(provider.status).toBe(PROVIDER_STATUS.CONNECTED);
    expect(hub.text()).toBe('开头0123456789');
    expect(hub.doc.getText('body').length).toBe(12);
    provider.destroy();
  });

  it('手动断开后不自动重连', async () => {
    const hub = new FakeHub();
    const provider = buildProvider(hub);
    provider.bind(new Y.Doc());
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(hub.connections).toBe(1);

    provider.disconnect();
    await vi.advanceTimersByTimeAsync(5000);
    expect(hub.connections).toBe(1);
    expect(provider.status).toBe(PROVIDER_STATUS.DISCONNECTED);
    provider.destroy();
  });

  it('autoReconnect=false 时不重连', async () => {
    const hub = new FakeHub();
    const provider = buildProvider(hub, { autoReconnect: false });
    provider.bind(new Y.Doc());
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);

    hub.goOffline();
    await vi.advanceTimersByTimeAsync(5000);
    expect(hub.connections).toBe(1);
    provider.destroy();
  });

  it('协议版本不匹配：记录错误、断开且不再重连', async () => {
    const hub = new MismatchHub();
    const provider = buildProvider(hub);
    provider.bind(new Y.Doc());
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);

    expect(provider.status).toBe(PROVIDER_STATUS.DISCONNECTED);
    expect(provider.diagnostics.lastError ?? '').toContain('版本');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(hub.connections).toBe(1);
    provider.destroy();
  });

  it('ping 仅在 connected 时成功', async () => {
    const hub = new FakeHub();
    const provider = buildProvider(hub);
    expect(provider.ping()).toBe(false);

    provider.bind(new Y.Doc());
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.ping()).toBe(true);

    provider.disconnect();
    expect(provider.ping()).toBe(false);
    provider.destroy();
  });

  it('destroy 后再 connect 抛错', () => {
    const hub = new FakeHub();
    const provider = buildProvider(hub);
    provider.bind(new Y.Doc());
    provider.destroy();
    expect(() => provider.connect()).toThrow('已销毁');
  });
});
