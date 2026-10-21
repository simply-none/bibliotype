/**
 * 存储适配器公共契约测试套件（测试专用子入口）
 *
 * 目的：`memory` / `indexeddb` / `sqlite` 共用同一套断言，
 * 避免每个实现各自复制 `sampleDocument()` 与断言导致口径分叉。
 *
 * 用法（在各实现的测试文件里）：
 * ```ts
 * import { runStorageContractTests } from '@bibliotype/core/testing';
 *
 * runStorageContractTests({ name: 'MemoryAdapter', create: () => new MemoryAdapter() });
 * ```
 * 需要跨用例隔离的适配器（如 IndexedDB / SQLite）由 `create` 保证每次返回新实例。
 *
 * 注意：本模块依赖 vitest，只从 `@bibliotype/core/testing` 子入口导出，
 * 主入口 `@bibliotype/core` 不引入它，避免污染生产产物。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../ir/document.js';
import { NODE_TYPES } from '../ir/node-types.js';
import { isBookLibraryStore, isBookSummaryStore } from '../storage/query.js';
import type { BookDocument } from '../ir/document.js';
import type { BookLibraryStore, BookSummaryStore } from '../storage/query.js';
import type { StorageAdapter } from '../storage/types.js';

/** 契约套件可接受的适配器形态（可选能力按需探测） */
export type ContractAdapter = StorageAdapter &
  Partial<BookLibraryStore> &
  Partial<BookSummaryStore>;

/** 契约套件选项 */
export interface StorageContractOptions {
  /** 套件展示名（通常为实现类名） */
  name: string;
  /** 返回一个全新、与其他用例隔离的适配器 */
  create(): ContractAdapter;
}

/** 构造样本文档（标题 + 单段正文） */
export function sampleDocument(title: string, text = '学而时习之'): BookDocument {
  const doc = createEmptyDocument({ title });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      children: [{ type: 'text', text }],
    },
  ];
  return doc;
}

/** 构造带作者 / 标签的样本文档（书架查询用例） */
export function sampleBookDocument(
  title: string,
  author: string,
  tags: string[],
): BookDocument {
  const doc = sampleDocument(title);
  doc.metadata.contributors = [{ name: author }];
  doc.metadata.extra = { tags };
  return doc;
}

/** 运行存储契约测试 */
export function runStorageContractTests(options: StorageContractOptions): void {
  describe(options.name, () => {
    it('save 后 load 往返一致', async () => {
      const adapter = options.create();
      const doc = sampleDocument('论语');
      await adapter.save('book-1', doc);
      await expect(adapter.load('book-1')).resolves.toEqual(doc);
    });

    it('load 未命中返回 undefined（不抛错）', async () => {
      const adapter = options.create();
      await expect(adapter.load('missing')).resolves.toBeUndefined();
    });

    it('save 为覆盖语义，list 按 updatedAt 降序', async () => {
      const adapter = options.create();
      await adapter.save('a', sampleDocument('甲'), { updatedAt: 100 });
      await adapter.save('b', sampleDocument('乙'), { updatedAt: 300 });
      await adapter.save('a', sampleDocument('甲·修订'), { updatedAt: 200 });

      const loaded = await adapter.load('a');
      expect(loaded?.metadata.title).toBe('甲·修订');

      const summaries = await adapter.list();
      expect(summaries.map((item) => item.id)).toEqual(['b', 'a']);
      expect(summaries[0]?.title).toBe('乙');
      expect(summaries[0]?.updatedAt).toBe(300);
    });

    it('list 摘要带字数与派生书目字段', async () => {
      const adapter = options.create();
      await adapter.save('a', sampleBookDocument('论语', '朱熹', ['经部']), {
        updatedAt: 100,
      });

      const [summary] = await adapter.list();
      expect(summary?.author).toBe('朱熹');
      expect(summary?.tags).toEqual(['经部']);
      expect(summary?.wordCount).toBe(5);
    });

    it('delete 返回是否存在并已删除', async () => {
      const adapter = options.create();
      await adapter.save('a', sampleDocument('甲'));

      await expect(adapter.delete('a')).resolves.toBe(true);
      await expect(adapter.delete('a')).resolves.toBe(false);
      await expect(adapter.load('a')).resolves.toBeUndefined();
    });

    it('clear 清空全部', async () => {
      const adapter = options.create();
      await adapter.save('a', sampleDocument('甲'));
      await adapter.save('b', sampleDocument('乙'));

      await adapter.clear();
      await expect(adapter.list()).resolves.toEqual([]);
    });

    it('close 后可继续使用（延迟重开）', async () => {
      const adapter = options.create();
      await adapter.close();
      await adapter.save('c', sampleDocument('丙'), { updatedAt: 10 });
      await adapter.close();
      await expect(adapter.load('c')).resolves.toEqual(sampleDocument('丙'));
    });

    it('可选能力：书架查询端口行为一致', async () => {
      const adapter = options.create();
      if (!isBookLibraryStore(adapter)) {
        return;
      }
      await adapter.save('a', sampleBookDocument('论语集注', '朱熹', ['经部']), {
        updatedAt: 100,
      });
      await adapter.save('b', sampleBookDocument('诗集传', '朱熹', ['经部', '诗']), {
        updatedAt: 200,
      });
      await adapter.save('c', sampleBookDocument('史记', '司马迁', ['史部']), {
        updatedAt: 300,
      });

      const byAuthor = await adapter.query({ text: '朱熹' });
      expect(byAuthor.total).toBe(2);

      const byTag = await adapter.query({ tags: ['史部'] });
      expect(byTag.items.map((item) => item.id)).toEqual(['c']);

      const sorted = await adapter.query({ sortBy: 'title', direction: 'asc' });
      // 码位序：史(53F2) < 论(8BBA) < 诗(8BD7)
      expect(sorted.items.map((item) => item.id)).toEqual(['c', 'a', 'b']);

      const paged = await adapter.query({ limit: 2, offset: 1 });
      expect(paged.total).toBe(3);
      expect(paged.items).toHaveLength(2);

      const grouped = await adapter.query({ groupBy: 'author' });
      expect(grouped.groups.map((group) => group.key)).toEqual(['司马迁', '朱熹']);
    });

    it('可选能力：摘要补丁持久化且保存正文后保留', async () => {
      const adapter = options.create();
      if (!isBookSummaryStore(adapter)) {
        return;
      }
      await adapter.save('a', sampleDocument('甲'), { updatedAt: 100 });

      const patched = await adapter.updateSummary('a', {
        progress: 0.42,
        lastOpenedAt: 500,
        tags: ['在读'],
      });
      expect(patched?.progress).toBe(0.42);
      expect(patched?.lastOpenedAt).toBe(500);
      expect(patched?.tags).toEqual(['在读']);

      // 再存正文：派生字段刷新，用户侧状态保留
      await adapter.save('a', sampleDocument('甲·二稿'), { updatedAt: 600 });
      const [summary] = await adapter.list();
      expect(summary?.title).toBe('甲·二稿');
      expect(summary?.progress).toBe(0.42);
      expect(summary?.lastOpenedAt).toBe(500);
      expect(summary?.tags).toEqual(['在读']);

      await expect(adapter.updateSummary('missing', { progress: 1 })).resolves.toBeUndefined();
    });
  });
}
