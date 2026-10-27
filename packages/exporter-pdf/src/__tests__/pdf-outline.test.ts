/**
 * PDF 书签（/Outlines）测试
 *
 * 覆盖：
 * - buildPdfOutline：目录树 → 书签树（键口径与阅读器目录高亮同源、无页子项
 *   裁剪且孙项上提、空标题丢弃）；
 * - writePdfOutline：真实 pdf-lib 写入后 `PDFDocument.load` 回读，断言 catalog
 *   挂 /Outlines 与 /PageMode、条目层级、中文标题解码、目标页；分段偏移重定基
 *   与越界裁剪；
 * - 分页器集成：paged 分页器的 outline 与页序一致，auto 恒空；
 * - 导出链路：exportRasterPdf 分段书签 + 文档元数据；exportPdfBytes 页数一致
 *   时才补书签（不一致 / 显式关闭 / auto 模式原样返回）。
 */
import { describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
} from 'pdf-lib';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import type { OutlineItem } from '@bibliotype/reader';
import {
  buildPdfOutline,
  countPdfOutlineEntries,
  writePdfOutline,
  type PdfOutlineEntry,
} from '../pdf-outline.js';
import { createPrintPager } from '../print-document.js';
import { exportRasterPdf } from '../raster-pdf.js';
import { exportPdfBytes, type PdfOutlineResult } from '../pdf-export.js';

/* ---------- 样本与口径 ---------- */

/** 1x1 白色 JPEG（最小有效载荷；embedJpg 需要真实 JPEG 字节；按 20 字符分组避免抄错） */
const JPEG_1PX = new Uint8Array(
  Buffer.from(
    [
      '/9j/4AAQSkZJRgABAQEA',
      'YABgAAD/2wBDAAgGBgcG',
      'BQgHBwcJCQgKDBQNDAsL',
      'DBkSEw8UHRofHh0aHBwg',
      'JC4nICIsIxwcKDcpLDAx',
      'NDQ0Hyc5PTgyPC4zNDL/',
      '2wBDAQkJCQwLDBgNDRgy',
      'IRwhMjIyMjIyMjIyMjIy',
      'MjIyMjIyMjIyMjIyMjIy',
      'MjIyMjIyMjIyMjIyMjIy',
      'MjIyMjIyMjL/wAARCAAB',
      'AAEDASIAAhEBAxEB/8QA',
      'HwAAAQUBAQEBAQEAAAAA',
      'AAAAAAECAwQFBgcICQoL',
      '/8QAtRAAAgEDAwIEAwUF',
      'BAQAAAF9AQIDAAQRBRIh',
      'MUEGE1FhByJxFDKBkaEI',
      'I0KxwRVS0fAkM2JyggkK',
      'FhcYGRolJicoKSo0NTY3',
      'ODk6Q0RFRkdISUpTVFVW',
      'V1hZWmNkZWZnaGlqc3R1',
      'dnd4eXqDhIWGh4iJipKT',
      'lJWWl5iZmqKjpKWmp6ip',
      'qrKztLW2t7i5usLDxMXG',
      'x8jJytLT1NXW19jZ2uHi',
      '4+Tl5ufo6erx8vP09fb3',
      '+Pn6/9oADAMBAAIRAxEA',
      'PwD3+iiigD//2Q==',
    ].join(''),
    'base64',
  ),
);

/** 分页口径：页主轴 100 / 一块 90px → 一段一页 */
const PAGES_OPTS = {
  mode: 'paged',
  pageMainSize: 100,
  context: { charsPerLine: 26, lineSize: 30 },
  estimator: () => 90,
} as const;

/** 每章一段的样本：块 90px 独占一页，连续 N 章 → N 页 */
function chapterDoc(chapterCount: number): BookDocument {
  const doc = createEmptyDocument({ title: '分卷书' });
  doc.root.children = Array.from({ length: chapterCount }, (_, index) => ({
    type: NODE_TYPES.CHAPTER,
    id: `c-${index}`,
    children: [
      {
        type: NODE_TYPES.PARAGRAPH,
        id: `p-${index}`,
        children: [{ type: 'text', text: `第${index}章` }],
      },
    ],
  }));
  return doc;
}

