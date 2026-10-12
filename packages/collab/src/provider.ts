/**
 * 协同提供者抽象
 *
 * 具体传输实现（WebSocket / WebRTC / Hocuspocus 等）由适配包或
 * 使用方提供，只需实现本接口。collab 包内置 InMemoryProvider 用于
 * 测试与单进程多端演示。
 */
import type * as Y from 'yjs';

/** 提供者连接状态 */
export const PROVIDER_STATUS = {
  /** 未连接 */
  DISCONNECTED: 'disconnected',
  /** 连接中（握手/同步） */
  CONNECTING: 'connecting',
  /** 已连接并完成同步 */
  CONNECTED: 'connected',
} as const;

/** 连接状态联合类型 */
export type ProviderStatus =
  (typeof PROVIDER_STATUS)[keyof typeof PROVIDER_STATUS];

/** 协同提供者接口 */
export interface CollabProvider {
  /** 提供者名称（如 'websocket' / 'in-memory'） */
  readonly name: string;
  /** 当前连接状态 */
  readonly status: ProviderStatus;
  /**
   * 绑定文档（由 CollabSession 在构造时调用）
   *
   * 采用延迟绑定：Provider 先创建、后获得 Y.Doc，
   * 使 session 成为文档的唯一所有者。
   */
  bind(ydoc: Y.Doc): void;
  /** 建立连接（幂等；未绑定文档时抛出错误） */
  connect(): void;
  /** 断开连接（幂等，保留本地文档） */
  disconnect(): void;
  /**
   * 订阅状态变更
   *
   * @returns 取消订阅函数
   */
  onStatusChange(handler: (status: ProviderStatus) => void): () => void;
  /** 销毁（断开并释放资源，不可再连接） */
  destroy(): void;
}
