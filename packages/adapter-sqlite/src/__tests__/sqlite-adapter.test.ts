/**
 * SqliteAdapter 测试
 *
 * 通用行为复用 `@bibliotype/core/testing` 的公共契约套件（与 memory / indexeddb 同口径），
 * 本文件补充 SQLite 特有断言：分片增量、跨实例读取、缺片损坏、clear 边界。
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  NODE_TYPES,
  createEmptyDocument,
  createSnapshot,
  type BookDocument,
  type BookNode,
} from '@bibliotype/core';
import { runStorageContractTests, sampleDocument } from '@bibliotype/core/testing';
import { createSqlJsDriver, type SqliteDriver } from '../driver.js';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { SqliteAssetStore } from '../asset-store.js';
import { SqliteVersionStore } from '../version-store.js';
import { createTestDatabase, scalar } from './helpers/sqljs.js';

/** 加载一次 WASM，各用例用独立内存库 */
const SQL = await initSqlJs({
  locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
});

/** 建一个独立适配器（契约套件的 create 需要同步返回） */
function createAdapter(driver: SqliteDriver = createSqlJsDriver(new SQL.Database())): SqliteAdapter {
  return new SqliteAdapter({ driver, epoch: 1, now: () => 1000 });
}

runStorageContractTests({
  name: 'SqliteAdapter（存储契约）',
  create: () => createAdapter(),
});

/** 造一本多段落大书（用于分片断言） */
function bigDocument(count: number): BookDocument {
  const doc = createEmptyDocument({ title: '分片样本' });
  const children: BookNode[] = [];
  for (let i = 0; i < count; i += 1) {
    children.push({
      type: NODE_TYPES.PARAGRAPH,
      id: `p-${i}`,
      children: [{ type: 'text', text: '字'.repeat(300) }],
    });
  }
  doc.root.children = children;
  return doc;
}

/** 读片 id 列表（升序） */
async function chunkIds(driver: SqliteDriver, docId: string): Promise<string[]> {
  const rows = await driver
    .prepare('SELECT chunk_id FROM chunks WHERE doc_id = ? ORDER BY chunk_id ASC')
    .all<{ chunk_id: string }>([docId]);
  return rows.map((row) => row.chunk_id);
}

describe('SqliteAdapter（SQLite 特有）', () => {
  it('结构不变再保存：片行数与内容都不变', async () => {
    const { driver } = await createTestDatabase();
    const adapter = createAdapter(driver);
    const doc = bigDocument(200);

    await adapter.save('book', doc, { updatedAt: 100 });
    const before = await chunkIds(driver, 'book');
    const countBefore = await scalar(driver, 'SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?', ['book']);
    expect(before.length).toBeGreaterThan(1);

    await adapter.save('book', doc, { updatedAt: 200 });
    expect(await chunkIds(driver, 'book')).toEqual(before);
    expect(await scalar(driver, 'SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?', ['book'])).toBe(countBefore);
  });

  it('只改一个段落：仍能完整读回', async () => {
    const { driver } = await createTestDatabase();
    const adapter = createAdapter(driver);
    const doc = bigDocument(120);
    await adapter.save('book', doc, { updatedAt: 100 });

    const children = doc.root.children as BookNode[];
    const edited: BookDocument = {
      ...doc,
      root: {
        ...doc.root,
        children: children.map((node, index) =>
          index === 60
            ? { ...node, children: [{ type: 'text', text: '改过的一段' }] }
            : node,
        ),
      },
    };
    await adapter.save('book', edited, { updatedAt: 200 });

    const loaded = await adapter.load('book');
    expect(loaded?.root.children?.[60]?.children?.[0]).toMatchObject({ text: '改过的一段' });
    expect(loaded?.metadata.title).toBe('分片样本');
  });

  it('新实例可读旧实例写入的数据（跨会话读取）', async () => {
    const { driver } = await createTestDatabase();
    const first = createAdapter(driver);
    const doc = bigDocument(40);
    await first.save('book', doc, { updatedAt: 500 });

    const second = new SqliteAdapter({ driver, epoch: 2, now: () => 900 });
    expect(await second.load('book')).toEqual(doc);
    const [summary] = await second.list();
    expect(summary?.id).toBe('book');
    expect(summary?.wordCount).toBe(40 * 300);
  });

  it('缺片视为记录损坏：load 返回 undefined', async () => {
    const { driver } = await createTestDatabase();
    const adapter = createAdapter(driver);
    await adapter.save('book', bigDocument(60), { updatedAt: 100 });
    const [firstChunk] = await chunkIds(driver, 'book');
    await driver.prepare('DELETE FROM chunks WHERE doc_id = ? AND chunk_id = ?').run(['book', firstChunk as string]);

    await expect(adapter.load('book')).resolves.toBeUndefined();
  });

  it('delete 级联清理分片，clear 保留资产与历史', async () => {
    const { driver } = await createTestDatabase();
    const adapter = createAdapter(driver);
    const assets = new SqliteAssetStore({ driver });
    const versions = new SqliteVersionStore({ driver });

    await adapter.save('book', sampleDocument('论语'), { updatedAt: 100 });
    await assets.putAsset('cover', { mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) });
    await versions.saveVersion(
      createSnapshot({ documentId: 'book', document: sampleDocument('论语'), version: 1, createdAt: 100 }),
    );

    await expect(adapter.delete('book')).resolves.toBe(true);
    expect(await scalar(driver, 'SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?', ['book'])).toBe(0);

    await adapter.save('book', sampleDocument('论语'), { updatedAt: 200 });
    await adapter.clear();
    expect(await adapter.list()).toEqual([]);
    expect(await assets.listAssets()).toHaveLength(1);
    expect(await versions.listVersions('book')).toHaveLength(1);
  });
});