/** 目录项构造（只填测试关心的字段；nodeId 缺省时键回退为树路径） */
function item(title: string, nodeId?: string, children: OutlineItem[] = []): OutlineItem {
  return { nodeId, type: NODE_TYPES.CHAPTER, title, level: 0, children };
}

/** 书签树构造 */
function entry(
  title: string,
  pageIndex: number,
  children: PdfOutlineEntry[] = [],
): PdfOutlineEntry {
  return { title, pageIndex, children };
}

/** 空白 PDF（指定页数；书签写入的目标 payload） */
async function blankPdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage([200, 200]);
  return pdf.save();
}

/* ---------- 书签回读（真实产物解析，不依赖内部对象） ---------- */

/** 回读出的书签条目 */
interface ReadEntry {
  /** 标题（PDFHexString 解码，中文原样） */
  title: string;
  /** 目标页（自 0 起；解析不到为 -1） */
  page: number;
  /** 子条目 */
  children: ReadEntry[];
}

/** 回读 PDF 书签树（按 /First /Next 兄弟链遍历） */
function readOutline(pdf: PDFDocument): ReadEntry[] {
  const root = pdf.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (root === undefined) return [];

  /** /Dest [页 ref /Fit] 的页 ref → 页序号（按引用 tag 比对，容忍对象重建） */
  const pageOfDest = (dest: PDFArray | undefined): number => {
    const target = dest?.get(0);
    if (!(target instanceof PDFRef)) return -1;
    return pdf
      .getPages()
      .findIndex((page) => page.ref.tag === target.tag);
  };

  const readSiblings = (first: PDFObject | undefined): ReadEntry[] => {
    const entries: ReadEntry[] = [];
    let current = first instanceof PDFRef ? first : undefined;
    while (current !== undefined) {
      const dict = pdf.context.lookup(current, PDFDict);
      entries.push({
        title: dict.lookupMaybe(PDFName.of('Title'), PDFHexString)?.decodeText() ?? '',
        page: pageOfDest(dict.lookupMaybe(PDFName.of('Dest'), PDFArray)),
        children: readSiblings(dict.get(PDFName.of('First'))),
      });
      const next = dict.get(PDFName.of('Next'));
      current = next instanceof PDFRef ? next : undefined;
    }
    return entries;
  };

  return readSiblings(root.get(PDFName.of('First')));
}

/* ---------- buildPdfOutline ---------- */

describe('buildPdfOutline', () => {
  it('目录树 + 页映射 → 书签树（有 id 用 id 作键）', () => {
    const outline = [
      item('卷一', 'vol-1', [item('章一', 'ch-1'), item('章二', 'ch-2')]),
      item('卷二', 'vol-2'),
    ];
    const pages = new Map<string, number>([
      ['vol-1', 0],
      ['ch-1', 3],
      ['ch-2', 5],
      ['vol-2', 9],
    ]);

    expect(buildPdfOutline(outline, (key) => pages.get(key))).toEqual([
      entry('卷一', 0, [entry('章一', 3), entry('章二', 5)]),
      entry('卷二', 9),
    ]);
  });

  it('无 id 的条目回退树路径键（与阅读器目录高亮同源）', () => {
    /* 兄弟序号用点分路径：第二个顶层项 → outline:1 */
    const outline = [item('一'), item('二')];
    const pages = new Map<string, number>([
      ['outline:0', 2],
      ['outline:1', 4],
    ]);

    expect(buildPdfOutline(outline, (key) => pages.get(key))).toEqual([
      entry('一', 2),
      entry('二', 4),
    ]);
  });

  it('无页条目裁剪、孙项上提；空标题丢弃', () => {
    const outline = [
      /* 卷有页，章（空容器）无页 → 节上提到卷下 */
      item('卷一', 'vol-1', [item('章一', 'ch-1', [item('节一', 'sec-1')])]),
      /* 卷无页 → 子项整体上提到顶层 */
      item('空卷', 'vol-2', [item('章二', 'ch-2')]),
      /* 空白标题：丢弃且不带入子项顺序错位 */
      item('   ', 'blank-1'),
    ];
    const pages = new Map<string, number>([
      ['vol-1', 0],
      ['sec-1', 2],
      ['ch-2', 6],
    ]);

    expect(buildPdfOutline(outline, (key) => pages.get(key))).toEqual([
      entry('卷一', 0, [entry('节一', 2)]),
      entry('章二', 6),
    ]);
  });

  it('全无页映射 → 空树；countPdfOutlineEntries 统计含子级', () => {
    const outline = [item('卷一', 'vol-1', [item('章一', 'ch-1', [item('节一', 'sec-1')])])];
    expect(buildPdfOutline(outline, () => undefined)).toEqual([]);

    expect(countPdfOutlineEntries([])).toBe(0);
    expect(countPdfOutlineEntries(buildPdfOutline(outline, () => 0))).toBe(3);
  });
});

