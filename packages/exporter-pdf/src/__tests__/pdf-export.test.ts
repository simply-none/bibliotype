/**
 * PDF 导出适配层测试
 *
 * 覆盖：exportPdfBytes（adapter 组合 + inline 自包含契约）、downloadPdf
 * （假 document 下载流程）、createImageBlobRewriter（data URI → blob URL
 * 去重、非图片透传、revokeAll），以及 adapter 缺省报错。
 */
import { describe, expect, it, vi } from 'vitest';
import { NODE_TYPES, createEmptyDocument, type BookDocument } from '@bibliotype/core';
import { renderPrintHtml } from '../print-document.js';
import {
  createImageBlobRewriter,
  downloadPdf,
  exportPdfBytes,
  type PdfExportAdapter,
} from '../pdf-export.js';

/** 1x1 PNG（base64，内容任意） */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 假适配器：记录调用，返回固定字节 */
function fakeAdapter(bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])): PdfExportAdapter & {
  calls: Array<{ html: string; options?: unknown }>;
} {
  const calls: Array<{ html: string; options?: unknown }> = [];
  return {
    calls,
    async toPdf(html, options) {
      calls.push({ html, options });
      return bytes;
    },
  };
}

/** 带图样本：章内两张图（一张外链） */
function imageDoc(): BookDocument {
  const doc = createEmptyDocument({ title: '带图书', language: 'zh-Hans' });
  doc.root.children = [
    {
      type: NODE_TYPES.CHAPTER,
      id: 'c-1',
      children: [
        {
          type: NODE_TYPES.PARAGRAPH,
          children: [
            { type: NODE_TYPES.IMAGE, attrs: { src: PNG_1X1, alt: '图一' }, children: [] },
            { type: NODE_TYPES.IMAGE, attrs: { src: PNG_1X1, alt: '图二' }, children: [] },
            {
              type: NODE_TYPES.IMAGE,
              attrs: { src: 'https://example.com/x.png' },
              children: [],
            },
          ],
        },
      ],
    },
  ];
  return doc;
}

describe('exportPdfBytes', () => {
  it('adapter 路径：渲染自包含 HTML（图片 inline）→ 适配器 → PDF 字节', async () => {
    const adapter = fakeAdapter();
    const bytes = await exportPdfBytes(imageDoc(), { adapter });

    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(adapter.calls).toHaveLength(1);
    const html = adapter.calls[0]?.html ?? '';
    /* inline 自包含：data URI 原样保留（离屏窗口拿不到 blob: URL） */
    expect(html).toContain(`src="${PNG_1X1}"`);
    /* 两处引用都 inline（去重是降级路径 blob 化的事，adapter 路径保正确性优先） */
    expect((html.match(new RegExp(PNG_1X1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(2);
    expect(html).toContain('src="https://example.com/x.png"');
  });

  it('adapterOptions 透传', async () => {
    const adapter = fakeAdapter();
    await exportPdfBytes(imageDoc(), {
      adapter,
      adapterOptions: { pageSize: 'A5', printBackground: false, preferCssPageSize: true },
    });
    expect(adapter.calls[0]?.options).toEqual({
      pageSize: 'A5',
      printBackground: false,
      preferCssPageSize: true,
    });
  });

  it('paged 模式同样经适配器（逐页一致路径）', async () => {
    const adapter = fakeAdapter();
    await exportPdfBytes(imageDoc(), { adapter, mode: 'paged' });
    expect(adapter.calls[0]?.html).toContain('class="bt-page"');
  });

  it('缺省 adapter 抛错（无适配器应走 printBook 降级）', async () => {
    await expect(
      // @ts-expect-error 故意缺 adapter 验证契约
      exportPdfBytes(imageDoc(), {}),
    ).rejects.toThrow(/PdfExportAdapter/);
  });
});

describe('downloadPdf', () => {
  it('Blob 下载流程：创建 URL → 触发 click → 回收 URL', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const clicked: Array<{ href: string; download: string }> = [];
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        expect(blob.type).toBe('application/pdf');
        created.push('blob:mock-pdf');
        return 'blob:mock-pdf';
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    /* 假 a 元素：记录 href/download 与 click */
    const record = {
      href: '',
      download: '',
      click(): void {
        clicked.push({ href: this.href, download: this.download });
      },
    };
    vi.stubGlobal('document', { createElement: () => record });

    downloadPdf(new Uint8Array([1, 2, 3]), '论语.pdf');

    expect(created).toHaveLength(1);
    expect(clicked).toEqual([{ href: 'blob:mock-pdf', download: '论语.pdf' }]);
    expect(revoked).toEqual(['blob:mock-pdf']);
    vi.unstubAllGlobals();
  });
});

describe('createImageBlobRewriter', () => {
  it('data URI → blob URL；重复内容返回同一 URL（去重）', () => {
    const created: Blob[] = [];
    let counter = 0;
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        counter += 1;
        return `blob:img-${counter}`;
      },
      revokeObjectURL: () => {},
    });

    const rewriter = createImageBlobRewriter();
    const first = rewriter.rewrite(PNG_1X1);
    const second = rewriter.rewrite(PNG_1X1);

    expect(first).toBe('blob:img-1');
    expect(second).toBe('blob:img-1'); /* 同 src 同 URL */
    expect(rewriter.uniqueCount).toBe(1);
    expect(created).toHaveLength(1); /* 只解码 / 创建一次 */
    expect(created[0]?.type).toBe('image/png');
    vi.unstubAllGlobals();
  });

  it('非 data:image src 透传（返回 undefined）；非 base64 data URI 不处理', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    const rewriter = createImageBlobRewriter();
    expect(rewriter.rewrite('https://example.com/a.png')).toBeUndefined();
    expect(rewriter.rewrite('Images/a.png')).toBeUndefined();
    expect(rewriter.rewrite('data:image/png,raw-bytes')).toBeUndefined();
    expect(rewriter.rewrite('')).toBeUndefined();
    expect(rewriter.uniqueCount).toBe(0);
    vi.unstubAllGlobals();
  });

  it('revokeAll：回收全部 URL 并清空（可重复调用）', () => {
    const revoked: string[] = [];
    let counter = 0;
    /* 另一张合法 base64 图（10 字节 PNG 头） */
    const PNG_OTHER = 'data:image/png;base64,iVBORw0KGgo=';
    vi.stubGlobal('URL', {
      createObjectURL: () => {
        counter += 1;
        return `blob:img-${counter}`;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const rewriter = createImageBlobRewriter();
    rewriter.rewrite(PNG_1X1);
    rewriter.rewrite(PNG_OTHER);
    expect(rewriter.uniqueCount).toBe(2);
    rewriter.revokeAll();
    expect(revoked).toEqual(['blob:img-1', 'blob:img-2']);
    expect(rewriter.uniqueCount).toBe(0);
    /* 回收后可继续复用（计数器推进） */
    expect(rewriter.rewrite(PNG_1X1)).toBe('blob:img-3');
    vi.unstubAllGlobals();
  });

  it('与 renderPrintHtml 组合：HTML 里 data URI 被改写为 blob URL', () => {
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:img-1',
      revokeObjectURL: () => {},
    });
    const rewriter = createImageBlobRewriter();
    const html = renderPrintHtml(imageDoc(), { rewriteSrc: rewriter.rewrite });
    expect(html).not.toContain('data:image/png;base64,');
    expect((html.match(/src="blob:img-1"/g) ?? []).length).toBe(2); /* 两处引用同一 URL */
    expect(rewriter.uniqueCount).toBe(1);
    vi.unstubAllGlobals();
  });
});
