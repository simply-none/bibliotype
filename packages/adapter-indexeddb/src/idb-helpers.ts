/**
 * IndexedDB 原生 API 的 Promise 封装（零依赖）
 */

/** 需要确保存在的对象仓库描述 */
export interface StoreDefinition {
  /** 仓库名 */
  name: string;
  /** 主键路径（缺省 'id'） */
  keyPath?: string | string[];
  /** 需要建立的索引 */
  indexes?: readonly { name: string; keyPath: string }[];
}

/** IDBRequest → Promise */
export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

/** 等待事务完成（readwrite 场景需等待落盘确认） */
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'));
  });
}

/** 按描述建仓（已存在则跳过，供升级与「版本未变但仓缺失」两路复用） */
function ensureStores(db: IDBDatabase, stores: readonly StoreDefinition[]): void {
  for (const store of stores) {
    if (db.objectStoreNames.contains(store.name)) continue;
    const created = db.createObjectStore(store.name, { keyPath: store.keyPath ?? 'id' });
    for (const index of store.indexes ?? []) {
      created.createIndex(index.name, index.keyPath);
    }
  }
}

/**
 * 打开数据库（含升级建仓逻辑）
 *
 * @param factory IDB 工厂
 * @param databaseName 库名
 * @param version 目标版本（升级时触发 onupgradeneeded 建仓）
 * @param stores 需要确保存在的仓库（可传单个名称，等价于默认 'id' 主键）
 */
export function openDatabase(
  factory: IDBFactory,
  databaseName: string,
  version: number,
  stores: readonly StoreDefinition[] | StoreDefinition | string,
): Promise<IDBDatabase> {
  const definitions: readonly StoreDefinition[] =
    typeof stores === 'string' ? [{ name: stores }] : Array.isArray(stores) ? stores : [stores];
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, version);
    request.onupgradeneeded = () => {
      ensureStores(request.result, definitions);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
  });
}