/* ---------- writePdfOutline ---------- */

describe('writePdfOutline', () => {
  it('写入 /Outlines + /PageMode：层级、中文标题与目标页可回读', async () => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 3; index += 1) pdf.addPage([200, 200]);

    const written = writePdfOutline(pdf, [
      entry('第一卷 上古', 0, [entry('学而第一', 1), entry('为政第二', 2)]),
      entry('第二卷 春秋', 2),
    ]);
    expect(written).toBe(4);

    const loaded = await PDFDocument.load(await pdf.save());
    /* 阅读器打开即挂书签面板 */
    expect(loaded.catalog.get(PDFName.of('PageMode'))?.toString()).toBe('/UseOutlines');
    expect(readOutline(loaded)).toEqual([
      { title: '第一卷 上古', page: 0, children: [
        { title: '学而第一', page: 1, children: [] },
        { title: '为政第二', page: 2, children: [] },
      ] },
      { title: '第二卷 春秋', page: 2, children: [] },
    ]);
    /* 根字典条目数：全展开（正数可见后代数） */
    const root = loaded.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    expect(root.lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBe(4);
  });

  it('pageOffset 重定基：分段书签只保留区间内条目，页号从 0 起', async () => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 2; index += 1) pdf.addPage([200, 200]);

    /* 全书页 1、2 落在本段（段首页偏移 1）；页 0、3 越界丢弃 */
    const written = writePdfOutline(
      pdf,
      [entry('第一章', 0), entry('第二章', 1), entry('第三章', 2), entry('第四章', 3)],
      { pageOffset: 1 },
    );
    expect(written).toBe(2);

    const loaded = await PDFDocument.load(await pdf.save());
    expect(readOutline(loaded)).toEqual([
      { title: '第二章', page: 0, children: [] },
      { title: '第三章', page: 1, children: [] },
    ]);
  });

  it('越界父项的子项上提为同级（文本区间内仍有书签）', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);

    /* 父项页 0 不在本段（偏移 2），子项页 2 在段内 → 子项成为顶层 */
    const written = writePdfOutline(pdf, [entry('章', 0, [entry('节', 2)])], {
      pageOffset: 2,
    });
    expect(written).toBe(1);
    expect(readOutline(await PDFDocument.load(await pdf.save()))).toEqual([
      { title: '节', page: 0, children: [] },
    ]);
  });

  it('条目全越界 / 空树：不写 catalog（0 条目，字节与入参一致）', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);

    expect(writePdfOutline(pdf, [])).toBe(0);
    expect(writePdfOutline(pdf, [entry('越界', 5)])).toBe(0);
    expect(pdf.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
    expect(pdf.catalog.get(PDFName.of('PageMode'))).toBeUndefined();
  });
});

/* ---------- 分页器集成 ---------- */

describe('createPrintPager.outline', () => {
  it('paged：书签页号与分页同源（每章独占一页）', () => {
    const pager = createPrintPager(chapterDoc(3), PAGES_OPTS);

    expect(pager.pageCount).toBe(3);
    expect(pager.outline).toEqual([
      entry('第0章', 0),
      entry('第1章', 1),
      entry('第2章', 2),
    ]);
  });

  it('auto：流式无固定页界，恒为空（宁无书签也不错页）', () => {
    const pager = createPrintPager(chapterDoc(3), {});
    expect(pager.mode).toBe('auto');
    expect(pager.outline).toEqual([]);
  });
});

