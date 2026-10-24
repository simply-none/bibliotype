/**
 * 打印分页器与光栅直出测试
 *
 * 覆盖：
 * - 古籍直排回归：直排 layout + 直排口径实测数据下，分页与跨页行切片正确
 *   （第 1 页后有内容、后续页只剩版框的空白页回归）；
 * - pager 一致性：createPrintPager 与 renderPrintHtml 产物逐字节一致，
 *   renderPage 逐页拼接 === renderDocument（光栅直出复用同一产物）；
 * - raster-pdf：注入 mock rasterize（不触 DOM）+ 真 pdf-lib，
 *   断言页数、页物理尺寸（px→pt）、进度回调与中止行为。
 */
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_THEME, NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { CLASSICAL_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { Reader } from '@bibliotype/reader';
import { createPrintPager, renderPrintHtml } from '../print-document.js';
import {
  exportRasterPdf,
  resolveRasterConcurrency,
  resolveRasterScale,
} from '../raster-pdf.js';

/** 跨页长段样本：单段 78 字（A/B/C 各 26），每列 26 字 → 3 列，页主轴 60 → 拆两页 */
function sliceDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '切片', language: 'zh-Hant' });
  doc.root.children = [
    {
      type: NODE_TYPES.PARAGRAPH,
      id: 'p-1',
      children: [{ type: 'text', text: 'A'.repeat(26) + 'B'.repeat(26) + 'C'.repeat(26) }],
    },
  ];
  return doc;
}

/** 每段一页的多页样本：块 90px 完整落在页 200px 内（不触发跨页拆分），一段一页 */
function pagesDoc(pageCount: number): BookDocument {
  const doc = createEmptyDocument({ title: '多页' });
  doc.root.children = Array.from({ length: pageCount }, (_, index) => ({
    type: NODE_TYPES.PARAGRAPH,
    id: `p-${index}`,
    children: [{ type: 'text', text: `第${index}页` }],
  }));
  return doc;
}

/** pagesDoc 的分页口径（页主轴 100：一块 90px 落页，两块 180px 超页 → 一段一页） */
const PAGES_OPTS = {
  pageMainSize: 100,
  context: { charsPerLine: 26, lineSize: 30 },
  estimator: () => 90,
} as const;

/** 共享分页口径：页主轴 60 / 列宽 30 / 每列 26 字 */
const SLICE_OPTS = {
  pageMainSize: 60,
  context: { charsPerLine: 26, lineSize: 30 },
  estimator: () => 90,
} as const;

describe('createPrintPager：古籍直排回归', () => {
  it('直排 layout + 实测口径：分页与跨页切片正确，无空白页', () => {
    const pager = createPrintPager(sliceDoc(), {
      mode: 'paged',
      layout: CLASSICAL_LAYOUT_OPTIONS,
      tokens: DEFAULT_THEME,
      ...SLICE_OPTS,
    });

    expect(pager.pageCount).toBe(2);
    const page0 = pager.renderPage(0);
    const page1 = pager.renderPage(1);
    /* 首页含前两列（A、B），续页含第三列（C）；切片不重复 */
    expect(page0).toContain('A');
    expect(page0).toContain('B');
    expect(page0).not.toContain('C');
    expect(page1).toContain('C');
    expect(page1).not.toContain('A');
    expect((page1.match(/C/g) ?? []).length).toBe(26);
  });

  it('与显式 axis column 的 Reader 分页逐页一致（axis / tokens 同源透传）', () => {
    const doc = sliceDoc();
    const pager = createPrintPager(doc, {
      mode: 'paged',
      layout: CLASSICAL_LAYOUT_OPTIONS,
      tokens: DEFAULT_THEME,
      ...SLICE_OPTS,
    });

    /* 屏幕阅读路径的等价构造：直排 → axis 'column' + 同一份 tokens */
    const reader = new Reader({
      layout: CLASSICAL_LAYOUT_OPTIONS,
      tokens: DEFAULT_THEME,
      axis: 'column',
      measure: SLICE_OPTS.context,
      estimator: SLICE_OPTS.estimator,
      pageMainSize: SLICE_OPTS.pageMainSize,
    });
    reader.loadDocument(doc);

    expect(pager.pageCount).toBe(reader.pagination.length);
    for (let index = 0; index < pager.pageCount; index += 1) {
      const page = pager.renderPage(index);
      for (const fragment of reader.getPageFragments(index)) {
        /* 片段文本（切片后的字符）必须出现在对应页里 */
        const text = JSON.stringify(fragment).replace(/\\u([0-9a-f]{4})/gi, '');
        for (const ch of ['A', 'B', 'C']) {
          if (text.includes(ch)) expect(page).toContain(ch);
        }
      }
    }
  });
});

