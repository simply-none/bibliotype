/**
 * 目录定位测试：扁平化、定位表构建、按页取当前目录项、Reader 端到端。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument, type BookNode } from '@bibliotype/core';
import {
  buildOutlineAnchors,
  collectOutlineKeys,
  findOutlineAnchorAtPage,
  flattenOutline,
  outlineKeyOf,
} from '../outline-query.js';
import { extractOutline } from '../outline.js';
import { Reader } from '../reader.js';
import type { BlockSizeEstimator } from '../document-blocks.js';

/** 构造：书 > 卷一 > 学而（含一节） / 为政 */
function sampleRoot(): BookNode {
  return {
    type: NODE_TYPES.BOOK,
    children: [
      {
        type: NODE_TYPES.VOLUME,
        id: 'vol-1',
        attrs: { title: '卷一' },
        children: [
          {
            type: NODE_TYPES.CHAPTER,
            id: 'chap-1',
            attrs: { title: '学而第一' },
            children: [
              { type: NODE_TYPES.HEADING, id: 'h-1', attrs: { title: '学而第一' } },
              { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰' }] },
              {
                type: NODE_TYPES.SECTION,
                id: 'sec-1',
                attrs: { title: '学而篇上' },
                children: [
                  {
                    type: NODE_TYPES.PARAGRAPH,
                    id: 'p-2',
                    children: [{ type: 'text', text: '有朋' }],
                  },
                ],
              },
            ],
          },
          {
            type: NODE_TYPES.CHAPTER,
            id: 'chap-2',
            attrs: { title: '为政第二' },
            children: [
              { type: NODE_TYPES.HEADING, id: 'h-2', attrs: { title: '为政第二' } },
              { type: NODE_TYPES.PARAGRAPH, id: 'p-3', children: [{ type: 'text', text: '为政' }] },
            ],
          },
        ],
      },
    ],
  };
}

/** 每块固定 100px，页容量 100 → 一块一页，页号可预期 */
function estimator(): BlockSizeEstimator {
  return () => 100;
}

function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = sampleRoot().children ?? [];
  return doc;
}

describe('flattenOutline / collectOutlineKeys', () => {
  it('前序展开，父项先于子项', () => {
    const flat = flattenOutline(extractOutline(sampleRoot()));
    expect(flat.map((item) => item.nodeId)).toEqual([
      'vol-1',
      'chap-1',
      'sec-1',
      'chap-2',
    ]);
  });

  it('无 id 目录项回退路径键，键集与扁平化一一对应', () => {
    const root: BookNode = {
      type: NODE_TYPES.BOOK,
      children: [{ type: NODE_TYPES.HEADING, attrs: { title: '无 id 标题' } }],
    };
    const outline = extractOutline(root);
    expect(outlineKeyOf(outline[0]!)).toBe('/0');
    expect(collectOutlineKeys(outline)).toEqual(['/0']);
  });

  it('自造目录项（缺 nodeId）仍有稳定键', () => {
    const item = { nodeId: undefined, type: 'chapter', title: '自造', level: 0, children: [] };
    expect(outlineKeyOf(item, '0')).toBe('outline:0');
  });
});

describe('buildOutlineAnchors / findOutlineAnchorAtPage', () => {
  const pages: Record<string, number> = {
    'vol-1': 0,
    'chap-1': 0,
    'sec-1': 2,
    'chap-2': 3,
  };
  const anchors = buildOutlineAnchors(extractOutline(sampleRoot()), (key) => pages[key]);

  it('只收录可定位项，按页号升序', () => {
    expect(anchors.map((anchor) => [anchor.key, anchor.pageIndex])).toEqual([
      ['vol-1', 0],
      ['chap-1', 0],
      ['sec-1', 2],
      ['chap-2', 3],
    ]);
  });

  it('同页取最深子项（章优先于卷）', () => {
    expect(findOutlineAnchorAtPage(anchors, 0)?.key).toBe('chap-1');
  });

  it('取起始页不晚于该页的最后一个条目', () => {
    expect(findOutlineAnchorAtPage(anchors, 1)?.key).toBe('chap-1');
    expect(findOutlineAnchorAtPage(anchors, 2)?.key).toBe('sec-1');
    expect(findOutlineAnchorAtPage(anchors, 3)?.key).toBe('chap-2');
    expect(findOutlineAnchorAtPage(anchors, 99)?.key).toBe('chap-2');
  });

  it('首页之前 / 空目录 / 非法页号返回 undefined', () => {
    expect(findOutlineAnchorAtPage([], 0)).toBeUndefined();
    expect(findOutlineAnchorAtPage(anchors, -1)).toBeUndefined();
    expect(findOutlineAnchorAtPage(anchors, 1.5)).toBeUndefined();
    const late = buildOutlineAnchors(extractOutline(sampleRoot()), () => 5);
    expect(findOutlineAnchorAtPage(late, 0)).toBeUndefined();
  });
});

describe('Reader 目录与节点查询', () => {
  it('getPageOfNode 支持叶块与结构容器', () => {
    const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator: estimator() });
    reader.loadDocument(sampleDoc());

    expect(reader.getPageOfNode('vol-1')).toBe(0);
    expect(reader.getPageOfNode('chap-1')).toBe(0);
    expect(reader.getPageOfNode('sec-1')).toBe(2);
    expect(reader.getPageOfNode('chap-2')).toBe(3);
    expect(reader.getPageOfNode('missing')).toBeUndefined();
  });

  it('getOutlineItemAtPage 与翻页同源，同页取最深项', () => {
    const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator: estimator() });
    reader.loadDocument(sampleDoc());

    expect(reader.getOutlineItemAtPage(0)?.nodeId).toBe('chap-1');
    expect(reader.getOutlineItemAtPage(2)?.nodeId).toBe('sec-1');
    expect(reader.getOutlineItemAtPage(3)?.nodeId).toBe('chap-2');
    expect(reader.getOutlineItemAtPage(reader.totalPages - 1)?.nodeId).toBe('chap-2');
    expect(reader.getOutlineItemAtPage(-1)).toBeUndefined();
  });

  it('getOutlineAnchorAtPage 带定位键与层级（目录高亮用 key）', () => {
    const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator: estimator() });
    reader.loadDocument(sampleDoc());

    const anchor = reader.getOutlineAnchorAtPage(2);
    expect(anchor?.key).toBe('sec-1');
    expect(anchor?.item.nodeId).toBe('sec-1');
    expect(anchor?.level).toBe(2);
    expect(reader.getOutlineAnchorAtPage(-1)).toBeUndefined();
  });

  it('重排后定位表随页号更新', () => {
    const reader = new Reader({ pageMainSize: 100, bottomSlack: 0, estimator: estimator() });
    reader.loadDocument(sampleDoc());
    expect(reader.getPageOfNode('chap-2')).toBe(3);

    // 每页容量翻倍 → 目录项页号同步前移（章仍另起页，故为第 3 页）
    reader.repaginate({ pageMainSize: 200 });
    expect(reader.getPageOfNode('chap-2')).toBe(2);
    expect(reader.getOutlineItemAtPage(2)?.nodeId).toBe('chap-2');
  });
});
