/**
 * 历史版本存储（C7）：快照 CRUD 与保留策略清理。
 *
 * IndexedDB 与内存实现共用断言，避免两套口径分叉。
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createSnapshot, nextSnapshotVersion, restoreSnapshot } from '@bibliotype/core';
import type { BookDocument, DocumentVersionStore } from '@bibliotype/core';
import { IndexedDbVersionStore, MemoryVersionStore } from '../version-store.js';
import { sampleDocument } from './storage-contract.js';

const DAY = 24 * 60 * 60 * 1000;

function sampleBook(): BookDocument {
  return sampleDocument('论语', '学而时习之');
}

interface StoreCase {
  name: string;
  create(): DocumentVersionStore;
}

const CASES: StoreCase[] = [
  { name: 'MemoryVersionStore', create: () => new MemoryVersionStore() },
  {
    name: 'IndexedDbVersionStore',
    create: () => new IndexedDbVersionStore({ factory: new IDBFactory() }),
  },
];

describe.each(CASES)('$name', ({ create }) => {
  it('保存 / 列出 / 读取快照', async () => {
    const store = create();
    const doc = sampleBook();
    const snapshot = createSnapshot({
      documentId: 'book-1',
      document: doc,
      version: 1,
      createdAt: 1000,
      label: '初稿',
      wordCount: 5,
    });

    const meta = await store.saveVersion(snapshot);
    expect(meta).toEqual({
      documentId: 'book-1',
      version: 1,
      label: '初稿',
      createdAt: 1000,
      wordCount: 5,
    });

    const list = await store.listVersions('book-1');
    expect(list).toHaveLength(1);
    expect(await store.loadVersion('book-1', 1)).toEqual(snapshot);
    expect(await store.loadVersion('book-1', 99)).toBeUndefined();
    expect(await store.listVersions('other')).toEqual([]);
  });

  it('多版本按版本号升序，nextSnapshotVersion 可续号', async () => {
    const store = create();
    for (const version of [1, 2, 3]) {
      await store.saveVersion(
        createSnapshot({
          documentId: 'book-1',
          document: sampleBook(),
          version,
          createdAt: version * 1000,
        }),
      );
    }
    const list = await store.listVersions('book-1');
    expect(list.map((item) => item.version)).toEqual([1, 2, 3]);
    expect(nextSnapshotVersion(list)).toBe(4);
  });

  it('同版本覆盖写入', async () => {
    const store = create();
    await store.saveVersion(
      createSnapshot({ documentId: 'book-1', document: sampleBook(), version: 1, createdAt: 1 }),
    );
    await store.saveVersion(
      createSnapshot({ documentId: 'book-1', document: sampleBook(), version: 1, createdAt: 2 }),
    );
    const list = await store.listVersions('book-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.createdAt).toBe(2);
  });

  it('删除已存在 / 不存在', async () => {
    const store = create();
    await store.saveVersion(
      createSnapshot({ documentId: 'book-1', document: sampleBook(), version: 1, createdAt: 1 }),
    );
    expect(await store.deleteVersion('book-1', 1)).toBe(true);
    expect(await store.deleteVersion('book-1', 1)).toBe(false);
    expect(await store.loadVersion('book-1', 1)).toBeUndefined();
  });

  it('按份数清理最旧版本', async () => {
    const store = create();
    for (const version of [1, 2, 3, 4]) {
      await store.saveVersion(
        createSnapshot({
          documentId: 'book-1',
          document: sampleBook(),
          version,
          createdAt: version * 1000,
        }),
      );
    }
    const removed = await store.pruneVersions('book-1', { maxCount: 2, now: 4000 });
    expect(removed).toEqual([1, 2]);
    expect((await store.listVersions('book-1')).map((item) => item.version)).toEqual([3, 4]);
  });

  it('按天数清理过期版本', async () => {
    const store = create();
    for (const [version, createdAt] of [
      [1, 0],
      [2, 10 * DAY],
      [3, 20 * DAY],
    ] as const) {
      await store.saveVersion(
        createSnapshot({ documentId: 'book-1', document: sampleBook(), version, createdAt }),
      );
    }
    const removed = await store.pruneVersions('book-1', { maxAgeDays: 5, now: 20 * DAY });
    expect(removed).toEqual([1, 2]);
  });

  it('快照可回滚（校验和后返回文档）', async () => {
    const store = create();
    const doc = sampleBook();
    await store.saveVersion(
      createSnapshot({ documentId: 'book-1', document: doc, version: 1, createdAt: 1 }),
    );
    const snapshot = await store.loadVersion('book-1', 1);
    if (snapshot === undefined) {
      throw new Error('应能读回版本 1');
    }
    const restored = restoreSnapshot(snapshot);
    expect(restored.ok).toBe(true);
  });
});
