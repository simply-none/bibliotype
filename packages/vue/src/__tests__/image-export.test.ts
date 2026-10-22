/**
 * 图片 / 长图导出（image-export，E7）测试
 *
 * happy-dom 无 Canvas 2D、也无真实渲染，故 DOM 截图与长图合成只覆盖环境安全门；
 * 截图编排通过注入 `PageCapture` 端口覆盖（ZIP 条目、进度、重试、回收），长图布局
 * 是纯函数，直接断言尺寸 / 位置 / 分隔带。
 */
import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  NODE_TYPES,
  createEmptyDocument,
  isBibliotypeError,
  type BookNode,
} from '@bibliotype/core';
import { Reader, type BlockSizeEstimator } from '@bibliotype/reader';
import {
  DEFAULT_PAGE_IMAGE_OPTIONS,
  chapterFolderName,
  composeLongImage,
  createDomPageCapture,
  createStoredZip,
  exportChapterImages,
  layoutLongImage,
  pageFileName,
  planChapterImages,
  resolvePageImageOptions,
  resolvePagePixelSize,
  sanitizeImagePathSegment,
  waitForFonts,
  type ImageExportProgress,
  type PageCapture,
  type PageImageInfo,
} from '../image-export.js';

/* ---------------- 夹具 ---------------- */

/** 每块固定 100px（推进量），页主轴 200、页底溢出 0 → 每页 2 块 */
const oneHundred: BlockSizeEstimator = () => 100;

function paragraph(id: string, text = id): BookNode {
  return { type: NODE_TYPES.PARAGRAPH, id, children: [{ type: 'text', text }] };
}

/** 章节点：N 段正文，标题取 attrs.title */
function chapterOf(id: string, title: string, count = 4): BookNode {
  const children: BookNode[] = [];
  for (let i = 1; i <= count; i += 1) children.push(paragraph(`${id}-p${i}`, `${title}第${i}段`));
  return { type: NODE_TYPES.CHAPTER, id, attrs: { title }, children };
}

function readerOf(doc: ReturnType<typeof createEmptyDocument>): Reader {
  const reader = new Reader({ pageMainSize: 200, bottomSlack: 0, estimator: oneHundred });
  reader.loadDocument(doc);
  return reader;
}

/** 三章书：每章 4 段 → 每章 2 页，共 6 页 */
function threeChapterReader(): Reader {
  const doc = createEmptyDocument({ title: '三章书' });
  const children: BookNode[] = [];
  for (let c = 1; c <= 3; c += 1) children.push(chapterOf(`chap-${c}`, `第${c}章`));
  doc.root.children = children;
  return readerOf(doc);
}

/** 假截图器：返回以页号为内容的字节，便于校验 ZIP 条目内文 */
function fakeCapture(): PageCapture & { dispose: ReturnType<typeof vi.fn> } {
  return {
    capturePage: (pageIndex: number, info: PageImageInfo) => ({
      chapterIndex: info.chapterIndex,
      pageIndex,
      width: 375,
      height: 667,
      data: new TextEncoder().encode(`page-${pageIndex}`),
    }),
    dispose: vi.fn(),
  };
}

/* ---------------- 选项归一化 ---------------- */

describe('resolvePageImageOptions', () => {
  it('缺省值：DPR 2 / PNG / 质量 0.92 / 白底', () => {
    expect(resolvePageImageOptions()).toEqual(DEFAULT_PAGE_IMAGE_OPTIONS);
    expect(DEFAULT_PAGE_IMAGE_OPTIONS).toEqual({
      dpr: 2,
      format: 'png',
      quality: 0.92,
      background: '#ffffff',
    });
  });

  it('钳位：DPR 1~3、质量 0.1~1，非有限值回退缺省', () => {
    expect(resolvePageImageOptions({ dpr: 99 }).dpr).toBe(3);
    expect(resolvePageImageOptions({ dpr: 0.1 }).dpr).toBe(1);
    expect(resolvePageImageOptions({ dpr: Number.NaN }).dpr).toBe(2);
    expect(resolvePageImageOptions({ quality: 2 }).quality).toBe(1);
    expect(resolvePageImageOptions({ quality: 0.01 }).quality).toBe(0.1);
  });

  it('JPEG 强制不透明底；PNG 允许 transparent（null）', () => {
    expect(resolvePageImageOptions({ format: 'jpeg', background: null }).background).toBe('#ffffff');
    expect(resolvePageImageOptions({ format: 'png', background: null }).background).toBeNull();
  });
});

