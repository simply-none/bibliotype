/**
 * 页眉 / 页脚文本解析测试
 *
 * 关注点：
 * - 未启用时返回 undefined（渲染层据此回退「仅页码」老路径）；
 * - mirror 奇偶页取不同字段；
 * - 章名取「最近的」卷 / 章 / 节 / 标题祖先（含无 id 的路径型块）；
 * - 封面页不标页眉页脚；
 * - 索引构建与逐页回溯结果一致（编辑画布用索引，阅读用回溯）。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import type { PageChromeOptions } from '@bibliotype/layout';
import { Reader } from '../reader.js';
import type { BlockSizeEstimator } from '../document-blocks.js';
import {
  buildPageChromeIndex,
  isNodeInCover,
  resolveChapterTitleForNode,
  resolvePageChromeFields,
  resolvePageChromeTexts,
} from '../page-chrome.js';

/** 固定尺寸估算器：未登记的块取 50 */
function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 封面 + 卷一 >（章 1：标题 + 两段）（章 2：一段） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.COVER,
      id: 'cover',
      children: [{ type: NODE_TYPES.PARAGRAPH, id: 'cover-p', children: [{ type: 'text', text: '论语' }] }],
    },
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
            { type: NODE_TYPES.HEADING, id: 'h-1', children: [{ type: 'text', text: '学而第一' }] },
            { type: NODE_TYPES.PARAGRAPH, id: 'p-1', children: [{ type: 'text', text: '子曰' }] },
            { type: NODE_TYPES.PARAGRAPH, id: 'p-2', children: [{ type: 'text', text: '有朋自远方来' }] },
          ],
        },
        {
          type: NODE_TYPES.CHAPTER,
          id: 'chap-2',
          attrs: { title: '为政第二' },
          children: [
            { type: NODE_TYPES.PARAGRAPH, id: 'p-3', children: [{ type: 'text', text: '为政以德' }] },
          ],
        },
      ],
    },
  ];
  return doc;
}

/** 页眉页脚配置助手 */
function chrome(patch: Partial<PageChromeOptions> = {}): PageChromeOptions {
  return { header: 'bookTitle', footer: 'pageNumber', headerSize: 26, footerSize: 26, ...patch };
}

describe('resolvePageChromeFields', () => {
  it('未开 mirror 时奇偶页都用主配置', () => {
    const config = chrome();
    expect(resolvePageChromeFields(config, 0)).toEqual({
      header: 'bookTitle',
      footer: 'pageNumber',
    });
    expect(resolvePageChromeFields(config, 1)).toEqual({
      header: 'bookTitle',
      footer: 'pageNumber',
    });
  });

  it('开 mirror 时偶数展示页取 *Even，未给则回退主配置', () => {
    const config = chrome({ mirror: true, headerEven: 'chapterTitle' });
    // pageIndex 0 = 第 1 页（奇数展示页）
    expect(resolvePageChromeFields(config, 0).header).toBe('bookTitle');
    // pageIndex 1 = 第 2 页（偶数展示页）
    expect(resolvePageChromeFields(config, 1).header).toBe('chapterTitle');
    expect(resolvePageChromeFields(config, 1).footer).toBe('pageNumber');
  });
});

describe('resolvePageChromeTexts', () => {
  const base = {
    chrome: chrome(),
    bookTitle: '论语',
    chapterTitle: '学而第一',
    pageNumberText: '七',
  };

  it('按字段取文本', () => {
    expect(resolvePageChromeTexts({ ...base, pageIndex: 0 })).toEqual({
      header: '论语',
      footer: '七',
    });
  });

  it('none 字段为空串；内容缺失也退化为空串（渲染层据此不输出该侧）', () => {
    expect(
      resolvePageChromeTexts({
        ...base,
        chrome: chrome({ header: 'none', footer: 'chapterTitle' }),
        chapterTitle: '',
        pageIndex: 0,
      }),
    ).toEqual({ header: '', footer: '' });
  });
});

