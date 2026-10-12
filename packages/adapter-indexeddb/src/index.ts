/**
 * @bibliotype/adapter-indexeddb 统一导出入口
 */

/* ---------- 适配器实现 ---------- */
export { MemoryAdapter } from './memory-adapter.js';
export { IndexedDbAdapter } from './indexeddb-adapter.js';
export type { IndexedDbAdapterOptions } from './indexeddb-adapter.js';

/* ---------- IDB 原生封装（供其他 adapter 复用） ---------- */
export { openDatabase, requestToPromise, transactionDone } from './idb-helpers.js';
