/**
 * 书档内联图片去重与还原测试
 *
 * 覆盖：同一 data URI 多处出现只保留一份（令牌唯一 + 首现顺序）、非 data URI
 * 混排不动、写时复制（未触及子树共享原引用、原档不被污染）、rehydrate 令牌还原
 * 与未知令牌不误伤。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type BookDocument, type BookNode } from '@bibliotype/core';
import { dedupeInlineImages, rehydrateInlineImages } from '../image-dedup.js';

const GLYPH_A = 'data:image/png;base64,AAAA';
const GLYPH_B = 'data:image/svg+xml;base64,BBBB';

/** 注文书：同一缺字图（GLYPH_A）在两处出现，另一处是不同图（GLYPH_B） */
function makeDoc(): BookDocument {
  const glyph = (src: string, id?: string): BookNode => ({
    type: NODE_TYPES.GLYPH_IMAGE,
    ...(id !== undefined ? { id } : {}),
    attrs: { src },
  });
  return {
    schemaVersion: '1',
    metadata: { title: '去重' },
    root: {
      type: NODE_TYPES.BOOK,
      children: [
        {
          type: NODE_TYPES.CHAPTER,
          children: [
            {
              type: NODE_TYPES.PARAGRAPH,
              children: [{ type: 'text', text: '一心行阿' }, glyph(GLYPH_A), { type: 'text', text: '菩提' }],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              children: [{ type: 'text', text: '另字' }, glyph(GLYPH_B, 'glyph-b')],
            },
            {
              type: NODE_TYPES.PARAGRAPH,
              children: [{ type: 'text', text: '再引' }, glyph(GLYPH_A)],
            },
            {
              type: NODE_TYPES.IMAGE,
              attrs: { src: 'https://example.com/plate.jpg' },
            },
          ],
        },
      ],
    },
  };
}

describe('dedupeInlineImages', () => {
  it('同一 data URI 多处出现只保留一份，令牌按首现顺序编号', () => {
    const { document, assets } = dedupeInlineImages(makeDoc());
    expect(assets).toEqual([
      { token: '__bibliotype_asset_0__', dataUri: GLYPH_A },
      { token: '__bibliotype_asset_1__', dataUri: GLYPH_B },
    ]);
    const chapter = document.root.children?.[0]!;
    const para0 = chapter.children?.[0] as BookNode;
    const para2 = chapter.children?.[2] as BookNode;
    /* 两处 GLYPH_A 共用同一令牌；GLYPH_B 为令牌 1 */
    expect(para0.children?.[1]?.attrs?.src).toBe('__bibliotype_asset_0__');
    expect(para2.children?.[1]?.attrs?.src).toBe('__bibliotype_asset_0__');
    expect((chapter.children?.[1] as BookNode).children?.[1]?.attrs?.src).toBe(
      '__bibliotype_asset_1__',
    );
  });

  it('写时复制：未触及子树共享原引用，原档不被污染', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const { document, assets } = dedupeInlineImages(doc);

    /* 原档逐字节不变 */
    expect(JSON.stringify(doc)).toBe(before);
    /* 含 data URI 的段落被改写（首段 GLYPH_A、次段 GLYPH_B）；
     * 不含内联图片的节点与原档共享引用（无图段落 + 外链 image 子树） */
    const chapterOld = doc.root.children?.[0] as BookNode;
    const chapterNew = document.root.children?.[0] as BookNode;
    expect(chapterNew).not.toBe(chapterOld);
    expect(chapterNew.children?.[1]).not.toBe(chapterOld.children?.[1]); // 含 GLYPH_B，已改写
    expect(chapterNew.children?.[3]).toBe(chapterOld.children?.[3]); // 外链图片（非 data URI）子树共享
  });

  it('外链 src（http）与无 src 节点不参与去重', () => {
    const { assets } = dedupeInlineImages(makeDoc());
    expect(assets.every((asset) => asset.dataUri.startsWith('data:image/'))).toBe(true);
    expect(assets.some((asset) => asset.dataUri.includes('example.com'))).toBe(false);
  });

  it('空书档（root 无子节点）原样返回', () => {
    const doc: BookDocument = {
      schemaVersion: '1',
      metadata: { title: '空' },
      root: { type: NODE_TYPES.BOOK },
    };
    const { document, assets } = dedupeInlineImages(doc);
    expect(assets).toEqual([]);
    expect(document).toBe(doc);
  });
});

describe('rehydrateInlineImages', () => {
  it('令牌 src 还原为解析 URL；未提供解析的令牌保持原值；外链 src 不受影响', () => {
    const { document } = dedupeInlineImages(makeDoc());
    const chapter = document.root.children?.[0] as BookNode;
    /* 原地还原（宿主收到的为私有副本，可变）：只解析令牌 0 → 相对资源路径 */
    rehydrateInlineImages(document.root, (token) =>
      token === '__bibliotype_asset_0__' ? 'exp-1/__bibliotype_asset_0__.png' : undefined,
    );
    /* 令牌 0 两处出现，均已还原 */
    expect((chapter.children?.[0] as BookNode).children?.[1]?.attrs?.src).toBe(
      'exp-1/__bibliotype_asset_0__.png',
    );
    expect((chapter.children?.[2] as BookNode).children?.[1]?.attrs?.src).toBe(
      'exp-1/__bibliotype_asset_0__.png',
    );
    /* 令牌 1 未提供解析 → 保持令牌原值 */
    expect((chapter.children?.[1] as BookNode).children?.[1]?.attrs?.src).toBe(
      '__bibliotype_asset_1__',
    );
    /* 外链 src 不受影响 */
    expect((chapter.children?.[3] as BookNode).attrs?.src).toBe('https://example.com/plate.jpg');
  });
});
