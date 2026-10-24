/**
 * 字图（缺字替代图）识别与归一化测试（K6）
 *
 * 守护五件事：
 * 1. 识别矩阵——alt 单字 / 近方形小尺寸 → 字图；主流无元数据形态（docx data URI /
 *    epub 相对路径）靠「内嵌位图 / 扩展名 + 位置（切断句子）」双弱信号判定；
 *    大图、caption 配对、仅单条弱信号 → 保守保留；句首 / 句尾位没有位置信号，
 *    由内嵌位图**尺寸嗅探**（data URI 头部直读宽高，PNG/GIF/SVG）提供硬证据；
 * 2. 归并复原——两侧都是段落且前段未收尾（被字图切断的同一句话）→ 三合一复原；
 *    前段收尾缝后段头；容器末尾缝前段尾；两侧非段落保留；强制方向只缝单侧；
 * 3. 连续字图——多个字图连续夹在两段之间，逐个归并后仍复原成一段；
 * 4. 原档不可变——返回新文档，入参逐字节不变；
 * 5. 摘要可读——数量与保留原因直接可展示。
 */
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type Attrs, type BookDocument, type BookNode } from '../index.js';
import {
  normalizeGlyphImages,
  summarizeGlyphImageReport,
} from '../glyph-image.js';

/** 构造块级图片节点 */
function image(attrs: Attrs, id?: string): BookNode {
  return { type: NODE_TYPES.IMAGE, ...(id !== undefined ? { id } : {}), attrs };
}

/** 构造段落 */
function para(text: string): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, children: [{ type: 'text', text }] };
}

/** 构造单章文档（children 挂在章下） */
function doc(children: BookNode[]): BookDocument {
  return {
    schemaVersion: '1',
    metadata: { title: '样章' },
    root: {
      type: NODE_TYPES.BOOK,
      children: [{ type: NODE_TYPES.CHAPTER, children }],
    },
  };
}

