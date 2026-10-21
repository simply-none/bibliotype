/**
 * 书架摘要与查询：派生字段、旧数据回退、检索 / 排序 / 分组 / 分页。
 */
import { describe, expect, it } from 'vitest';
import type { BookMetadata } from '../ir/metadata.js';
import {
  buildDocumentSummary,
  carryOverSummaryFields,
  clampProgress,
  isDocumentSummary,
  mergeDocumentSummary,
  normalizeTags,
  summaryAuthor,
  summaryIsbn,
  summaryTagsFromMetadata,
} from '../storage/library.js';
import {
  DOCUMENT_GROUP_KEYS,
  DOCUMENT_SORT_KEYS,
  SORT_DIRECTIONS,
  defaultDirection,
  groupDocumentSummaries,
  isBookLibraryStore,
  isBookSummaryStore,
  matchesDocumentQuery,
  queryDocumentSummaries,
  sortDocumentSummaries,
  splitQueryTokens,
} from '../storage/query.js';
import type { DocumentSummary } from '../storage/types.js';

function metadata(patch: Partial<BookMetadata> = {}): BookMetadata {
  return { title: '论语集注', ...patch };
}

function summary(patch: Partial<DocumentSummary> = {}): DocumentSummary {
  return { id: 'a', title: '论语集注', updatedAt: 100, ...patch };
}

describe('buildDocumentSummary', () => {
  it('派生作者、ISBN、标签与显式字段', () => {
    const built = buildDocumentSummary({
      id: 'book-1',
      metadata: metadata({
        contributors: [{ name: ' 朱熹 ' }],
        identifiers: [
          { scheme: 'doi', value: '10.1/x' },
          { scheme: 'isbn', value: '978-7-101-00001-1' },
        ],
      }),
      updatedAt: 1_700_000_000_000,
      wordCount: 12345,
      progress: 0.4,
      lastOpenedAt: 1_700_000_100_000,
      coverThumbnail: 'asset:cover-1',
      tags: ['经部', ' 经部 ', ''],
    });

    expect(built).toEqual({
      id: 'book-1',
      title: '论语集注',
      updatedAt: 1_700_000_000_000,
      author: '朱熹',
      isbn: '978-7-101-00001-1',
      tags: ['经部'],
      coverThumbnail: 'asset:cover-1',
      wordCount: 12345,
      progress: 0.4,
      lastOpenedAt: 1_700_000_100_000,
    });
  });

  it('缺字段时不写入空值（旧数据回退的前提）', () => {
    const built = buildDocumentSummary({
      id: 'book-2',
      metadata: metadata(),
      updatedAt: 1,
    });
    expect(built).toEqual({ id: 'book-2', title: '论语集注', updatedAt: 1 });
    expect('author' in built).toBe(false);
    expect('tags' in built).toBe(false);
  });

  it('标签缺省改读 metadata.extra.tags，非字符串项忽略', () => {
    expect(summaryTagsFromMetadata(metadata({ extra: { tags: ['史部', 1, '史部'] } }))).toEqual([
      '史部',
    ]);
    expect(summaryTagsFromMetadata(metadata())).toBeUndefined();
  });

  it('作者 / ISBN 无有效值时返回 undefined', () => {
    expect(summaryAuthor(metadata({ contributors: [{ name: '  ' }] }))).toBeUndefined();
    expect(summaryIsbn(metadata({ identifiers: [{ scheme: 'doi', value: '10.1/x' }] }))).toBeUndefined();
  });
});

describe('normalizeTags / clampProgress', () => {
  it('去空白、去重、截断超长与超量', () => {
    expect(normalizeTags([' 甲 ', '甲', '乙'])).toEqual(['甲', '乙']);
    expect(normalizeTags([])).toBeUndefined();
    expect(normalizeTags(['x'.repeat(40)])?.[0]).toHaveLength(32);
    expect(normalizeTags(Array.from({ length: 30 }, (_v, index) => `t${index}`))).toHaveLength(20);
  });

  it('进度夹取到 0–1，非法值返回 undefined', () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress(0.5)).toBe(0.5);
    expect(clampProgress(Number.NaN)).toBeUndefined();
    expect(clampProgress(undefined)).toBeUndefined();
  });
});

describe('mergeDocumentSummary / carryOverSummaryFields', () => {
  it('补丁 undefined 表示不修改，空数组清空标签', () => {
    const base = summary({ tags: ['经部'], progress: 0.2 });
    expect(mergeDocumentSummary(base, { progress: 0.8 })).toEqual({
      ...base,
      progress: 0.8,
    });
    expect(mergeDocumentSummary(base, { tags: [] }).tags).toBeUndefined();
  });

  it('保存正文时延续用户侧状态，派生字段以新值为准', () => {
    const previous = summary({
      progress: 0.5,
      lastOpenedAt: 900,
      coverThumbnail: 'asset:c',
      tags: ['在读'],
    });
    const next = summary({ title: '新题', updatedAt: 1000, wordCount: 99 });
    expect(carryOverSummaryFields(previous, next)).toEqual({
      id: 'a',
      title: '新题',
      updatedAt: 1000,
      wordCount: 99,
      progress: 0.5,
      lastOpenedAt: 900,
      coverThumbnail: 'asset:c',
      tags: ['在读'],
    });
    expect(carryOverSummaryFields(undefined, next)).toEqual(next);
  });

  it('isDocumentSummary 只校验必备字段', () => {
    expect(isDocumentSummary(summary())).toBe(true);
    expect(isDocumentSummary({ id: 'a', title: 't' })).toBe(false);
    expect(isDocumentSummary(null)).toBe(false);
  });
});

