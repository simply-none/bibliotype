/**
 * 样式设置存储实现（IndexedDB / localStorage / 内存）
 *
 * 对应 core 的 `StyleSettingsStore` 端口。三种实现的语义完全一致，可按运行环境选择：
 * - `IndexedDbStyleStore`：Web / Electron 渲染进程默认（容量大、异步、不阻塞主线程）；
 * - `LocalStorageStyleStore`：无 IndexedDB 时的兜底（同步 API，体量小、仅存设置足够）；
 * - `MemoryStyleStore`：单测 / SSR / 预览环境（不落盘）。
 *
 * Electron 侧若需走本地 SQLite 或远端服务，实现同一端口即可（`name` 区分），
 * demo 通过一个工厂函数切换，不改调用方逻辑。
 */
import {
  normalizeStyleSnapshot,
  type StylePreset,
  type StyleSettingsSnapshot,
  type StyleSettingsStore,
} from '@bibliotype/core';
import { openDatabase, requestToPromise, transactionDone } from './idb-helpers.js';
import type { StoreDefinition } from './idb-helpers.js';

/** 样式库库名（与文档库 `bt-documents` 分离，避免版本漂移互相牵连） */
const DATABASE_NAME = 'bt-style';
const DATABASE_VERSION = 1;

/** 仓库描述：快照按作用域键存，预设按预设 id 存 */
const STYLE_STORES: readonly StoreDefinition[] = [
  { name: 'snapshots', keyPath: 'id' },
  { name: 'presets', keyPath: 'id' },
];

/** 落盘记录（快照 + 主键） */
type SnapshotRecord = StyleSettingsSnapshot & { id: string };

/**
 * IndexedDB 实现
 *
 * 连接惰性打开：首次调用时建库建仓，`close()` 后再次调用会重新打开
 * （与 `IndexedDbAdapter` 的约定一致，宿主可放心在页面卸载时 close）。
 */
export class IndexedDbStyleStore implements StyleSettingsStore {
  readonly name = 'indexeddb';

  private factory: IDBFactory;
  private databaseName: string;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(options: { factory?: IDBFactory; databaseName?: string } = {}) {
    const factory = options.factory ?? globalThis.indexedDB;
    if (factory === undefined) {
      throw new Error('当前环境没有 IndexedDB，请改用 LocalStorageStyleStore 或 MemoryStyleStore');
    }
    this.factory = factory;
    this.databaseName = options.databaseName ?? DATABASE_NAME;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise === undefined) {
      this.dbPromise = openDatabase(
        this.factory,
        this.databaseName,
        DATABASE_VERSION,
        STYLE_STORES,
      ).catch((error: unknown) => {
        // 打开失败不缓存失败的 Promise，下次调用重试
        this.dbPromise = undefined;
        throw error;
      });
    }
    return this.dbPromise;
  }

  async load(scope: string): Promise<StyleSettingsSnapshot | undefined> {
    const db = await this.open();
    const tx = db.transaction('snapshots', 'readonly');
    const record = await requestToPromise<SnapshotRecord | undefined>(
      tx.objectStore('snapshots').get(scope) as IDBRequest<SnapshotRecord | undefined>,
    );
    if (record === undefined) return undefined;
    return normalizeStyleSnapshot(record, scope);
  }

  async save(scope: string, snapshot: StyleSettingsSnapshot): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put({ ...snapshot, id: scope });
    await transactionDone(tx);
  }

  async listPresets(): Promise<StylePreset[]> {
    const db = await this.open();
    const tx = db.transaction('presets', 'readonly');
    const records = await requestToPromise<StylePreset[]>(
      tx.objectStore('presets').getAll() as IDBRequest<StylePreset[]>,
    );
    return [...records].sort((a, b) => b.createdAt - a.createdAt);
  }

  async savePreset(preset: StylePreset): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('presets', 'readwrite');
    tx.objectStore('presets').put(preset);
    await transactionDone(tx);
  }

  async deletePreset(id: string): Promise<boolean> {
    const db = await this.open();
    const tx = db.transaction('presets', 'readwrite');
    const existed = await this.deleteAndReport(tx.objectStore('presets'), id);
    await transactionDone(tx);
    return existed;
  }

  async delete(scope: string): Promise<boolean> {
    const db = await this.open();
    const tx = db.transaction('snapshots', 'readwrite');
    const existed = await this.deleteAndReport(tx.objectStore('snapshots'), scope);
    await transactionDone(tx);
    return existed;
  }

  /** 删除并返回此前是否存在（先 count 再 delete，避免依赖 delete 的返回语义） */
  private async deleteAndReport(store: IDBObjectStore, key: string): Promise<boolean> {
    const count = await requestToPromise<number>(store.count(key));
    store.delete(key);
    return count > 0;
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['snapshots', 'presets'], 'readwrite');
    tx.objectStore('snapshots').clear();
    tx.objectStore('presets').clear();
    await transactionDone(tx);
  }

  async close(): Promise<void> {
    if (this.dbPromise === undefined) return;
    const promise = this.dbPromise;
    this.dbPromise = undefined;
    const db = await promise.catch(() => undefined);
    db?.close();
  }
}

/* -------------------------------------------------------------------------- */
/* localStorage 实现                                                           */
/* -------------------------------------------------------------------------- */

/** localStorage 键前缀 */
const LS_SNAPSHOT_PREFIX = 'bt-style:snapshot:';
const LS_PRESETS_KEY = 'bt-style:presets';

/** 最小 Storage 契约（便于注入测试替身；length / key 可选，用于清空时枚举） */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

