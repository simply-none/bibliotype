/**
 * IndexedDbAdapter 分片落盘 / 旧格式迁移测试
 *
 * 通过注入 fake-indexeddb 工厂在 Node 下运行；直接读底层仓校验「片记录数」与
 * 「迁移后旧记录消失」，而不只验证 load 结果。
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  NODE_TYPES,
  createEmptyDocument,
  type BookDocument,
  type BookNode,
  type StoredDocument,
} from '@bibliotype/core';
import { IndexedDbAdapter } from '../indexeddb-adapter.js';

/** 造一个段落 */
function paragraph(id: string, text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, id, children: [{ type: 'text', text }] };
}

/** 造一本扁平多段落文档（体积足够切成多片） */
function flatBook(count: number, charsPer = 200): BookDocument {
  const doc = createEmptyDocument({ title: '分片端到端' });
  doc.root.children = Array.from({ length: count }, (_, i) =>
    paragraph(`p-${i}`, String(i % 10).repeat(charsPer)),
  );
  return doc;
}

/** 打开底层库（无版本参数 = 当前版本） */
function openRaw(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 统计某个仓的记录数（可按索引过滤） */
function countStore(
  db: IDBDatabase,
  store: string,
  indexName?: string,
  key?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const target = tx.objectStore(store);
    const source = indexName === undefined ? target : target.index(indexName);
    const request =
      key === undefined ? source.count() : source.count(IDBKeyRange.only(key));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 直接写一条记录（模拟旧格式） */
function putRaw(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 清空指定仓 */
function clearRaw(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('IndexedDbAdapter 分片落盘', () => {
  it('大文档分片落盘后 load 内容一致', async () => {
    const factory = new IDBFactory();
    const adapter = new IndexedDbAdapter({ databaseName: 'chunk-e2e', factory });
    const doc = flatBook(300);

    await adapter.save('big', doc);
    await expect(adapter.load('big')).resolves.toEqual(doc);

    // 底层确实切成了多片
    const raw = await openRaw(factory, 'chunk-e2e');
    const chunkCount = await countStore(raw, 'documents-chunks', 'byDoc', 'big');
    expect(chunkCount).toBeGreaterThan(1);
    raw.close();
  });

  it('内容未变的二次保存不额外写片，list 仍可见', async () => {
    const factory = new IDBFactory();
    const adapter = new IndexedDbAdapter({ databaseName: 'chunk-idempotent', factory });
    const doc = flatBook(120);
    await adapter.save('a', doc);

    const raw = await openRaw(factory, 'chunk-idempotent');
    const before = await countStore(raw, 'documents-chunks', 'byDoc', 'a');
    await adapter.save('a', doc);
    const after = await countStore(raw, 'documents-chunks', 'byDoc', 'a');
    expect(after).toBe(before);

    const summaries = await adapter.list();
    expect(summaries.map((item) => item.id)).toEqual(['a']);
    raw.close();
  });

  it('旧格式整本记录可读，并在下次保存时迁移为分片', async () => {
    const factory = new IDBFactory();
    const adapter = new IndexedDbAdapter({ databaseName: 'chunk-migrate', factory });
    // 先建库（触发建仓）
    await adapter.save('seed', flatBook(2));
    await adapter.delete('seed');

    const legacyDoc: BookDocument = {
      schemaVersion: '0.1.0',
      metadata: { title: '旧格式' } as BookDocument['metadata'],
      root: { type: NODE_TYPES.BOOK, children: [paragraph('p-old', '旧格式正文')] },
    };
    const raw = await openRaw(factory, 'chunk-migrate');
    const record: StoredDocument = {
      id: 'legacy',
      document: legacyDoc,
      metadata: legacyDoc.metadata,
      updatedAt: 123,
    };
    await putRaw(raw, 'documents', record);

    // 读得到（走旧格式分支）
    await expect(adapter.load('legacy')).resolves.toEqual(legacyDoc);

    // 写一次 → 迁移：旧整本记录被删、骨架记录出现
    await adapter.save('legacy', legacyDoc);
    expect(await countStore(raw, 'documents')).toBe(0);
    expect(await countStore(raw, 'documents-meta')).toBe(1);
    await expect(adapter.load('legacy')).resolves.toEqual(legacyDoc);
    raw.close();
  });

  it('delete 会清掉该文档的全部片', async () => {
    const factory = new IDBFactory();
    const adapter = new IndexedDbAdapter({ databaseName: 'chunk-delete', factory });
    await adapter.save('big', flatBook(200));

    await expect(adapter.delete('big')).resolves.toBe(true);
    const raw = await openRaw(factory, 'chunk-delete');
    expect(await countStore(raw, 'documents-chunks', 'byDoc', 'big')).toBe(0);
    expect(await countStore(raw, 'documents-meta')).toBe(0);
    raw.close();
  });

  it('clear 清空骨架与片', async () => {
    const factory = new IDBFactory();
    const adapter = new IndexedDbAdapter({ databaseName: 'chunk-clear', factory });
    await adapter.save('a', flatBook(100));
    await adapter.save('b', flatBook(100));

    await adapter.clear();
    const raw = await openRaw(factory, 'chunk-clear');
    expect(await countStore(raw, 'documents-meta')).toBe(0);
    expect(await countStore(raw, 'documents-chunks')).toBe(0);
    await expect(adapter.list()).resolves.toEqual([]);
    raw.close();
  });
});