describe('章名与封面判定', () => {
  const doc = sampleDoc();

  it('取最近的章标题（章内段落 → 本章）', () => {
    expect(resolveChapterTitleForNode(doc.root, 'p-1')).toBe('学而第一');
    expect(resolveChapterTitleForNode(doc.root, 'p-3')).toBe('为政第二');
  });

  it('标题块自身即章名；无结构祖先时为空串', () => {
    expect(resolveChapterTitleForNode(doc.root, 'h-1')).toBe('学而第一');
    expect(resolveChapterTitleForNode(doc.root, 'cover-p')).toBe('');
    expect(resolveChapterTitleForNode(doc.root, 'missing')).toBe('');
  });

  it('封面判定沿祖先链向上匹配 COVER', () => {
    expect(isNodeInCover(doc.root, 'cover-p')).toBe(true);
    expect(isNodeInCover(doc.root, 'p-1')).toBe(false);
  });

  it('索引（面包屑一次遍历）与逐页回溯结果一致', () => {
    const index = buildPageChromeIndex(doc.root);
    for (const id of ['h-1', 'p-1', 'p-2', 'p-3', 'cover-p']) {
      expect(index.chapterTitles.get(id)).toBe(resolveChapterTitleForNode(doc.root, id));
    }
    expect(index.coverBlocks.has('cover-p')).toBe(true);
    expect(index.coverBlocks.has('p-1')).toBe(false);
  });

  it('索引覆盖「无 id 的路径型块」（与 extractBlocks 的 id 口径一致）', () => {
    const loose = sampleDoc();
    // 去掉段落 id，块 id 将退化为树路径
    for (const child of loose.root.children ?? []) {
      for (const grand of child.children ?? []) {
        for (const leaf of grand.children ?? []) delete leaf.id;
      }
    }
    const index = buildPageChromeIndex(loose.root);
    // 卷 (/1) > 章 (/1/0) > 标题/段落 (/1/0/0, /1/0/1, /1/0/2)
    expect(index.chapterTitles.get('/1/0/1')).toBe('学而第一');
    expect(index.chapterTitles.get('/1/1/0')).toBe('为政第二');
  });
});

describe('Reader 页眉页脚接口', () => {
  function createReader(patch: Partial<PageChromeOptions> = {}, pageMainSize = 100) {
    return new Reader({
      pageMainSize,
      layout: patch === undefined ? undefined : { pageChrome: chrome(patch) },
      estimator: fixedEstimator({ 'cover-p': 100, 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 }),
    });
  }

  it('未配置 pageChrome 时 pageChromeEnabled = false、逐页返回 undefined', () => {
    const reader = new Reader({ pageMainSize: 100 });
    reader.loadDocument(sampleDoc());
    expect(reader.pageChromeEnabled).toBe(false);
    expect(reader.getPageChromeTexts(0)).toBeUndefined();
  });

  it('启用后逐页解析书名 / 章名 / 页码（页码走 layout 的样式）', () => {
    const reader = createReader({}, 100);
    reader.loadDocument(sampleDoc());

    expect(reader.pageChromeEnabled).toBe(true);
    // 封面独占第 1 页（100px），不标页眉页脚
    expect(reader.isCoverPage(0)).toBe(true);
    expect(reader.getPageChromeTexts(0)).toBeUndefined();

    // 第 2 页起是正文：页眉书名、页脚页码（decimal）
    const second = reader.getPageChromeTexts(1);
    expect(second?.header).toBe('论语');
    expect(second?.footer).toBe('2');
    expect(reader.getPageChapterTitle(1)).toBe('学而第一');
  });

  it('中文页码样式透传到页脚；mirror 时偶数页页眉换章名', () => {
    const reader = new Reader({
      pageMainSize: 100,
      layout: {
        pageNumberStyle: 'chinese',
        pageChrome: chrome({ mirror: true, headerEven: 'chapterTitle' }),
      },
      estimator: fixedEstimator({ 'cover-p': 100, 'h-1': 30, 'p-1': 60, 'p-2': 60, 'p-3': 100 }),
    });
    reader.loadDocument(sampleDoc());
    // 第 2 页（pageIndex 1）是偶数展示页
    const texts = reader.getPageChromeTexts(1);
    expect(texts?.header).toBe('学而第一');
    expect(texts?.footer).toBe('二');
  });

  it('越界页序不抛错（返回 undefined）', () => {
    const reader = createReader();
    reader.loadDocument(sampleDoc());
    expect(reader.getPageChromeTexts(999)).toBeUndefined();
    expect(reader.getPageChromeTexts(-1)).toBeUndefined();
  });
});
