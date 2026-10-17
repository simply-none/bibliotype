/**
 * @bibliotype/adapter-indexeddb 统一导出入口
 */

/* ---------- 适配器实现 ---------- */
export { MemoryAdapter } from './memory-adapter.js';
export { IndexedDbAdapter } from './indexeddb-adapter.js';
export type { IndexedDbAdapterOptions } from './indexeddb-adapter.js';

/* ---------- IDB 原生封装（供其他 adapter 复用） ---------- */
export { openDatabase, requestToPromise, transactionDone } from './idb-helpers.js';
export type { StoreDefinition } from './idb-helpers.js';

/* ---------- 分片存储（骨架 + 片；供自定义持久化复用） ---------- */
export { CHUNK_BUDGET_BYTES, buildChunkedSnapshot, fromSkeleton } from './chunked-store.js';
export type {
  ChunkNodeMap,
  ChunkSlice,
  ChunkWrite,
  ChunkedSnapshot,
  SkeletonNode,
} from './chunked-store.js';
