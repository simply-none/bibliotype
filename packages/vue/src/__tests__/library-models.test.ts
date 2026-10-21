/**
 * 书架 / 修订 / 版本模型（纯函数）测试。
 */
import { describe, expect, it } from 'vitest';
import { MARK_TYPES } from '@bibliotype/core';
import type { DocumentDiff, DocumentSummary, RevisionEntry } from '@bibliotype/core';
import {
  buildShelfCard,
  buildShelfCards,
  buildTagFacets,
  emptyShelfHint,
  formatRelativeTime,
  formatWordCount,
  normalizeProgress,
  titleGlyph,
} from '../book-shelf-model.js';
import { buildRevisionModel, excerptText, revisionCountsText } from '../revision-model.js';
import {
  buildDiffRows,
  buildVersionHistoryModel,
  diffSummaryText,
  versionGroupOf,
  versionTimeText,
} from '../version-model.js';

const NOW = new Date('2026-10-21T12:00:00').getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;

function summary(patch: Partial<DocumentSummary> = {}): DocumentSummary {
  return { id: 'a', title: '论语集注', updatedAt: NOW - HOUR, ...patch };
}

describe('书架模型', () => {
  it('字数缩写', () => {
    expect(formatWordCount(0)).toBe('0 字');
    expect(formatWordCount(9800)).toBe('9800 字');
    expect(formatWordCount(12_345)).toBe('1.2 万字');
    expect(formatWordCount(1_500_000)).toBe('150 万字');
    expect(formatWordCount(undefined)).toBe('—');
  });

  it('相对时间：刚刚 / 分钟 / 小时 / 天 / 日期 / 未读', () => {
    expect(formatRelativeTime(NOW - 1000, NOW)).toBe('刚刚');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe('3 小时前');
    expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe('3 天前');
    expect(formatRelativeTime(NOW - 60 * DAY, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatRelativeTime(undefined, NOW)).toBe('未读');
  });

  it('进度归一与封面占位字', () => {
    expect(normalizeProgress(0.426)).toBe(43);
    expect(normalizeProgress(-1)).toBe(0);
    expect(normalizeProgress(3)).toBe(100);
    expect(normalizeProgress(undefined)).toBe(0);
    expect(titleGlyph('  论语 ')).toBe('论');
    expect(titleGlyph('')).toBe('书');
  });

  it('卡片字段：作者缺省、进度与最近阅读', () => {
    const card = buildShelfCard(
      summary({ tags: ['经部'], wordCount: 12_000, progress: 0.32 }),
      NOW,
    );
    expect(card.authorText).toBe('未署名');
    expect(card.metaText).toBe('未署名 · 1.2 万字');
    expect(card.progressText).toBe('32%');
    expect(card.recentText).toBe('1 小时前');
    expect(card.tags).toEqual(['经部']);
    expect(card.coverThumbnail).toBeUndefined();
  });

  it('批量卡片保留顺序', () => {
    const cards = buildShelfCards(
      [summary({ id: 'a', title: '甲' }), summary({ id: 'b', title: '乙' })],
      { now: NOW },
    );
    expect(cards.map((card) => card.title)).toEqual(['甲', '乙']);
  });

  it('标签统计按次数降序，同数按名称升序', () => {
    const facets = buildTagFacets([
      summary({ tags: ['经部', '诗'] }),
      summary({ tags: ['经部'] }),
      summary({ tags: ['史部'] }),
      summary({}),
    ]);
    expect(facets).toEqual([
      { tag: '经部', count: 2 },
      { tag: '史部', count: 1 },
      { tag: '诗', count: 1 },
    ]);
  });

  it('空库提示区分检索与真空库', () => {
    expect(emptyShelfHint({ hasQuery: true })).toContain('没有匹配');
    expect(emptyShelfHint({ hasQuery: false })).toContain('导入第一本书');
  });
});

describe('修订侧栏模型', () => {
  const entries: RevisionEntry[] = [
    { changeId: 'c1', type: MARK_TYPES.INSERTION, author: '甲', timestamp: NOW - HOUR, text: '新增的一句', path: 'root.children[0]' },
    { changeId: 'c2', type: MARK_TYPES.DELETION, author: '乙', timestamp: NOW - 2 * DAY, text: '删除的一句', path: 'root.children[1]' },
    { changeId: 'c3', type: MARK_TYPES.FORMAT_CHANGE, text: '加粗', path: 'root.children[2]' },
  ];

  it('统计与参与者', () => {
    const model = buildRevisionModel(entries, { now: NOW });
    expect(model.counts).toEqual({ insertion: 1, deletion: 1, formatChange: 1 });
    expect(model.total).toBe(3);
    expect(model.authors).toEqual(['甲', '乙', '匿名']);
    expect(model.empty).toBe(false);
    expect(revisionCountsText(model.counts)).toBe('插 1 · 删 1 · 格式 1');
  });

  it('条目文案与类型中文名', () => {
    const model = buildRevisionModel(entries, { now: NOW });
    expect(model.items[0]?.typeLabel).toBe('插入');
    expect(model.items[0]?.timeText).toBe('1 小时前');
    expect(model.items[2]?.authorText).toBe('匿名');
    expect(model.items[2]?.timeText).toBe('未读');
  });

  it('摘要截断', () => {
    const long = '甲'.repeat(60);
    expect([...excerptText(long)]).toHaveLength(41);
    expect(excerptText('  短句  ')).toBe('短句');
  });

  it('空数组给出空态', () => {
    const model = buildRevisionModel([], { now: NOW });
    expect(model.empty).toBe(true);
    expect(model.total).toBe(0);
  });
});

describe('版本历史模型', () => {
  it('按今日 / 昨日 / 更早分组（版本降序）', () => {
    const model = buildVersionHistoryModel(
      [
        { documentId: 'a', version: 1, createdAt: NOW - 5 * DAY },
        { documentId: 'a', version: 2, createdAt: NOW - DAY },
        { documentId: 'a', version: 3, createdAt: NOW - HOUR, label: '投稿前' },
      ],
      { now: NOW, activeVersion: 2 },
    );
    expect(model.total).toBe(3);
    expect(model.groups.map((group) => group.key)).toEqual(['today', 'yesterday', 'earlier']);
    expect(model.groups[0]?.items[0]?.label).toBe('投稿前');
    expect(model.groups[0]?.items[0]?.active).toBe(false);
    expect(model.groups[1]?.items[0]?.active).toBe(true);
  });

  it('空历史给出空态', () => {
    expect(buildVersionHistoryModel([], { now: NOW }).empty).toBe(true);
  });

  it('分组与时间文案', () => {
    expect(versionGroupOf(NOW, NOW)).toBe('today');
    expect(versionGroupOf(NOW - DAY, NOW)).toBe('yesterday');
    expect(versionGroupOf(NOW - 5 * DAY, NOW)).toBe('earlier');
    expect(versionTimeText(NOW, NOW)).toMatch(/^\d{2}:\d{2}$/);
    expect(versionTimeText(NOW - 5 * DAY, NOW)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('差异行与汇总文案', () => {
    const diff: DocumentDiff = {
      changes: [
        { kind: 'added', path: 'root.children[1]', after: '新增段' },
        { kind: 'removed', path: 'root.children[2]', before: '删除段' },
        { kind: 'modified', path: 'root.children[0]', before: '旧', after: '新' },
      ],
      added: 1,
      removed: 1,
      modified: 1,
    };
    expect(diffSummaryText(diff)).toBe('+1 −1 ~1');
    const rows = buildDiffRows(diff);
    expect(rows.map((row) => row.kindLabel)).toEqual(['新增', '删除', '修改']);
    expect(rows[1]?.beforeText).toBe('删除段');
    expect(rows[1]?.afterText).toBe('');
  });
});