/* ---------- 导出链路 ---------- */

describe('exportRasterPdf：书签与文档元数据', () => {
  it('整本：书签条目数 / 页序正确，元数据写书名与生产者', async () => {
    const bytes = await exportRasterPdf(chapterDoc(3), {
      ...PAGES_OPTS,
      rasterize: async () => JPEG_1PX,
    });
    /* updateMetadata: false 才能看到产物自身的属性（缺省载入会把 Producer 改回 pdf-lib） */
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(pdf.getPageCount()).toBe(3);
    expect(readOutline(pdf)).toEqual([
      { title: '第0章', page: 0, children: [] },
      { title: '第1章', page: 1, children: [] },
      { title: '第2章', page: 2, children: [] },
    ]);
    /* 其他应用（阅读器 / 文件管理器）优先读这些属性展示书名 */
    expect(pdf.getTitle()).toBe('分卷书');
    expect(pdf.getProducer()).toBe('bibliotype');
    expect(pdf.getCreator()).toBe('bibliotype');
  });

  it('分段：书签按 from 重定基，只留区间内条目', async () => {
    const bytes = await exportRasterPdf(chapterDoc(4), {
      ...PAGES_OPTS,
      from: 1,
      to: 2,
      rasterize: async () => JPEG_1PX,
    });
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(2);
    /* 第0章（页 0）/ 第3章（页 3）不属于本段 */
    expect(readOutline(pdf)).toEqual([
      { title: '第1章', page: 0, children: [] },
      { title: '第2章', page: 1, children: [] },
    ]);
  });
});

describe('exportPdfBytes：适配器路径补书签', () => {
  it('页数一致：写入书签并经回调报告条目数', async () => {
    const raw = await blankPdf(4);
    const results: PdfOutlineResult[] = [];

    const bytes = await exportPdfBytes(chapterDoc(4), {
      ...PAGES_OPTS,
      adapter: { toPdf: async () => raw },
      onOutline: (result) => results.push(result),
    });

    expect(results).toEqual([{ written: 4 }]);
    const pdf = await PDFDocument.load(bytes);
    expect(readOutline(pdf).map((node) => [node.title, node.page])).toEqual([
      ['第0章', 0],
      ['第1章', 1],
      ['第2章', 2],
      ['第3章', 3],
    ]);
  });

  it('页数不一致：原样返回引擎字节（书签会把目录指向错页）', async () => {
    const raw = await blankPdf(5);
    const results: PdfOutlineResult[] = [];

    const bytes = await exportPdfBytes(chapterDoc(4), {
      ...PAGES_OPTS,
      adapter: { toPdf: async () => raw },
      onOutline: (result) => results.push(result),
    });

    expect(bytes).toBe(raw);
    expect(results[0]?.written).toBe(0);
    expect(results[0]?.skipped).toContain('不一致');
  });

  it('outline: false：调用方关闭 → 原样返回并报告原因', async () => {
    const raw = await blankPdf(4);
    const results: PdfOutlineResult[] = [];

    const bytes = await exportPdfBytes(chapterDoc(4), {
      ...PAGES_OPTS,
      outline: false,
      adapter: { toPdf: async () => raw },
      onOutline: (result) => results.push(result),
    });

    expect(bytes).toBe(raw);
    expect(results[0]?.written).toBe(0);
    expect(results[0]?.skipped).toContain('关闭');
  });

  it('auto 模式：打印引擎重排无固定页界，原样返回', async () => {
    const raw = await blankPdf(3);
    const results: PdfOutlineResult[] = [];

    const bytes = await exportPdfBytes(chapterDoc(3), {
      adapter: { toPdf: async () => raw },
      onOutline: (result) => results.push(result),
    });

    expect(bytes).toBe(raw);
    expect(results[0]?.skipped).toContain('auto');
  });
});
