/**
 * MemoryAdapter 测试（存储契约行为验证）
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { MemoryAdapter } from '../memory-adapter.js';

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

describe('MemoryAdapter', () => {
  it('名称为 memory', () => {
    expect(new MemoryAdapter().name).toBe('memory');
  });

  it('save 后 load 往返一致', async () => {
    const adapter = new MemoryAdapter();
    const doc = sampleDoc('论语');
    await adapter.save('book-1', doc);
    await expect(adapter.load('book-1')).resolves.toEqual(doc);
  });

  it('load 未命中返回 undefined', async () => {
    const adapter = new MemoryAdapter();
    await expect(adapter.load('missing')).resolves.toBeUndefined();
  });

  it('save 为覆盖语义，updatedAt 可由 options 注入', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save('book-1', sampleDoc('旧题'), { updatedAt: 100 });
    await adapter.save('book-1', sampleDoc('新题'), { updatedAt: 200 });

    const loaded = await adapter.load('book-1');
    expect(loaded?.metadata.title).toBe('新题');
    await expect(adapter.list()).resolves.toEqual([
      { id: 'book-1', title: '新题', updatedAt: 200 },
    ]);
  });

  it('list 按 updatedAt 降序返回摘要', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save('a', sampleDoc('甲'), { updatedAt: 100 });
    await adapter.save('b', sampleDoc('乙'), { updatedAt: 300 });
    await adapter.save('c', sampleDoc('丙'), { updatedAt: 200 });

    const summaries = await adapter.list();
    expect(summaries.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(summaries[0]?.title).toBe('乙');
  });

  it('delete 返回是否存在并已删除', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save('a', sampleDoc('甲'));

    await expect(adapter.delete('a')).resolves.toBe(true);
    await expect(adapter.delete('a')).resolves.toBe(false);
    await expect(adapter.load('a')).resolves.toBeUndefined();
  });

  it('clear 清空全部，close 后仍可继续使用', async () => {
    const adapter = new MemoryAdapter();
    await adapter.save('a', sampleDoc('甲'));
    await adapter.save('b', sampleDoc('乙'));

    await adapter.clear();
    await expect(adapter.list()).resolves.toEqual([]);

    await adapter.close();
    await adapter.save('c', sampleDoc('丙'));
    await expect(adapter.load('c')).resolves.toEqual(sampleDoc('丙'));
  });
});
