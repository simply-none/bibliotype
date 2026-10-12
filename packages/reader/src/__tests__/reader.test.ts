/**
 * Reader 门面测试（分页 / 翻页 / 目录 / 进度 / 事件）
 */
import { describe, expect, it, vi } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { Reader } from '../reader.js';
import type { BlockSizeEstimator } from '../document-blocks.js';

/** 固定尺寸估算器：按节点 id 取尺寸 */
function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 构造：卷 > 章（标题 + 两段） + 章（一段） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
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
            {
              type: NODE_TYPES.HEADING,
              id: 'h-1',
              children: [{ type: 'text', text: '学而第一' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-1',
              children: [{ type: 'text', text: '子曰' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-2',
              children: [{ type: 'text', text: '有朋自远方来' }],
            },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          attrs: { title: '为政第二' },
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              id: 'p-3',
              children: [{ type: 'text', text: '为政以德' }],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

/** 尺寸：h-1=30, p-1=60, p-2=60, p-3=100（页主轴 100） */
function createReader(custom?: { pageMainSize?: number; style?: 'decimal' | 'chinese' }) {
  return new Reader({
    pageMainSize: custom?.pageMainSize ?? 100,
    layout: custom?.style !== undefined ? { pageNumberStyle: custom.style as never } : undefined,
    estimator: fixedEstimator({ 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 }),
  });
}

describe('Reader 载入与分页', () => {
  it('loadDocument 触发 document:load / page:change / toc:ready', () => {
    const reader = createReader();
    const onLoad = vi.fn();
    const onPage = vi.fn();
    const onToc = vi.fn();
    reader.events.on('document:load', onLoad);
    reader.events.on('page:change', onPage);
    reader.events.on('toc:ready', onToc);

    const doc = sampleDoc();
    reader.loadDocument(doc);

    expect(onLoad).toHaveBeenCalledWith({ document: doc });
    expect(onPage).toHaveBeenCalledWith({ pageIndex: 0, totalPages: 3 });
    expect(onToc).toHaveBeenCalledWith({ itemCount: 3 }); // 卷1 + 章2
  });

  it('分页结果：keepWithNext 与 breakBefore 生效', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());

    expect(reader.totalPages).toBe(3);
    // 页1：h-1(30) + p-1(60)（keepWithNext 结伴）
    expect(reader.getPageBlocks(0).map((b) => b.id)).toEqual(['h-1', 'p-1']);
    // 页2：p-2
    expect(reader.getPageBlocks(1).map((b) => b.id)).toEqual(['p-2']);
    // 页3：p-3（章首 breakBefore）
    expect(reader.getPageBlocks(2).map((b) => b.id)).toEqual(['p-3']);
  });

  it('目录层级与标题正确', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    expect(reader.outline[0]?.title).toBe('卷一');
    expect(reader.outline[0]?.children.map((c) => c.title)).toEqual([
      '学而第一',
      '为政第二',
    ]);
  });

  it('未载入文档时重排抛出错误', () => {
    const reader = createReader();
    expect(() => reader.repaginate()).toThrow('尚未载入文档');
  });
});

describe('Reader 导航与进度', () => {
  it('nextPage / prevPage / goToPage 边界', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());

    expect(reader.currentPage).toBe(0);
    expect(reader.prevPage()).toBe(false); // 已在首页
    expect(reader.nextPage()).toBe(true);
    expect(reader.currentPage).toBe(1);
    expect(reader.goToPage(99)).toBe(false); // 越界
    expect(reader.goToPage(1)).toBe(false); // 同一页不重复触发
    expect(reader.goToPage(2)).toBe(true);
    expect(reader.nextPage()).toBe(false); // 已在末页
  });

  it('翻页触发 page:change 事件', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    const onPage = vi.fn();
    reader.events.on('page:change', onPage);

    reader.nextPage();
    expect(onPage).toHaveBeenCalledWith({ pageIndex: 1, totalPages: 3 });
  });

  it('goToNode 按节点 id 跳页', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());

    expect(reader.goToNode('p-3')).toBe(true);
    expect(reader.currentPage).toBe(2);
    expect(reader.goToNode('不存在')).toBe(false);
  });

  it('goToNode 支持结构容器 id（定位首叶所在页）', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());

    expect(reader.goToNode('chap-2')).toBe(true);
    expect(reader.currentPage).toBe(2);
    expect(reader.goToNode('vol-1')).toBe(true);
    expect(reader.currentPage).toBe(0);
  });

  it('progress 按已读至页尾计算', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    expect(reader.progress).toBeCloseTo(1 / 3);
    reader.goToPage(2);
    expect(reader.progress).toBe(1);
  });

  it('页码按配置样式格式化', () => {
    const reader = createReader({ style: 'chinese' });
    reader.loadDocument(sampleDoc());
    expect(reader.formatCurrentPageNumber()).toBe('一');
    reader.nextPage();
    expect(reader.formatCurrentPageNumber()).toBe('二');
  });
});

describe('Reader 页节点解析', () => {
  it('getPageNodes 还原页内节点并与分页一致', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());

    expect(reader.getPageNodes(0).map((node) => node.id)).toEqual(['h-1', 'p-1']);
    expect(reader.getPageNodes(1).map((node) => node.id)).toEqual(['p-2']);
    expect(reader.getPageNodes(2).map((node) => node.type)).toEqual([
      NODE_TYPES.PARAGRAPH,
    ]);
  });

  it('未载入或越界页返回空数组', () => {
    const reader = createReader();
    expect(reader.getPageNodes(0)).toEqual([]);
    reader.loadDocument(sampleDoc());
    expect(reader.getPageNodes(99)).toEqual([]);
  });
});

describe('Reader 重排', () => {
  it('扩大页主轴后页数减少且当前页收敛', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    reader.goToPage(2);

    const onPage = vi.fn();
    reader.events.on('page:change', onPage);

    reader.repaginate({ pageMainSize: 500 });
    // h-1/p-1/p-2 并为一页，p-3 因章首 breakBefore 仍独占一页
    expect(reader.totalPages).toBe(2);
    // 原第 3 页收敛到末页
    expect(reader.currentPage).toBe(1);
    expect(onPage).toHaveBeenCalledWith({ pageIndex: 1, totalPages: 2 });
  });

  it('切换竖排布局后布局配置生效', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    reader.repaginate({ layout: { writingMode: 'vertical-rl' } });
    expect(reader.layout.writingMode).toBe('vertical-rl');
  });

  it('空文档分页为 0 页且进度为 0', () => {
    const reader = createReader();
    reader.loadDocument(createEmptyDocument({ title: '空书' }));
    expect(reader.totalPages).toBe(0);
    expect(reader.progress).toBe(0);
    expect(reader.nextPage()).toBe(false);
  });
});
