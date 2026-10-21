import { describe, expect, it } from 'vitest';
import { createSnapshot } from '@bibliotype/core';
import { sampleDocument } from '@bibliotype/core/testing';
import { SqliteVersionStore } from '../version-store.js';
import { createTestDatabase } from './helpers/sqljs.js';

describe('SqliteVersionStore', () => {
  it('保存 / 列表 / 读取 / 删除', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteVersionStore({ driver });
    const doc = sampleDocument('论语');
    const first = createSnapshot({
      documentId: 'lunyu',
      document: doc,
      version: 1,
      createdAt: 100,
      label: '初稿',
    });

    const meta = await store.saveVersion(first);
    expect(meta).toEqual({ documentId: 'lunyu', version: 1, createdAt: 100, label: '初稿' });
    expect(await store.listVersions('lunyu')).toEqual([meta]);
    expect(await store.loadVersion('lunyu', 1)).toEqual(first);
    expect(await store.loadVersion('lunyu', 99)).toBeUndefined();

    await expect(store.deleteVersion('lunyu', 1)).resolves.toBe(true);
    await expect(store.deleteVersion('lunyu', 1)).resolves.toBe(false);
  });

  it('同版本覆盖：列表不重复', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteVersionStore({ driver });
    const doc = sampleDocument('论语');

    await store.saveVersion(
      createSnapshot({ documentId: 'lunyu', document: doc, version: 1, createdAt: 100 }),
    );
    await store.saveVersion(
      createSnapshot({
        documentId: 'lunyu',
        document: sampleDocument('论语', '改过的正文'),
        version: 1,
        createdAt: 200,
        label: '覆盖',
      }),
    );

    const list = await store.listVersions('lunyu');
    expect(list).toHaveLength(1);
    expect(list[0]?.label).toBe('覆盖');
    expect((await store.loadVersion('lunyu', 1))?.document.metadata.title).toBe('论语');
  });

  it('按份数清理：保留最近 N 份，返回被删版本', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteVersionStore({ driver });
    for (let version = 1; version <= 3; version += 1) {
      await store.saveVersion(
        createSnapshot({
          documentId: 'lunyu',
          document: sampleDocument('论语'),
          version,
          createdAt: version * 100,
        }),
      );
    }

    const removed = await store.pruneVersions('lunyu', { maxCount: 2, now: 1000 });
    expect(removed).toEqual([1]);
    expect((await store.listVersions('lunyu')).map((meta) => meta.version)).toEqual([2, 3]);
  });

  it('按天数清理：过期快照全部删除', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteVersionStore({ driver });
    const day = 24 * 60 * 60 * 1000;
    await store.saveVersion(
      createSnapshot({ documentId: 'd', document: sampleDocument('甲'), version: 1, createdAt: 0 }),
    );
    await store.saveVersion(
      createSnapshot({
        documentId: 'd',
        document: sampleDocument('甲'),
        version: 2,
        createdAt: 10 * day,
      }),
    );

    /* 版本 2 只有半天，未超过 1 天；版本 1 已 10 天 */
    const removed = await store.pruneVersions('d', { maxAgeDays: 1, now: 10 * day + day / 2 });
    expect(removed).toEqual([1]);
    expect((await store.listVersions('d')).map((meta) => meta.version)).toEqual([2]);
  });

  it('非法保留策略拒绝执行（RangeError）', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteVersionStore({ driver });

    await expect(store.pruneVersions('d', { maxCount: 0, now: 1 })).rejects.toThrow(RangeError);
    await expect(store.pruneVersions('d', { now: 1 })).rejects.toThrow(RangeError);
  });

  it('列表按版本升序且不读取正文（脏元信息被跳过）', async () => {
    const { driver } = await createTestDatabase();
    const store = new SqliteVersionStore({ driver });
    await store.saveVersion(
      createSnapshot({ documentId: 'd', document: sampleDocument('甲'), version: 2, createdAt: 20 }),
    );
    await store.saveVersion(
      createSnapshot({ documentId: 'd', document: sampleDocument('甲'), version: 1, createdAt: 10 }),
    );
    await driver
      .prepare('INSERT INTO versions (doc_id, version, meta, snapshot, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(['d', 3, 'not-json', '{}', 30]);

    expect((await store.listVersions('d')).map((meta) => meta.version)).toEqual([1, 2]);
  });
});
