/**
 * 协同会话
 *
 * 聚合「Y.Doc + Provider + 本地用户」，为 reader / editor 提供门面：
 * - loadDocument / snapshot：IR 与 Y.Doc 的进出通道；
 * - onDocumentChange：文档变更订阅（本地与远端统一）；
 * - connect / disconnect / destroy：连接生命周期。
 */
import type { BookDocument } from '@bibliotype/core';
import * as Y from 'yjs';
import { resolveUser, type CollabUser } from './awareness.js';
import { readDocument, writeDocument } from './doc-mapper.js';
import type { CollabProvider } from './provider.js';

/** 会话配置 */
export interface CollabSessionOptions {
  /** 本地用户信息（缺省生成默认身份） */
  user?: Partial<CollabUser>;
  /** 协同提供者（可选；缺省为本地离线文档） */
  provider?: CollabProvider;
  /** 是否构造时自动连接（默认 true） */
  autoConnect?: boolean;
}

/** 文档变更订阅者 */
export type DocumentChangeHandler = (doc: BookDocument) => void;

/** 协同会话 */
export class CollabSession {
  /** 底层 Y.Doc（供高级用法直接访问，如挂接编辑器绑定） */
  readonly ydoc: Y.Doc;

  private readonly provider: CollabProvider | undefined;
  private user: CollabUser;
  private readonly changeHandlers = new Set<DocumentChangeHandler>();
  private readonly onDocUpdate: () => void;
  private destroyed = false;

  constructor(options: CollabSessionOptions = {}) {
    this.ydoc = new Y.Doc();
    this.provider = options.provider;
    this.user = resolveUser(options.user);

    this.onDocUpdate = () => {
      const snapshot = this.snapshot();
      for (const handler of [...this.changeHandlers]) {
        handler(snapshot);
      }
    };
    this.ydoc.on('update', this.onDocUpdate);

    if (this.provider !== undefined) {
      // 延迟绑定：session 是文档唯一所有者，provider 在构造时注入
      this.provider.bind(this.ydoc);
      if (options.autoConnect !== false) {
        this.provider.connect();
      }
    }
  }

  /** 当前本地用户 */
  get currentUser(): CollabUser {
    return this.user;
  }

  /** 更新本地用户信息 */
  updateUser(patch: Partial<CollabUser>): void {
    this.user = { ...this.user, ...patch };
  }

  /** 全量载入文档（写入 Y.Doc；已连接时会同步到其他端） */
  loadDocument(doc: BookDocument): void {
    this.assertAlive();
    writeDocument(this.ydoc, doc);
  }

  /** 导出当前文档快照 */
  snapshot(): BookDocument {
    return readDocument(this.ydoc);
  }

  /**
   * 订阅文档变更（每次事务后回调最新快照）
   *
   * @returns 取消订阅函数
   */
  onDocumentChange(handler: DocumentChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  /** 连接协同网络（幂等） */
  connect(): void {
    this.assertAlive();
    this.provider?.connect();
  }

  /** 断开协同网络（幂等，保留本地文档） */
  disconnect(): void {
    this.provider?.disconnect();
  }

  /** 销毁会话（断开、清空订阅；ydoc 不再使用） */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ydoc.off('update', this.onDocUpdate);
    this.changeHandlers.clear();
    this.provider?.destroy();
    this.ydoc.destroy();
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error('CollabSession 已销毁，不能再执行该操作。');
    }
  }
}
