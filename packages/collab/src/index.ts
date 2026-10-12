/**
 * @bibliotype/collab 统一导出入口
 */

/* ---------- IR ⇄ Y.Doc 映射 ---------- */
export {
  YDOC_KEYS,
  ORIGIN_DOCUMENT_MAPPER,
  writeDocument,
  readDocument,
} from './doc-mapper.js';

/* ---------- Provider 抽象与内置实现 ---------- */
export { PROVIDER_STATUS } from './provider.js';
export type { CollabProvider, ProviderStatus } from './provider.js';
export { InMemoryNetwork, InMemoryProvider } from './in-memory-provider.js';

/* ---------- 用户身份（简化 Awareness） ---------- */
export { DEFAULT_USER_COLORS, createDefaultUser, resolveUser } from './awareness.js';
export type { CollabUser } from './awareness.js';

/* ---------- 协同会话 ---------- */
export { CollabSession } from './session.js';
export type { CollabSessionOptions, DocumentChangeHandler } from './session.js';
