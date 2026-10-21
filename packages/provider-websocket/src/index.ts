/**
 * @bibliotype/provider-websocket 统一导出入口
 *
 * 传输实现：WebSocket（重连 + 离线队列）与 BroadcastChannel（本地多标签）。
 * 参考服务端在 `@bibliotype/provider-websocket/server` 子入口，需宿主自行安装 `ws`。
 */

/* ---------- 协议 ---------- */
export {
  COLLAB_MAX_FRAME_BYTES,
  COLLAB_PROTOCOL_ERRORS,
  COLLAB_PROTOCOL_VERSION,
  decodeUpdate,
  encodeClientFrame,
  encodeServerFrame,
  encodeUpdate,
  parseClientFrame,
  parseServerFrame,
} from './protocol.js';
export type {
  ClientFrame,
  CollabProtocolErrorCode,
  FrameParseResult,
  ServerFrame,
} from './protocol.js';

/* ---------- 退避与离线队列 ---------- */
export { nextReconnectDelay } from './backoff.js';
export type { BackoffOptions } from './backoff.js';
export { OfflineUpdateQueue } from './offline-queue.js';
export type { OfflineQueueOptions } from './offline-queue.js';

/* ---------- 传输层适配 ---------- */
export {
  SOCKET_READY_STATE,
  attachSocketHandlers,
  defaultSocketFactory,
  normalizeSocketText,
} from './socket.js';
export type { SocketFactory, SocketHandlers, WebSocketLike } from './socket.js';

/* ---------- Provider ---------- */
export {
  WebSocketProvider,
  createWebSocketProvider,
} from './websocket-provider.js';
export type {
  WebSocketProviderDiagnostics,
  WebSocketProviderOptions,
} from './websocket-provider.js';
export {
  BroadcastProvider,
  createBroadcastProvider,
} from './broadcast-provider.js';
export type {
  BroadcastChannelFactory,
  BroadcastChannelLike,
  BroadcastProviderOptions,
} from './broadcast-provider.js';
