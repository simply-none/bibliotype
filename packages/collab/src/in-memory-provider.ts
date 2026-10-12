/**
 * 内存协同网络与提供者
 *
 * 在同一进程内模拟多端协同：
 * - InMemoryNetwork 为「总线」：成员加入时接收既有状态，退出后不再收播；
 * - InMemoryProvider 将 Y.Doc 接入总线：本地更新广播、远端更新应用。
 *
 * 用途：单元测试、单进程多标签页演示、离线回放。
 */
import * as Y from 'yjs';
import {
  PROVIDER_STATUS,
  type CollabProvider,
  type ProviderStatus,
} from './provider.js';

/** 内存协同网络（多端互联总线） */
export class InMemoryNetwork {
  /** 成员 → 其 Y.Doc（网络自持映射，避免触碰 Provider 私有成员） */
  private readonly members = new Map<InMemoryProvider, Y.Doc>();

  /** 登记成员内部方法（由 Provider 调用） */
  attach(provider: InMemoryProvider, ydoc: Y.Doc): void {
    // 新成员先接收既有成员的文档状态（增量合并，幂等）
    for (const memberDoc of this.members.values()) {
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(memberDoc), provider);
    }
    this.members.set(provider, ydoc);
  }

  /** 注销成员内部方法（由 Provider 调用） */
  detach(provider: InMemoryProvider): void {
    this.members.delete(provider);
  }

  /** 向除来源外的所有成员广播更新 */
  broadcast(update: Uint8Array, origin: InMemoryProvider): void {
    for (const [member, memberDoc] of this.members) {
      if (member !== origin) {
        Y.applyUpdate(memberDoc, update, member);
      }
    }
  }

  /** 当前在线成员数 */
  get size(): number {
    return this.members.size;
  }
}

/** 内存协同提供者（延迟绑定：由 CollabSession 在构造时注入 Y.Doc） */
export class InMemoryProvider implements CollabProvider {
  readonly name = 'in-memory';

  private _status: ProviderStatus = PROVIDER_STATUS.DISCONNECTED;
  private ydoc: Y.Doc | undefined;
  private readonly statusHandlers = new Set<(status: ProviderStatus) => void>();

  /** 本地更新转发：远端来源（origin 为其他成员）不再回播，避免环路 */
  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin !== this) {
      this.network.broadcast(update, this);
    }
  };

  constructor(private readonly network: InMemoryNetwork) {}

  get status(): ProviderStatus {
    return this._status;
  }

  bind(ydoc: Y.Doc): void {
    if (this.ydoc !== undefined && this.ydoc !== ydoc) {
      throw new Error('InMemoryProvider 已绑定其他文档，不能重复绑定。');
    }
    this.ydoc = ydoc;
  }

  connect(): void {
    if (this._status === PROVIDER_STATUS.CONNECTED) return;
    const ydoc = this.ydoc;
    if (ydoc === undefined) {
      throw new Error('InMemoryProvider 未绑定文档，请先 bind(ydoc) 或经 CollabSession 构造。');
    }
    this.setStatus(PROVIDER_STATUS.CONNECTING);
    this.network.attach(this, ydoc);
    ydoc.on('update', this.onDocUpdate);
    this.setStatus(PROVIDER_STATUS.CONNECTED);
  }

  disconnect(): void {
    if (this._status !== PROVIDER_STATUS.CONNECTED) return;
    this.ydoc?.off('update', this.onDocUpdate);
    this.network.detach(this);
    this.setStatus(PROVIDER_STATUS.DISCONNECTED);
  }

  onStatusChange(handler: (status: ProviderStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  destroy(): void {
    this.disconnect();
    this.statusHandlers.clear();
  }

  private setStatus(status: ProviderStatus): void {
    this._status = status;
    for (const handler of [...this.statusHandlers]) {
      handler(status);
    }
  }
}