describe('字图识别', () => {
  it('alt 为单字的小图 → 字图（强信号），两侧段落复原为一段', () => {
    const { document, report } = normalizeGlyphImages(
      doc([para('五载，'), image({ src: 'z/zhi.png', alt: '贔' }, 'img-1'), para('耻难事发，')]),
    );
    expect(report.merged).toEqual([
      { imageId: 'img-1', char: '贔', position: 'restore' },
    ]);
    expect(report.kept).toEqual([]);
    const chapter = document.root.children?.[0]!;
    expect(chapter.children).toHaveLength(1); // 前后两段 + 字图三合一
    const children = chapter.children?.[0]?.children ?? [];
    expect(children.map((child) => child.type)).toEqual([
      'text',
      NODE_TYPES.GLYPH_IMAGE,
      'text',
    ]);
    const glyph = children[1]!;
    expect(glyph.attrs).toMatchObject({ src: 'z/zhi.png', alt: '贔', char: '贔' });
  });

  it('近方形小尺寸（无 alt）→ 字图（尺寸强信号）', () => {
    const { report } = normalizeGlyphImages(
      doc([para('前文'), image({ src: 'img/glyph-32.png', width: 24, height: 24 }), para('后文')]),
    );
    expect(report.merged).toHaveLength(1);
    expect(report.merged[0]?.char).toBeUndefined();
  });

  it('docx 主流形态：data URI 位图、无 alt 无尺寸、切断句子 → 双弱信号判字图', () => {
    const { document, report } = normalizeGlyphImages(
      doc([
        para('卢世'),
        image({ src: 'data:image/png;base64,iVBORw0KGgo=' }, 'img-docx'),
        para('《紫房馀论》曰：少游吴越时，必有著作。'),
      ]),
    );
    expect(report.merged).toEqual([{ imageId: 'img-docx', char: undefined, position: 'restore' }]);
    const chapter = document.root.children?.[0]!;
    expect(chapter.children).toHaveLength(1);
    const children = chapter.children?.[0]?.children ?? [];
    expect(children[0]?.type).toBe('text');
    expect(children[1]?.type).toBe(NODE_TYPES.GLYPH_IMAGE);
    expect(children.at(-1)?.type).toBe('text');
  });

  it('epub 主流形态：相对路径 png、无 alt 无尺寸、切断句子 → 双弱信号判字图', () => {
    const { report } = normalizeGlyphImages(
      doc([para('天闳，'), image({ src: 'images/z0001.png' }, 'img-epub'), para('旧千家本或作。')]),
    );
    expect(report.merged[0]?.position).toBe('restore');
  });

  it('epub 内联 SVG 形态：data:image/svg+xml、无 alt 无尺寸、切断句子 → 双弱信号判字图', () => {
    const { document, report } = normalizeGlyphImages(
      doc([
        para('一心行阿'),
        image({ src: 'data:image/svg+xml;base64,PHN2Zy8+' }, 'img-svg'),
        para('菩提，心不散乱。'),
      ]),
    );
    expect(report.merged).toEqual([{ imageId: 'img-svg', char: undefined, position: 'restore' }]);
    const chapter = document.root.children?.[0]!;
    expect(chapter.children).toHaveLength(1);
    const children = chapter.children?.[0]?.children ?? [];
    expect(children.map((child) => child.type)).toEqual([
      'text',
      NODE_TYPES.GLYPH_IMAGE,
      'text',
    ]);
  });

  it('内联 SVG 但前段已收尾（孤立插图位）→ 仅单弱信号保守保留', () => {
    const { report } = normalizeGlyphImages(
      doc([
        para('前文完了。'),
        image({ src: 'data:image/svg+xml;base64,PHN2Zy8+' }, 'img-svg-2'),
        para('后文。'),
      ]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.id).toBe('img-svg-2');
    expect(report.kept[0]?.reason).toContain('弱信号');
  });

  it('明确大图（超阈值）→ 插图保留', () => {
    const { report } = normalizeGlyphImages(
      doc([para('前文'), image({ src: 'plate.jpg', width: 600, height: 400 }, 'img-big'), para('后文')]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept).toEqual([
      { id: 'img-big', reason: expect.stringContaining('插图') },
    ]);
  });

  it('caption 配对 → 插图保留（强信号也不判字图）', () => {
    const { report } = normalizeGlyphImages(
      doc([
        para('前文'),
        image({ src: 'z/a.png', alt: '图' }, 'img-cap'),
        { type: NODE_TYPES.CAPTION, children: [{ type: 'text', text: '书影一' }] },
        para('后文'),
      ]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.id).toBe('img-cap');
    expect(report.kept[0]?.reason).toContain('图注');
  });

  it('孤立内嵌位图（前段已收尾）→ 仅单弱信号保守保留', () => {
    const { report } = normalizeGlyphImages(
      doc([para('前文完了。'), image({ src: 'data:image/png;base64,iVBORw0KGgo=' }), para('后文。')]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.reason).toContain('弱信号');
  });

  /* ---------- 内嵌位图尺寸嗅探（句首 / 句尾位的硬证据） ---------- */

  /** PNG 头（签名 + IHDR + 宽高）的 base64 前缀，按尺寸生成 */
  const pngHeader = (w: number, h: number): string => {
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
      (w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255,
      (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255,
    ];
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  };

  it('句首内嵌 PNG 近方小图（真实头、无 alt 无尺寸）→ 嗅探凑足强信号并入后段头', () => {
    const src = `data:image/png;base64,${pngHeader(24, 24)}`;
    const { document, report } = normalizeGlyphImages(
      doc([para('前文完了。'), image({ src }, 'img-g1'), para('句首缺字的后文。')]),
    );
    /* 前段已收尾 → 不复原，缝后段头（字图是后句起头字） */
    expect(report.merged).toEqual([{ imageId: 'img-g1', position: 'next-start' }]);
    expect(report.kept).toEqual([]);
    const children = document.root.children?.[0]?.children ?? [];
    expect(children).toHaveLength(2);
    const merged = children[1]!;
    expect(merged.children?.[0]?.type).toBe(NODE_TYPES.GLYPH_IMAGE);
    expect(merged.children?.[1]?.type).toBe('text');
  });

  it('内嵌大位图（真实头 600×400）→ 嗅探尺寸超阈值，正确排除为插图', () => {
    const src = `data:image/png;base64,${pngHeader(600, 400)}`;
    const { report } = normalizeGlyphImages(
      doc([para('前文完了。'), image({ src }, 'img-big2'), para('后文。')]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.id).toBe('img-big2');
    expect(report.kept[0]?.reason).toContain('600×400');
    expect(report.kept[0]?.reason).toContain('插图');
  });

  it('内嵌横幅小位图（真实头 60×20、宽高比出区间）→ 保守保留', () => {
    const src = `data:image/png;base64,${pngHeader(60, 20)}`;
    const { report } = normalizeGlyphImages(
      doc([para('前文完了。'), image({ src }, 'img-wide'), para('后文。')]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.reason).toContain('弱信号');
  });

  it('句首内嵌 SVG（根元素 width/height=24）→ 嗅探识别并入后段头', () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"></svg>');
    const { report } = normalizeGlyphImages(
      doc([para('前文完了。'), image({ src: `data:image/svg+xml;base64,${svg}` }, 'img-s1'), para('后文。')]),
    );
    expect(report.merged).toEqual([{ imageId: 'img-s1', position: 'next-start' }]);
  });

  it('仅位置单弱信号（无 alt 无尺寸、jpg）→ 保守保留', () => {
    const { report } = normalizeGlyphImages(
      doc([para('前文'), image({ src: 'img/photo.jpg' }), para('后文')]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.reason).toContain('弱信号');
  });

  it('无 src 占位图不动', () => {
    const { report } = normalizeGlyphImages(doc([para('前文'), image({}), para('后文')]));
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.reason).toContain('占位');
  });

  it('横幅小图（宽高比出区间、有尺寸元数据）→ 保守保留', () => {
    const { report } = normalizeGlyphImages(
      doc([para('前文'), image({ src: 'z/b.png', width: 60, height: 20 }), para('后文')]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.reason).toContain('弱信号');
  });
});

describe('归并方向', () => {
  it('前段末字是收尾符 → 缝后段头（不复原：前段已是完整句）', () => {
    const { document, report } = normalizeGlyphImages(
      doc([para('注曰：水成纹曰澁。'), image({ src: 'z/s.png', alt: '澁' }), para('张协诗：堂上水衣生。')]),
    );
    expect(report.merged[0]?.position).toBe('next-start');
    const chapter = document.root.children?.[0]!;
    expect(chapter.children).toHaveLength(2);
    expect(chapter.children?.[1]?.children?.[0]?.type).toBe(NODE_TYPES.GLYPH_IMAGE);
  });

  it('字图在容器末尾（无后段）→ 缝前段尾', () => {
    const { report } = normalizeGlyphImages(doc([para('五载，'), image({ src: 'z/z.png', alt: '贔' })]));
    expect(report.merged[0]?.position).toBe('prev-end');
  });

  it('两侧都是标题（非段落）→ 保留块级', () => {
    const { document, report } = normalizeGlyphImages(
      doc([
        { type: NODE_TYPES.HEADING, children: [{ type: 'text', text: '卷一' }] },
        image({ src: 'z/c.png', alt: '字' }, 'img-h'),
        { type: NODE_TYPES.HEADING, children: [{ type: 'text', text: '卷二' }] },
      ]),
    );
    expect(report.merged).toEqual([]);
    expect(report.kept[0]?.reason).toContain('无段落');
    expect(document.root.children?.[0]?.children).toHaveLength(3);
  });

  it('merge: next 强制并后段头（前段未收尾也不复原）', () => {
    const { document, report } = normalizeGlyphImages(
      doc([para('五载，'), image({ src: 'z/z.png', alt: '贔' }), para('耻难事发，')]),
      { merge: 'next' },
    );
    expect(report.merged[0]?.position).toBe('next-start');
    const chapter = document.root.children?.[0]!;
    expect(chapter.children).toHaveLength(2);
    expect(chapter.children?.[1]?.children?.[0]?.type).toBe(NODE_TYPES.GLYPH_IMAGE);
  });

  it('merge: prev 强制并前段尾（不复原）', () => {
    const { document, report } = normalizeGlyphImages(
      doc([para('五载，'), image({ src: 'z/z.png', alt: '贔' }), para('耻难事发，')]),
      { merge: 'prev' },
    );
    expect(report.merged[0]?.position).toBe('prev-end');
    expect(document.root.children?.[0]?.children).toHaveLength(2);
  });

  it('连续双字图夹在两段之间 → 逐个归并后仍复原成一段', () => {
    const { document, report } = normalizeGlyphImages(
      doc([
        para('卢世'),
        image({ src: 'images/g1.png' }, 'img-1'),
        image({ src: 'images/g2.png' }, 'img-2'),
        para('少游吴越时，必有著作。'),
      ]),
    );
    expect(report.merged.map((record) => record.position)).toEqual(['prev-end', 'restore']);
    const chapter = document.root.children?.[0]!;
    expect(chapter.children).toHaveLength(1);
    const children = chapter.children?.[0]?.children ?? [];
    expect(children.map((child) => child.type)).toEqual([
      'text',
      NODE_TYPES.GLYPH_IMAGE,
      NODE_TYPES.GLYPH_IMAGE,
      'text',
    ]);
  });
});

describe('不可变与摘要', () => {
  it('返回新文档，原档不变', () => {
    const source = doc([para('前文'), image({ src: 'z/a.png', alt: '贔' }, 'img-x'), para('后文')]);
    const before = JSON.stringify(source);
    const { document } = normalizeGlyphImages(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(document).not.toBe(source);
    expect(document.root.children?.[0]?.children).toHaveLength(1);
  });

  it('嵌套容器内的字图同样归并复原', () => {
    const nested: BookDocument = {
      schemaVersion: '1',
      metadata: { title: '嵌套' },
      root: {
        type: NODE_TYPES.BOOK,
        children: [
          {
            type: NODE_TYPES.SECTION,
            children: [
              {
                type: NODE_TYPES.PARAGRAPH,
                children: [{ type: 'text', text: '外层段' }],
              },
              image({ src: 'z/d.png', alt: '轋' }, 'img-n'),
              para('后继段'),
            ],
          },
        ],
      },
    };
    const { report } = normalizeGlyphImages(nested);
    expect(report.merged).toEqual([{ imageId: 'img-n', char: '轋', position: 'restore' }]);
  });

  it('摘要给出数量；全空时明示未发现', () => {
    expect(
      summarizeGlyphImageReport({
        merged: [{ imageId: 'a', position: 'restore' }],
        kept: [{ id: 'b', reason: '插图' }],
      }),
    ).toBe('已将 1 张缺字图归入文字流；1 张按插图保留');
    expect(summarizeGlyphImageReport({ merged: [], kept: [] })).toBe('未发现缺字图');
  });
});