describe('queryDocumentSummaries', () => {
  const books: DocumentSummary[] = [
    summary({ id: 'a', title: '论语集注', author: '朱熹', tags: ['经部'], updatedAt: 100, wordCount: 80000 }),
    summary({ id: 'b', title: '诗集传', author: '朱熹', tags: ['经部', '诗'], updatedAt: 300, wordCount: 50000 }),
    summary({ id: 'c', title: '史记', author: '司马迁', tags: ['史部'], updatedAt: 200, wordCount: 500000 }),
  ];

  it('检索词全部命中（AND），覆盖标题 / 作者 / 标签 / ISBN', () => {
    expect(queryDocumentSummaries(books, { text: '朱熹' }).total).toBe(2);
    expect(queryDocumentSummaries(books, { text: '朱熹 经部' }).total).toBe(2);
    expect(queryDocumentSummaries(books, { text: '朱熹 史部' }).total).toBe(0);
    expect(splitQueryTokens('  Zhu  熹 ')).toEqual(['zhu', '熹']);

    const withIsbn = summary({ id: 'd', isbn: '978-7-101', title: '某书' });
    expect(matchesDocumentQuery(withIsbn, { text: '978-7-101' })).toBe(true);
  });

  it('标签筛选为 OR', () => {
    expect(queryDocumentSummaries(books, { tags: ['诗', '史部'] }).total).toBe(2);
  });

  it('默认按最近阅读降序，缺 lastOpenedAt 回落 updatedAt', () => {
    const result = queryDocumentSummaries(books);
    expect(result.items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(defaultDirection(DOCUMENT_SORT_KEYS.RECENT_READ)).toBe(SORT_DIRECTIONS.DESC);

    const withRecent = books.map((item) =>
      item.id === 'a' ? { ...item, lastOpenedAt: 999 } : item,
    );
    expect(sortDocumentSummaries(withRecent).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('按字数 / 标题排序，同值按 id 稳定', () => {
    expect(
      sortDocumentSummaries(books, { sortBy: DOCUMENT_SORT_KEYS.WORD_COUNT }).map((item) => item.id),
    ).toEqual(['c', 'a', 'b']);
    // 码位序：史(53F2) < 论(8BBA) < 诗(8BD7)
    expect(
      sortDocumentSummaries(books, { sortBy: DOCUMENT_SORT_KEYS.TITLE }).map((item) => item.id),
    ).toEqual(['c', 'a', 'b']);
    expect(
      sortDocumentSummaries(
        [summary({ id: 'z' }), summary({ id: 'y' })],
        { sortBy: DOCUMENT_SORT_KEYS.TITLE, direction: SORT_DIRECTIONS.ASC },
      ).map((item) => item.id),
    ).toEqual(['y', 'z']);
  });

  it('分页返回总数与当前页', () => {
    const result = queryDocumentSummaries(books, { limit: 2, offset: 1 });
    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.id)).toEqual(['c', 'a']);
    expect(queryDocumentSummaries(books, { limit: 0 }).items).toEqual([]);
  });

  it('分组：单组 / 标签（可多组）/ 作者（缺省未署名）', () => {
    expect(groupDocumentSummaries(books, DOCUMENT_GROUP_KEYS.NONE)[0]?.label).toBe('全部');
    const byTag = groupDocumentSummaries(books, DOCUMENT_GROUP_KEYS.TAG);
    expect(byTag.map((group) => group.key)).toEqual(['经部', '诗', '史部']);
    expect(byTag[0]?.items).toHaveLength(2);

    const byAuthor = groupDocumentSummaries(
      [summary({ id: 'x', title: '佚名书' }), ...books],
      DOCUMENT_GROUP_KEYS.AUTHOR,
    );
    expect(byAuthor.map((group) => group.key)).toEqual(['未署名', '朱熹', '司马迁']);
  });
});

describe('端口探测', () => {
  it('query 与 updateSummary 分开探测', () => {
    const queryOnly = { name: 'http', query: async () => ({ items: [], total: 0, groups: [] }) };
    expect(isBookLibraryStore(queryOnly)).toBe(true);
    expect(isBookSummaryStore(queryOnly)).toBe(false);

    const patchOnly = { name: 'x', updateSummary: async () => undefined };
    expect(isBookLibraryStore(patchOnly)).toBe(false);
    expect(isBookSummaryStore(patchOnly)).toBe(true);

    expect(isBookLibraryStore(null)).toBe(false);
  });
});
