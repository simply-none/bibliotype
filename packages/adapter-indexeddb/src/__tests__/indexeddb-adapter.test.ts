/**
 * IndexedDbAdapter 测试
 *
 * 通过注入 fake-indexeddb 的 IDBFactory 在 Node 下运行；
 * 每个用例使用独立工厂实例，保证数据库隔离。
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { IndexedDbAdapter } from '../indexeddb-adapter.js';

/** 每个用例独立的适配器（独立工厂 → 独立数据库） */
function createAdapter(): IndexedDbAdapter {
  return new IndexedDbAdapter({
    databaseName: 'bibliotype-test',
    factory: new IDBFactory(),
  });
}

/** 构造样本文档（标题 + 单段正文） */
function sampleDoc(title: string, text = '学而时习之'): BookDocument {
  const doc = createEmptyDocument({ title });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text }],
    },
  ];
  return doc;
}

describe('IndexedDbAdapter', () => {
  it('名称为 indexeddb', () => {
    expect(createAdapter().name).toBe('indexeddb');
  });

  it('save 后 load 往返一致', async () => {
    const adapter = createAdapter();
    const doc = sampleDoc('论语');
    await adapter.save('book-1', doc);
    await expect(adapter.load('book-1')).resolves.toEqual(doc);
  });

  it('load 未命中返回 undefined', async () => {
    const adapter = createAdapter();
    await expect(adapter.load('missing')).resolves.toBeUndefined();
  });

  it('save 为覆盖语义，list 按 updatedAt 降序', async () => {
    const adapter = createAdapter();
    await adapter.save('a', sampleDoc('甲'), { updatedAt: 100 });
    await adapter.save('b', sampleDoc('乙'), { updatedAt: 300 });
    await adapter.save('a', sampleDoc('甲·修订'), { updatedAt: 200 });

    const loaded = await adapter.load('a');
    expect(loaded?.metadata.title).toBe('甲·修订');

    const summaries = await adapter.list();
    expect(summaries).toEqual([
      { id: 'b', title: '乙', updatedAt: 300 },
      { id: 'a', title: '甲·修订', updatedAt: 200 },
    ]);
  });

  it('delete 返回是否存在并已删除', async () => {
    const adapter = createAdapter();
    await adapter.save('a', sampleDoc('甲'));

    await expect(adapter.delete('a')).resolves.toBe(true);
    await expect(adapter.delete('a')).resolves.toBe(false);
    await expect(adapter.load('a')).resolves.toBeUndefined();
  });

  it('clear 清空全部', async () => {
    const adapter = createAdapter();
    await adapter.save('a', sampleDoc('甲'));
    await adapter.save('b', sampleDoc('乙'));

    await adapter.clear();
    await expect(adapter.list()).resolves.toEqual([]);
  });

  it('close 释放连接后可自动重开并保留数据', async () => {
    const adapter = createAdapter();
    // 未打开时 close 为空操作
    await adapter.close();

    await adapter.save('a', sampleDoc('甲'));
    await adapter.close();
    await expect(adapter.load('a')).resolves.toEqual(sampleDoc('甲'));
  });

  it('无 factory 且无全局 indexedDB 时给出明确错误', async () => {
    const adapter = new IndexedDbAdapter();
    await expect(adapter.save('a', sampleDoc('甲'))).rejects.toThrow(
      '当前环境没有 indexedDB',
    );
  });
});