describe('resolvePagePixelSize', () => {
  it('CSS px × DPR 取整：375×667 @2 → 750×1334', () => {
    expect(resolvePagePixelSize({ width: 375, height: 667 }, 2)).toEqual({ width: 750, height: 1334 });
  });

  it('DPR 钳位到 3 且尺寸至少 1px', () => {
    expect(resolvePagePixelSize({ width: 375, height: 667 }, 99)).toEqual({ width: 1125, height: 2001 });
    expect(resolvePagePixelSize({ width: 0.2, height: 0 })).toEqual({ width: 1, height: 1 });
  });
});

/* ---------------- 章节分组 ---------------- */

describe('planChapterImages', () => {
  it('三章书：每章 2 页，起始 / 结束页按目录定位', () => {
    const reader = threeChapterReader();
    expect(reader.totalPages).toBe(6);

    const plans = planChapterImages(reader);
    expect(plans.map((plan) => plan.title)).toEqual(['第1章', '第2章', '第3章']);
    expect(plans.map((plan) => plan.startPage)).toEqual([0, 2, 4]);
    expect(plans.map((plan) => plan.endPage)).toEqual([1, 3, 5]);
    expect(plans.map((plan) => plan.nodeId)).toEqual(['chap-1', 'chap-2', 'chap-3']);
    expect(plans.every((plan, index) => plan.index === index)).toBe(true);
  });

  it('首个分组从第 0 页起：封面前置页并入首章', () => {
    const doc = createEmptyDocument({ title: '前置页' });
    // 前置两段占满第 0 页，第一章自然起点在第 1 页
    doc.root.children = [
      paragraph('pre-1'),
      paragraph('pre-2'),
      chapterOf('chap-1', '第一章'),
      chapterOf('chap-2', '第二章'),
    ];
    const reader = readerOf(doc);
    expect(reader.totalPages).toBe(5);

    const plans = planChapterImages(reader);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ title: '第一章', startPage: 0, endPage: 2 });
    expect(plans[1]).toMatchObject({ title: '第二章', startPage: 3, endPage: 4 });
  });

  it('chapterLevel 取层级：0 = 卷，1 = 卷内各章', () => {
    const doc = createEmptyDocument({ title: '分卷书' });
    doc.root.children = [
      {
        type: NODE_TYPES.VOLUME,
        id: 'vol-1',
        attrs: { title: '卷一' },
        children: [chapterOf('chap-1', '第一章'), chapterOf('chap-2', '第二章')],
      },
    ];
    const reader = readerOf(doc);

    const volumes = planChapterImages(reader);
    expect(volumes).toHaveLength(1);
    expect(volumes[0]).toMatchObject({ title: '卷一', startPage: 0, endPage: 3 });

    const chapters = planChapterImages(reader, { level: 1 });
    expect(chapters.map((plan) => plan.title)).toEqual(['第一章', '第二章']);
    expect(chapters.map((plan) => plan.startPage)).toEqual([0, 2]);
    expect(chapters.map((plan) => plan.endPage)).toEqual([1, 3]);
  });

  it('无目录：退化为单章「全书」，标题取书目', () => {
    const doc = createEmptyDocument({ title: '无章节' });
    const children: BookNode[] = [];
    for (let i = 1; i <= 4; i += 1) children.push(paragraph(`p-${i}`));
    doc.root.children = children;
    const reader = readerOf(doc);
    expect(reader.totalPages).toBe(2);

    expect(planChapterImages(reader)).toEqual([
      { index: 0, title: '无章节', nodeId: '', startPage: 0, endPage: 1 },
    ]);
  });

  it('空文档：无分组', () => {
    const reader = new Reader();
    reader.loadDocument(createEmptyDocument({ title: '空' }));
    expect(planChapterImages(reader)).toEqual([]);
  });
});

/* ---------------- 文件命名 ---------------- */