/** 取默认 localStorage（不可用时返回 undefined） */
function defaultStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** 解析 JSON（失败返回 undefined，不抛错） */
function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** localStorage 实现（同步 API 包成 Promise，接口与 IndexedDB 版一致） */
export class LocalStorageStyleStore implements StyleSettingsStore {
  readonly name = 'localstorage';
  private storage: KeyValueStorage | undefined;

  constructor(options: { storage?: KeyValueStorage } = {}) {
    this.storage = options.storage ?? defaultStorage();
    if (this.storage === undefined) {
      throw new Error('当前环境没有 localStorage，请改用 MemoryStyleStore');
    }
  }

  private get store(): KeyValueStorage {
    if (this.storage === undefined) throw new Error('localStorage 不可用');
    return this.storage;
  }

  async load(scope: string): Promise<StyleSettingsSnapshot | undefined> {
    const raw = parseJson(this.store.getItem(`${LS_SNAPSHOT_PREFIX}${scope}`));
    if (raw === undefined) return undefined;
    return normalizeStyleSnapshot(raw, scope);
  }

  async save(scope: string, snapshot: StyleSettingsSnapshot): Promise<void> {
    this.store.setItem(`${LS_SNAPSHOT_PREFIX}${scope}`, JSON.stringify(snapshot));
  }

  async listPresets(): Promise<StylePreset[]> {
    const raw = parseJson(this.store.getItem(LS_PRESETS_KEY));
    if (!Array.isArray(raw)) return [];
    return (raw as StylePreset[])
      .filter((item) => typeof item === 'object' && item !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async savePreset(preset: StylePreset): Promise<void> {
    const presets = await this.listPresets();
    const next = [preset, ...presets.filter((item) => item.id !== preset.id)];
    this.store.setItem(LS_PRESETS_KEY, JSON.stringify(next));
  }

  async deletePreset(id: string): Promise<boolean> {
    const presets = await this.listPresets();
    const next = presets.filter((item) => item.id !== id);
    if (next.length === presets.length) return false;
    this.store.setItem(LS_PRESETS_KEY, JSON.stringify(next));
    return true;
  }

  async delete(scope: string): Promise<boolean> {
    const key = `${LS_SNAPSHOT_PREFIX}${scope}`;
    const existed = this.store.getItem(key) !== null;
    this.store.removeItem(key);
    return existed;
  }

  async clear(): Promise<void> {
    this.store.removeItem(LS_PRESETS_KEY);
    /* 枚举并删除全部快照键；Storage 未实现 key() 时退化为只清理全局作用域
     * （demo 只有 global + book:<id> 两类键，book 键体积最大但可被覆盖写）。 */
    const storage = this.store;
    const keys: string[] = [];
    if (typeof storage.key === 'function' && typeof storage.length === 'number') {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null && key.startsWith(LS_SNAPSHOT_PREFIX)) keys.push(key);
      }
    }
    if (keys.length === 0) keys.push(`${LS_SNAPSHOT_PREFIX}global`);
    for (const key of keys) storage.removeItem(key);
  }

  async close(): Promise<void> {
    /* 无可释放资源 */
  }
}

/* -------------------------------------------------------------------------- */
/* 内存实现                                                                    */
/* -------------------------------------------------------------------------- */

/** 内存实现（单测 / SSR；不落盘） */
export class MemoryStyleStore implements StyleSettingsStore {
  readonly name = 'memory';
  private snapshots = new Map<string, StyleSettingsSnapshot>();
  private presets = new Map<string, StylePreset>();

  async load(scope: string): Promise<StyleSettingsSnapshot | undefined> {
    const snapshot = this.snapshots.get(scope);
    return snapshot === undefined ? undefined : normalizeStyleSnapshot(snapshot, scope);
  }

  async save(scope: string, snapshot: StyleSettingsSnapshot): Promise<void> {
    this.snapshots.set(scope, snapshot);
  }

  async listPresets(): Promise<StylePreset[]> {
    return [...this.presets.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async savePreset(preset: StylePreset): Promise<void> {
    this.presets.set(preset.id, preset);
  }

  async deletePreset(id: string): Promise<boolean> {
    return this.presets.delete(id);
  }

  async delete(scope: string): Promise<boolean> {
    return this.snapshots.delete(scope);
  }

  async clear(): Promise<void> {
    this.snapshots.clear();
    this.presets.clear();
  }

  async close(): Promise<void> {
    /* 无可释放资源 */
  }
}

/**
 * 按环境选择实现
 *
 * 优先级：显式传入 > IndexedDB 可用 > localStorage 可用 > 内存。
 * 任何一步构造失败都继续降级（不让「存储不可用」阻断编辑）。
 */
export function createStyleStore(options: {
  prefer?: 'indexeddb' | 'localstorage' | 'memory';
  factory?: IDBFactory;
  storage?: KeyValueStorage;
  databaseName?: string;
} = {}): StyleSettingsStore {
  const prefer = options.prefer;
  const createIdb = (): StyleSettingsStore | undefined => {
    try {
      return new IndexedDbStyleStore({ factory: options.factory, databaseName: options.databaseName });
    } catch {
      return undefined;
    }
  };
  const createLs = (): StyleSettingsStore | undefined => {
    try {
      return new LocalStorageStyleStore({ storage: options.storage });
    } catch {
      return undefined;
    }
  };

  if (prefer === 'memory') return new MemoryStyleStore();
  if (prefer === 'localstorage') return createLs() ?? new MemoryStyleStore();
  if (prefer === 'indexeddb') return createIdb() ?? createLs() ?? new MemoryStyleStore();
  return createIdb() ?? createLs() ?? new MemoryStyleStore();
}
