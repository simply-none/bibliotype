/**
 * IndexedDbAdapter 测试
 *
 * 通用行为由公共契约套件覆盖；通过注入 fake-indexeddb 的 IDBFactory 在 Node 下运行，
 * 每个用例使用独立工厂实例，保证数据库隔离。
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbAdapter } from '../indexeddb-adapter.js';
import { runStorageContractTests, sampleDocument } from './storage-contract.js';

/** 每个用例独立的适配器（独立工厂 → 独立数据库） */
function createAdapter(): IndexedDbAdapter {
  return new IndexedDbAdapter({
    databaseName: 'bibliotype-test',
    factory: new IDBFactory(),
  });
}

runStorageContractTests({
  name: 'IndexedDbAdapter（存储契约）',
  create: createAdapter,
});

describe('IndexedDbAdapter 专有行为', () => {
  it('名称为 indexeddb', () => {
    expect(createAdapter().name).toBe('indexeddb');
  });

  it('无 factory 且无全局 indexedDB 时给出明确错误', async () => {
    const adapter = new IndexedDbAdapter();
    await expect(adapter.save('a', sampleDocument('甲'))).rejects.toThrow(
      '当前环境没有 indexedDB',
    );
  });
});
