/**
 * 版心（书口）文本解析与 Reader 接口测试
 *
 * 关注点：
 * - 未配置版心时恒为 undefined（「古籍直排 / 现代横排」渲染路径零变化）；
 * - 封面页不显示版心（与页眉页脚同规则）；
 * - 篇卷取最近的章节祖先，叶次沿用中文页码样式。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import type { FacsimileGutterOptions } from '@bibliotype/layout';
import { Reader } from '../reader.js';
import { resolvePageGutterTexts } from '../page-gutter.js';
import type { BlockSizeEstimator } from '../document-blocks.js';

/** 固定尺寸估算器：未登记的块取 50 */
function fixedEstimator(sizes: Record<string, number>): BlockSizeEstimator {
  return (node) => sizes[node.id ?? ''] ?? 50;
}

/** 封面 + 卷一 > 章 1（标题 + 两段） */
function sampleDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '论语' });
  doc.root.children = [
    {
      type: NODE_TYPES.COVER,
      id: 'cover',
      children: [
        { type: NODE_TYPES.PARAGRAPH, id: 'cover-p', children: [{ type: 'text', text: '论语' }] },
      ],
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
          ],
        },
      ],
    },
  ];
  return doc;
}

/** 版心配置 */
function gutter(patch: Partial<FacsimileGutterOptions> = {}): FacsimileGutterOptions {
  return {
    side: 'left',
    size: 34,
    mouth: 'white',
    fishTail: 'single',
    fields: ['bookTitle', 'chapterTitle', 'pageNumber'],
    ...patch,
  };
}

describe('resolvePageGutterTexts', () => {
  it('三段文本去首尾空白', () => {
    expect(
      resolvePageGutterTexts({
        bookTitle: ' 论语 ',
        chapterTitle: '\t学而第一\n',
        pageNumberText: ' 七 ',
      }),
    ).toEqual({
      bookTitle: '论语',
      volumeTitle: '',
      chapterTitle: '学而第一',
      pageNumber: '七',
    });
  });
});

describe('Reader.getPageGutterTexts', () => {
  function createReader(layoutGutter: FacsimileGutterOptions | undefined) {
    return new Reader({
      pageMainSize: 100,
      layout: {
        pageNumberStyle: 'chinese',
        ...(layoutGutter === undefined
          ? { facsimile: { preset: 'custom', frame: 'none', rule: 'none' } }
          : { facsimile: { preset: 'song-zhe', frame: 'double', rule: 'ink', gutter: layoutGutter } }),
      },
      estimator: fixedEstimator({ 'cover-p': 100, 'h-1': 30, 'p-1': 60 }),
    });
  }

  it('未配置版心时逐页返回 undefined', () => {
    const reader = createReader(undefined);
    reader.loadDocument(sampleDoc());
    expect(reader.getPageGutterTexts(0)).toBeUndefined();
    expect(reader.getPageGutterTexts(1)).toBeUndefined();
  });

  it('未启用仿真版式（古典 / 现代布局）时恒为 undefined', () => {
    const reader = new Reader({ pageMainSize: 100 });
    reader.loadDocument(sampleDoc());
    expect(reader.getPageGutterTexts()).toBeUndefined();
  });

  it('封面页不显示版心，正文页给出书名 / 篇卷 / 叶次', () => {
    const reader = createReader(gutter());
    reader.loadDocument(sampleDoc());
    expect(reader.getPageGutterTexts(0)).toBeUndefined();
    expect(reader.getPageGutterTexts(1)).toEqual({
      bookTitle: '论语',
      volumeTitle: '卷一',
      chapterTitle: '学而第一',
      pageNumber: '二',
    });
  });

  it('页序非法时返回 undefined（不抛错）', () => {
    const reader = createReader(gutter());
    reader.loadDocument(sampleDoc());
    expect(reader.getPageGutterTexts(-1)).toBeUndefined();
    expect(reader.getPageGutterTexts(99)).toBeUndefined();
    expect(reader.getPageGutterTexts(1.5)).toBeUndefined();
  });
});
