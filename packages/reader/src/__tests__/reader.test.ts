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

  it('规范形态的版式文本容器整体渲染并可定位（编辑保存后注文样式回归）', () => {
    const doc = createEmptyDocument({ title: '注文' });
    doc.root.children = [
      {
        type: NODE_TYPES.CHAPTER,
        id: 'chap-1',
        children: [
          {
            type: 'double-note',
            id: 'note-1',
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [{ type: 'text', text: '朱子曰' }],
              },
            ],
          },
        ],
      },
    ];
    const reader = new Reader();
    reader.loadDocument(doc);

    /* 页节点为容器本身（渲染端连 bt-double-note class 一并序列化） */
    expect(reader.getPageNodes(0).map((node) => node.id)).toEqual(['note-1']);
    /* 搜索命中容器 id；goToNode 可按 id 定位 */
    expect(reader.search('朱子曰')[0]?.nodeId).toBe('note-1');
    expect(reader.goToNode('note-1')).toBe(true);
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

  it('未显式给定 pageMainSize 时随布局重算', () => {
    const reader = new Reader({
      estimator: fixedEstimator({ 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 }),
    });
    reader.loadDocument(sampleDoc());
    // 默认 A5 横排：794 - 48×2 = 698
    expect(reader.pageMainSizePx).toBe(698);

    // 换 A4（1123 - 48×2 = 1027）→ pageMainSize 随之重算
    reader.repaginate({ layout: { pageSize: { name: 'A4', width: 794, height: 1123 } } });
    expect(reader.pageMainSizePx).toBe(1027);

    // 切直排 → 取内容区宽度（794 - 56×2 = 682）
    reader.repaginate({ layout: { writingMode: 'vertical-rl' } });
    expect(reader.pageMainSizePx).toBe(682);
  });

  it('显式给定 pageMainSize 时不随布局重算', () => {
    const reader = new Reader({ pageMainSize: 100, estimator: fixedEstimator({}) });
    reader.loadDocument(sampleDoc());
    reader.repaginate({ layout: { pageSize: { name: 'A4', width: 794, height: 1123 } } });
    expect(reader.pageMainSizePx).toBe(100);
  });

  it('blockSizes 实测尺寸参与分页（影响页数）', () => {
    const estimator = fixedEstimator({ 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 });
    // 无实测：h-1+p-1(60) 同页 → 3 页
    const estimated = new Reader({ pageMainSize: 100, estimator });
    estimated.loadDocument(sampleDoc());
    expect(estimated.totalPages).toBe(3);

    // p-1 实测 200（超页）→ 独占一页 → 4 页
    const measured = new Reader({
      pageMainSize: 100,
      estimator,
      blockSizes: new Map([['p-1', 200]]),
    });
    measured.loadDocument(sampleDoc());
    expect(measured.totalPages).toBe(4);

    // 清空实测（传 null）→ 回退估算 → 回到 3 页
    measured.repaginate({ blockSizes: null });
    expect(measured.totalPages).toBe(3);
  });

  it('空文档分页为 0 页且进度为 0', () => {
    const reader = createReader();
    reader.loadDocument(createEmptyDocument({ title: '空书' }));
    expect(reader.totalPages).toBe(0);
    expect(reader.progress).toBe(0);
    expect(reader.nextPage()).toBe(false);
  });

  it('repaginate 支持 measure 覆盖（默认估算器联动重排）', () => {
    const reader = new Reader({ pageMainSize: 200 });
    reader.loadDocument(sampleDoc());
    const before = reader.totalPages;

    reader.repaginate({ measure: { charsPerLine: 1 } });
    expect(reader.totalPages).toBeGreaterThan(before);
  });
});

describe('Reader 结构页', () => {
  it('封面/书名页/版权页/目录/序/附录/后记各自独立起页', () => {
    const doc = createEmptyDocument({ title: '结构页' });
    const pageChild = (type: string, id: string) => ({
      type,
      id,
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: `${id}-p`, children: [{ type: 'text', text: '内容' }] },
      ],
    });
    doc.root.children = [
      pageChild(NODE_TYPES.COVER, 'cover'),
      pageChild(NODE_TYPES.TITLE_PAGE, 'title'),
      pageChild(NODE_TYPES.COPYRIGHT_PAGE, 'copyright'),
      pageChild(NODE_TYPES.TOC, 'toc'),
      pageChild(NODE_TYPES.PREFACE, 'preface'),
      pageChild(NODE_TYPES.APPENDIX, 'appendix'),
      pageChild(NODE_TYPES.POSTSCRIPT, 'postscript'),
      pageChild(NODE_TYPES.BACK_COVER, 'back'),
    ];

    const reader = new Reader();
    reader.loadDocument(doc);

    expect(reader.totalPages).toBe(8);
    expect(reader.getPageBlocks(0).map((b) => b.id)).toEqual(['cover-p']);
    expect(reader.getPageBlocks(1).map((b) => b.id)).toEqual(['title-p']);
    expect(reader.getPageBlocks(7).map((b) => b.id)).toEqual(['back-p']);
  });

  it('结构容器级 goToNode 可按页锚点跳转', () => {
    const doc = createEmptyDocument({ title: '结构页' });
    doc.root.children = [
      {
        type: NODE_TYPES.COVER,
        id: 'cover',
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'cover-p', children: [{ type: 'text', text: '论语' }] },
        ],
      },
      {
        type: NODE_TYPES.COPYRIGHT_PAGE,
        id: 'copyright',
        children: [
          { type: NODE_TYPES.PARAGRAPH, id: 'cp-p', children: [{ type: 'text', text: '版权' }] },
        ],
      },
    ];
    const reader = new Reader();
    reader.loadDocument(doc);

    expect(reader.goToNode('copyright')).toBe(true);
    expect(reader.currentPage).toBe(1);
  });
});

describe('Reader 搜索', () => {
  it('按块级文本命中并返回页号/类型/摘录/次数', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());

    const results = reader.search('子曰');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      nodeId: 'p-1',
      pageIndex: 0,
      blockType: NODE_TYPES.PARAGRAPH,
      excerpt: '子曰',
      matchCount: 1,
    });
  });

  it('limit 截断、空查询返回空，matchCount 统计块内多次命中', () => {
    const doc = createEmptyDocument({ title: '搜索样本' });
    doc.root.children = [
      { type: NODE_TYPES.PARAGRAPH, id: 'a', children: [{ type: 'text', text: '甲甲' }] },
      { type: NODE_TYPES.PARAGRAPH, id: 'b', children: [{ type: 'text', text: '乙甲' }] },
    ];
    const reader = new Reader();
    reader.loadDocument(doc);

    expect(reader.search('  ')).toEqual([]);
    expect(reader.search('甲')).toHaveLength(2);
    expect(reader.search('甲')[0]?.matchCount).toBe(2);
    expect(reader.search('甲', { limit: 1 })).toHaveLength(1);
  });

  it('摘录按上下文半径截窗并标记省略', () => {
    const doc = createEmptyDocument({ title: '摘录' });
    doc.root.children = [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: 'long',
        children: [{ type: 'text', text: '一二三四五六七八九十甲乙丙丁' }],
      },
    ];
    const reader = new Reader();
    reader.loadDocument(doc);

    const [hit] = reader.search('甲', { contextLength: 2 });
    expect(hit?.excerpt).toBe('…九十甲乙丙…');
  });
});