describe('createPrintPager 与 renderPrintHtml 产物一致性', () => {
  it('auto：renderDocument 与 renderPrintHtml 逐字节一致；renderPage 不可用', () => {
    const doc = sliceDoc();
    const options = { layout: CLASSICAL_LAYOUT_OPTIONS, tokens: DEFAULT_THEME };
    const pager = createPrintPager(doc, options);

    expect(pager.mode).toBe('auto');
    expect(pager.pageCount).toBe(0);
    expect(pager.renderDocument()).toBe(renderPrintHtml(doc, options));
    expect(() => pager.renderPage(0)).toThrow(/mode: "paged"/);
  });

  it('paged：renderDocument 与 renderPrintHtml 逐字节一致，且等于逐页拼接', () => {
    const doc = sliceDoc();
    const options = {
      mode: 'paged' as const,
      layout: CLASSICAL_LAYOUT_OPTIONS,
      tokens: DEFAULT_THEME,
      ...SLICE_OPTS,
    };
    const pager = createPrintPager(doc, options);
    const document = renderPrintHtml(doc, options);

    expect(pager.renderDocument()).toBe(document);
    /* 完整文档 = 同一份 CSS + 逐页片段按序拼接 */
    const body = document.slice(document.indexOf('<body>'));
    for (let index = 0; index < pager.pageCount; index += 1) {
      expect(body).toContain(pager.renderPage(index));
    }
    expect(document.match(/class="bt-page"/g)).toHaveLength(pager.pageCount);
    expect(document).toContain(pager.documentCss);
  });

  it('paged：renderPageRange 输出区间子集文档；全区间与 renderDocument 逐字节一致', () => {
    const doc = sliceDoc();
    const options = {
      mode: 'paged' as const,
      layout: CLASSICAL_LAYOUT_OPTIONS,
      tokens: DEFAULT_THEME,
      ...SLICE_OPTS,
    };
    const pager = createPrintPager(doc, options);

    /* 单页子集：只含该页，不含区间外页面 */
    const segment = pager.renderPageRange(1, 1);
    expect(segment).toContain('data-page="2"');
    expect(segment).not.toContain('data-page="1"');
    expect(segment).toContain(pager.documentCss);
    expect(segment.match(/class="bt-page"/g)).toHaveLength(1);

    /* 越界自动收敛：区间超过末页时截到最后一页 */
    expect(pager.renderPageRange(1, 99).match(/class="bt-page"/g)).toHaveLength(1);

    /* 全区间与 renderDocument 逐字节一致（分段打印合并语义的基准） */
    expect(pager.renderPageRange(0, pager.pageCount - 1)).toBe(pager.renderDocument());
  });

  it('auto：renderPageRange 抛错（流式单文档无固定页区间）', () => {
    const pager = createPrintPager(sliceDoc(), { mode: 'auto' });
    expect(() => pager.renderPageRange(0, 0)).toThrow(/mode: "paged"/);
  });

  it('空书：pageCount 兜底 1，renderPage(0) 输出空白页', () => {
    const pager = createPrintPager(createEmptyDocument({ title: '空书' }), {
      mode: 'paged',
      pageMainSize: 100,
    });
    expect(pager.pageCount).toBe(1);
    expect(pager.renderPage(0)).toContain('<section class="bt-page" data-page="1">');
  });
});