describe('命名与路径清洗', () => {
  it('目录名补零并清洗非法字符', () => {
    const plan = { index: 0, title: '学而 / 第一:篇', nodeId: 'chap-1', startPage: 0, endPage: 1 };
    expect(chapterFolderName(plan)).toBe('01-学而 - 第一-篇');
  });

  it('页文件名按全书页序补三位，JPEG 用 .jpg', () => {
    expect(pageFileName(0, 'png')).toBe('001.png');
    expect(pageFileName(11, 'jpeg')).toBe('012.jpg');
  });

  it('清洗：路径分隔符 / 控制符 / 首部点号 / 超长截断，空白回退', () => {
    expect(sanitizeImagePathSegment('a/b:c*d?e"f<g>h|i\\j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizeImagePathSegment('..hidden')).toBe('hidden');
    expect(sanitizeImagePathSegment('   ')).toBe('chapter');
    expect(sanitizeImagePathSegment('', 'untitled')).toBe('untitled');
    expect(sanitizeImagePathSegment('长'.repeat(80))).toHaveLength(48);
    expect(sanitizeImagePathSegment('a\n b')).toBe('a b');
  });
});

/* ---------------- ZIP ---------------- */

describe('createStoredZip', () => {
  it('STORE 打包可被标准解包器读出，且同一输入产物逐字节一致', () => {
    const files = [
      { name: '01-第一章/001.png', data: new Uint8Array([1, 2, 3]) },
      { name: '01-第一章/002.png', data: new TextEncoder().encode('第二页') },
    ];
    const first = createStoredZip(files);
    const second = createStoredZip(files);
    expect(Array.from(first)).toEqual(Array.from(second));

    const unpacked = unzipSync(first);
    expect(Object.keys(unpacked).sort()).toEqual(['01-第一章/001.png', '01-第一章/002.png']);
    expect(Array.from(unpacked['01-第一章/001.png'] as Uint8Array)).toEqual([1, 2, 3]);
    expect(strFromU8(unpacked['01-第一章/002.png'] as Uint8Array)).toBe('第二页');
  });
});

/* ---------------- 按章批量导出 ---------------- */

describe('exportChapterImages', () => {
  it('三章书：ZIP 含 3 组 6 张图片，页序全书连续，进度与回收正常', async () => {
    const reader = threeChapterReader();
    const capture = fakeCapture();
    const progress: ImageExportProgress[] = [];

    const result = await exportChapterImages(reader, {
      capture,
      onProgress: (entry) => progress.push(entry),
    });

    expect(result.chapters).toHaveLength(3);
    expect(result.pages).toHaveLength(6);
    expect(result.pages.map((page) => page.pageIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.pages.map((page) => page.chapterIndex)).toEqual([0, 0, 1, 1, 2, 2]);

    const unpacked = unzipSync(result.zip);
    expect(Object.keys(unpacked)).toEqual([
      '01-第1章/001.png',
      '01-第1章/002.png',
      '02-第2章/003.png',
      '02-第2章/004.png',
      '03-第3章/005.png',
      '03-第3章/006.png',
    ]);
    expect(strFromU8(unpacked['01-第1章/001.png'] as Uint8Array)).toBe('page-0');
    expect(strFromU8(unpacked['03-第3章/006.png'] as Uint8Array)).toBe('page-5');

    // 6 次截图进度 + 1 次打包进度
    expect(progress).toHaveLength(7);
    expect(progress[0]).toEqual({ phase: 'capture', done: 1, total: 6, chapterIndex: 0, pageIndex: 0 });
    expect(progress[5]).toEqual({ phase: 'capture', done: 6, total: 6, chapterIndex: 2, pageIndex: 5 });
    expect(progress[6]).toEqual({ phase: 'zip', done: 6, total: 6, chapterIndex: 2, pageIndex: 5 });
    expect(capture.dispose).toHaveBeenCalledTimes(1);
  });

  it('单页失败按 retries 重试后成功', async () => {
    const reader = threeChapterReader();
    let failures = 0;
    const capturePage = vi.fn((pageIndex: number, info: PageImageInfo) => {
      if (pageIndex === 0 && failures === 0) {
        failures += 1;
        throw new Error('transient');
      }
      return {
        chapterIndex: info.chapterIndex,
        pageIndex,
        width: 375,
        height: 667,
        data: new Uint8Array([pageIndex]),
      };
    });

    const result = await exportChapterImages(reader, { capture: { capturePage }, retries: 1 });
    expect(result.pages).toHaveLength(6);
    // 5 页成功 1 次 + 失败页 2 次
    expect(capturePage).toHaveBeenCalledTimes(7);
  });

  it('重试用尽：抛 IMAGE_EXPORT_FAILED，带页号 / 尝试次数 / 根因，并回收截图器', async () => {
    const reader = threeChapterReader();
    const capturePage = vi.fn(() => {
      throw new Error('always fails');
    });
    const dispose = vi.fn();

    let caught: unknown;
    try {
      await exportChapterImages(reader, { capture: { capturePage, dispose }, retries: 2 });
    } catch (error) {
      caught = error;
    }

    expect(isBibliotypeError(caught)).toBe(true);
    if (isBibliotypeError(caught)) {
      expect(caught.code).toBe('IMAGE_EXPORT_FAILED');
      expect(caught.details).toMatchObject({ pageIndex: 0, attempts: 3 });
      expect(caught.cause).toBeInstanceOf(Error);
    }
    expect(capturePage).toHaveBeenCalledTimes(3);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('空文档：抛 IMAGE_EXPORT_FAILED', async () => {
    const reader = new Reader();
    reader.loadDocument(createEmptyDocument({ title: '空' }));

    let caught: unknown;
    try {
      await exportChapterImages(reader, { capture: fakeCapture() });
    } catch (error) {
      caught = error;
    }
    expect(isBibliotypeError(caught)).toBe(true);
    if (isBibliotypeError(caught)) {
      expect(caught.code).toBe('IMAGE_EXPORT_FAILED');
      expect(caught.message).toContain('没有可导出');
    }
  });
});

/* ---------------- 长图布局 ---------------- */

describe('layoutLongImage', () => {
  const chapters = [
    { index: 0, title: '第一章', pages: [{ width: 100, height: 200 }, { width: 100, height: 200 }] },
    { index: 1, title: '第二章', pages: [{ width: 100, height: 200 }] },
    {
      index: 2,
      title: '第三章',
      pages: [
        { width: 100, height: 200 },
        { width: 100, height: 200 },
        { width: 100, height: 200 },
      ],
    },
  ];

  it('总高 = 各页高度和 + 页间距 + 分隔带 + 上下留白', () => {
    const layout = layoutLongImage(chapters, { pageGap: 10, chapterGap: 30, padding: 5 });
    // 6 页 × 200 + 3 处页间距 × 10 + 2 处章分隔 × 30 + 上下留白 10
    expect(layout.height).toBe(1200 + 30 + 60 + 10);
    expect(layout.width).toBe(110);
    expect(layout.pages).toHaveLength(6);
    expect(layout.pages.map((page) => page.top)).toEqual([5, 215, 445, 675, 885, 1095]);
    expect(layout.pages.every((page) => page.left === 5)).toBe(true);

    expect(layout.separators).toHaveLength(2);
    expect(layout.separators.map((separator) => separator.top)).toEqual([415, 645]);
    expect(layout.separators.map((separator) => separator.title)).toEqual(['第二章', '第三章']);
    expect(layout.separators.every((separator) => separator.height === 30)).toBe(true);
  });

  it('页宽不一时按最大页宽居中', () => {
    const layout = layoutLongImage(
      [{ index: 0, title: '章', pages: [{ width: 80, height: 100 }, { width: 120, height: 100 }] }],
      { pageGap: 0, padding: 10 },
    );
    expect(layout.width).toBe(140);
    expect(layout.pages.map((page) => page.left)).toEqual([30, 10]);
  });

  it('chapterGap 为 0：不留分隔带高度', () => {
    const layout = layoutLongImage(
      [
        { index: 0, title: '甲', pages: [{ width: 100, height: 100 }] },
        { index: 1, title: '乙', pages: [{ width: 100, height: 100 }] },
      ],
      { chapterGap: 0, pageGap: 0 },
    );
    expect(layout.height).toBe(200);
    expect(layout.separators.every((separator) => separator.height === 0)).toBe(true);
    expect(layout.separators.map((separator) => separator.top)).toEqual([100]);
  });

  it('空章节跳过；全空时回退 1×1', () => {
    const layout = layoutLongImage([{ index: 0, title: '空章', pages: [] }]);
    expect(layout).toEqual({ width: 1, height: 1, pages: [], separators: [] });
  });
});

/* ---------------- 浏览器能力安全门 ---------------- */

describe('浏览器端能力（happy-dom 安全门）', () => {
  it('waitForFonts：无 FontFaceSet 时直接完成', async () => {
    await expect(waitForFonts()).resolves.toBeUndefined();
  });

  it('createDomPageCapture：可创建截图器，dispose 幂等', () => {
    const capture = createDomPageCapture(threeChapterReader());
    expect(typeof capture.capturePage).toBe('function');
    expect(typeof capture.dispose).toBe('function');
    expect(() => {
      capture.dispose?.();
      capture.dispose?.();
    }).not.toThrow();
  });

  it('composeLongImage：无 Canvas 2D 上下文时抛 IMAGE_EXPORT_UNSUPPORTED', async () => {
    const layout = layoutLongImage([{ index: 0, title: '章', pages: [{ width: 100, height: 200 }] }]);
    let caught: unknown;
    try {
      await composeLongImage(layout, []);
    } catch (error) {
      caught = error;
    }
    expect(isBibliotypeError(caught)).toBe(true);
    if (isBibliotypeError(caught)) expect(caught.code).toBe('IMAGE_EXPORT_UNSUPPORTED');
  });
});
