/**
 * 古典直排分页基线
 *
 * 验收清单要求「古籍直排分页总数不变；跨页长段切分位置不变」。
 * 这里用固定尺寸估算器 + 古典版心主轴，锁定总页数与每页块序列——
 * 任何让古典分页漂移的改动（例如仿真能力误扣版心）都会在这里变红。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS, resolvePageMainSize } from '@bibliotype/layout';
import { Reader } from '../reader.js';

/** 古典主题代表性令牌（含版框令牌 → 版心会被扣 6px） */
const TOKENS = { ...DEFAULT_THEME, 'page-border': '3px double #b09a76' };

/** 十个等尺寸段落：每块 100px */
function tenParagraphs(): BookDocument {
  const doc = createEmptyDocument({ title: '基线' });
  doc.root.children = Array.from({ length: 10 }, (_, index) => ({
    type: NODE_TYPES.PARAGRAPH,
    id: `p-${index}`,
    children: [{ type: 'text' as const, text: `第${index + 1}段` }],
  }));
  return doc;
}

describe('古典直排分页基线', () => {
  it('版心主轴仍为「页宽 − 页边距 − 版框」', () => {
    expect(resolvePageMainSize(CLASSICAL_LAYOUT_OPTIONS, TOKENS)).toBe(581);
  });

  it('总页数与每页块序列不变（每页 5 块 × 2 页）', () => {
    const reader = new Reader({
      layout: CLASSICAL_LAYOUT_OPTIONS,
      pageMainSize: resolvePageMainSize(CLASSICAL_LAYOUT_OPTIONS, TOKENS),
      estimator: () => 100,
    });
    reader.loadDocument(tenParagraphs());

    expect(reader.totalPages).toBe(2);
    expect(reader.getPageFragments(0).map((node) => node.id)).toEqual([
      'p-0',
      'p-1',
      'p-2',
      'p-3',
      'p-4',
    ]);
    expect(reader.getPageFragments(1).map((node) => node.id)).toEqual([
      'p-5',
      'p-6',
      'p-7',
      'p-8',
      'p-9',
    ]);
  });

  it('同一文档换成仿真版式前：古典路径不产生版心文本', () => {
    const reader = new Reader({
      layout: CLASSICAL_LAYOUT_OPTIONS,
      pageMainSize: 581,
      estimator: () => 100,
    });
    reader.loadDocument(tenParagraphs());
    expect(reader.getPageGutterTexts(0)).toBeUndefined();
    expect(reader.getPageGutterTexts(1)).toBeUndefined();
  });
});