/* ---------- raster-pdf（注入 mock rasterize，不触 DOM；pdf-lib 为真实实现） ---------- */

/** 1×1 白色 JPEG（最小有效载荷；embedJpg 需要真实 JPEG 字节） */
const JPEG_1PX = new Uint8Array(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
      'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
      'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
      'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
      'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
      'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMB' +
      'AAIRAxEAPwD3+iiigD//2Q==',
    'base64',
  ),
);

describe('exportRasterPdf（应用内直出）', () => {
  it('逐页光栅化：页数、页面物理尺寸（px→pt）、进度回调', async () => {
    const rasterize = vi.fn(
      async (_pageHtml: string, _width: number, _height: number): Promise<Uint8Array> => JPEG_1PX,
    );
    const onProgress = vi.fn();

    const bytes = await exportRasterPdf(sliceDoc(), {
      mode: 'paged',
      ...SLICE_OPTS,
      rasterize,
      onProgress,
    });

    /* 两页各调一次光栅化；页面 CSS 尺寸 = 版面页尺寸（A5 559×794，无出血） */
    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(rasterize.mock.calls[0]?.[1]).toBe(559);
    expect(rasterize.mock.calls[0]?.[2]).toBe(794);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const page = pdf.getPage(0);
    /* px → pt（96dpi → 72pt/in） */
    expect(page.getWidth()).toBeCloseTo((559 * 72) / 96, 5);
    expect(page.getHeight()).toBeCloseTo((794 * 72) / 96, 5);

    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('mode: auto 被强制为 paged（逐页光栅需要固定页尺寸）', async () => {
    const bytes = await exportRasterPdf(sliceDoc(), {
      mode: 'auto',
      ...SLICE_OPTS,
      rasterize: async () => JPEG_1PX,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it('导出前已中止：直接抛 AbortError，不触发光栅化', async () => {
    const rasterize = vi.fn(async () => JPEG_1PX);
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportRasterPdf(sliceDoc(), {
        mode: 'paged',
        ...SLICE_OPTS,
        rasterize,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('导出中中止：已完成页计入进度，随后抛 AbortError', async () => {
    const controller = new AbortController();
    const rasterize = vi.fn(async () => {
      controller.abort();
      return JPEG_1PX;
    });
    const onProgress = vi.fn();

    await expect(
      exportRasterPdf(sliceDoc(), {
        mode: 'paged',
        ...SLICE_OPTS,
        rasterize,
        onProgress,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    /* 同步 abort：窗口只发出页 0，排空后计入进度即停 */
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1, 2);
  });

  it('导出中中止：窗口内在途页全部排空计入进度，后续页不再发起', async () => {
    const controller = new AbortController();
    const resolvers: Array<(bytes: Uint8Array) => void> = [];
    const rasterize = vi.fn((_html: string, _width: number, _height: number) => {
      const index = rasterize.mock.calls.length - 1;
      return new Promise<Uint8Array>((resolve) => {
        resolvers[index] = resolve;
      });
    });
    const onProgress = vi.fn();

    const done = exportRasterPdf(pagesDoc(4), {
      mode: 'paged',
      ...PAGES_OPTS,
      rasterize,
      onProgress,
      signal: controller.signal,
    });
    /* 窗口 0/1/2 在途时中止：填页停止，已发起的 3 页排空计入进度，页 3 不再发起 */
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(3));
    controller.abort();
    resolvers[0]?.(JPEG_1PX);
    resolvers[1]?.(JPEG_1PX);
    resolvers[2]?.(JPEG_1PX);

    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(onProgress.mock.calls).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
  });

  it('并发窗口：乱序完成仍按页序嵌入，进度按嵌入序递增', async () => {
    const total = 4;
    const resolvers: Array<(bytes: Uint8Array) => void> = [];
    const rasterize = vi.fn((_html: string, _width: number, _height: number) => {
      const index = rasterize.mock.calls.length - 1;
      return new Promise<Uint8Array>((resolve) => {
        resolvers[index] = resolve;
      });
    });
    const onProgress = vi.fn();

    const done = exportRasterPdf(pagesDoc(total), {
      mode: 'paged',
      ...PAGES_OPTS,
      rasterize,
      onProgress,
    });
    /* 窗口缺省 3：页 0/1/2 已发起，主循环等待页 0 */
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(3));
    /* 乱序完成：先 2 → 1 → 0（页 0 嵌入后页 3 进窗），3 最后完成 */
    resolvers[2]?.(JPEG_1PX);
    resolvers[1]?.(JPEG_1PX);
    resolvers[0]?.(JPEG_1PX);
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(4));
    resolvers[3]?.(JPEG_1PX);

    const bytes = await done;
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(total);
    expect(onProgress.mock.calls).toEqual([
      [1, total],
      [2, total],
      [3, total],
      [4, total],
    ]);
  });

  it('并发窗口：同时在途任务数不超过 concurrency', async () => {
    let active = 0;
    let peak = 0;
    const rasterize = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return JPEG_1PX;
    });

    const bytes = await exportRasterPdf(pagesDoc(6), {
      mode: 'paged',
      ...PAGES_OPTS,
      rasterize,
      concurrency: 2,
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(6);
  });

  it('并发窗口 1：退化为顺序执行仍完整导出', async () => {
    const rasterize = vi.fn(async () => JPEG_1PX);
    const onProgress = vi.fn();

    const bytes = await exportRasterPdf(pagesDoc(3), {
      mode: 'paged',
      ...PAGES_OPTS,
      rasterize,
      onProgress,
      concurrency: 1,
    });

    expect(rasterize).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it('页区间 from/to：只光栅化区间页并产出单卷，越界自动收敛', async () => {
    const pages: string[] = [];
    const rasterize = vi.fn(async (pageHtml: string) => {
      pages.push(pageHtml);
      return JPEG_1PX;
    });

    /* 区间 [1, 2]：只渲染第 2、3 页（0 起），单卷 2 页 */
    const bytes = await exportRasterPdf(pagesDoc(4), {
      mode: 'paged',
      ...PAGES_OPTS,
      rasterize,
      from: 1,
      to: 2,
    });

    expect(rasterize).toHaveBeenCalledTimes(2);
    /* 页序正确：区间内按页码（data-page 2、3） */
    expect(pages[0]).toContain('data-page="2"');
    expect(pages[1]).toContain('data-page="3"');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);

    /* 越界收敛：from 超末页收敛为末页单页 */
    const edge = await exportRasterPdf(pagesDoc(2), {
      mode: 'paged',
      ...PAGES_OPTS,
      rasterize: async () => JPEG_1PX,
      from: 99,
      to: 99,
    });
    expect((await PDFDocument.load(edge)).getPageCount()).toBe(1);
  });
});

describe('光栅参数收敛', () => {
  it('scale clamp 1~4：非有限值回退 2，小数取整', () => {
    expect(resolveRasterScale(undefined)).toBe(2);
    expect(resolveRasterScale(Number.NaN)).toBe(2);
    expect(resolveRasterScale(0)).toBe(1);
    expect(resolveRasterScale(2.6)).toBe(3);
    expect(resolveRasterScale(99)).toBe(4);
  });

  it('concurrency clamp 1~6：非有限值回退 3', () => {
    expect(resolveRasterConcurrency(undefined)).toBe(3);
    expect(resolveRasterConcurrency(Number.NaN)).toBe(3);
    expect(resolveRasterConcurrency(0)).toBe(1);
    expect(resolveRasterConcurrency(99)).toBe(6);
  });
});
