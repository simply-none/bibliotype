/**
 * 离线更新队列（G2）
 *
 * 断线期间的本地更新不能丢：
 * - 合并：`Y.mergeUpdates` 把多条增量压成一条，重连只发一次；
 * - 上限：累计体积超过 `maxQueueBytes` 时置 `needsFullSync`，释放队列内存，
 *   重连后改发 `Y.encodeStateAsUpdate(ydoc)` —— 靠 Yjs 幂等合并保证不重复；
 * - 不静默丢弃：超限只切换兜底策略，不丢本地状态（本地文档始终是完整的）。
 */
import { mergeUpdates } from 'yjs';

/** 队列选项 */
export interface OfflineQueueOptions {
  /** 待发载荷体积上限（字节，缺省 1 MiB） */
  maxQueueBytes?: number;
}

/** 待发更新队列 */
export class OfflineUpdateQueue {
  private pending: Uint8Array | undefined;
  private pendingBytes = 0;
  private fullSync = false;
  private readonly maxBytes: number;

  constructor(options: OfflineQueueOptions = {}) {
    const configured = options.maxQueueBytes;
    this.maxBytes =
      typeof configured === 'number' && Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : 1024 * 1024;
  }

  /** 待发字节数（合并后） */
  get bytes(): number {
    return this.pendingBytes;
  }

  /** 是否已有待发载荷 */
  get size(): number {
    return this.pending === undefined ? 0 : 1;
  }

  /** 是否需要改发全量状态 */
  get needsFullSync(): boolean {
    return this.fullSync;
  }

  /** 是否为空且无需全量同步 */
  get isEmpty(): boolean {
    return this.pending === undefined && !this.fullSync;
  }

  /**
   * 追加一条本地更新
   *
   * 已在全量兜底状态时直接忽略：本地文档本身已包含全部改动。
   */
  push(update: Uint8Array): void {
    if (this.fullSync) return;
    if (!(update instanceof Uint8Array) || update.length === 0) return;
    this.pending = this.pending === undefined ? update : mergeUpdates([this.pending, update]);
    this.pendingBytes = this.pending.length;
    if (this.pendingBytes > this.maxBytes) {
      /* 超限：丢弃合并载荷（不等于丢改动），改记全量兜底 */
      this.pending = undefined;
      this.pendingBytes = 0;
      this.fullSync = true;
    }
  }

  /** 取出合并后的待发载荷并清空（无载荷返回 undefined） */
  drain(): Uint8Array | undefined {
    const payload = this.pending;
    this.pending = undefined;
    this.pendingBytes = 0;
    return payload;
  }

  /** 清空队列与全量兜底标记 */
  clear(): void {
    this.pending = undefined;
    this.pendingBytes = 0;
    this.fullSync = false;
  }
}
