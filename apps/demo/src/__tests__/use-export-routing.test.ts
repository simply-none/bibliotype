/**
 * PDF 导出三分路由测试（useExport）
 *
 * 覆盖：Electron 桥恒走矢量直出、无桥按「其他」分区的导出方式路由
 * （in-app → exportRasterPdf / browser-dialog → 打印对话框）、
 * 逐页进度回填与导出中再点中止（AbortError → 提示）。
 *
 * `@bibliotype/exporter-pdf` 整体 mock（真模块的 rasterize 缺省实现触 DOM，
 * printHtml 触 iframe）：路由与状态机是本测试对象，光栅拼装在包内已测。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import {
  DEFAULT_LAYOUT_OPTIONS,
  CLASSICAL_LAYOUT_OPTIONS,
} from '@bibliotype/layout';
import { FONT_TOKENS, createEmptyDocument } from '@bibliotype/core';
import {
  downloadPdf,
  exportRasterPdf,
  printHtml,
  renderPrintHtml,
} from '@bibliotype/exporter-pdf';
import type { PdfExportMode } from '../composables/use-settings-snapshot.js';
import { useExport, type ExportDeps } from '../composables/use-export.js';

vi.mock('@bibliotype/exporter-pdf', () => ({
  collectPdfGlyphProblems: vi.fn(() => []),
  createImageBlobRewriter: vi.fn(() => ({
    rewrite: (src: string) => src,
    revokeAll: vi.fn(),
    uniqueCount: 0,
  })),
  downloadPdf: vi.fn(),
  exportPdfBytes: vi.fn(
    async (
      _book: unknown,
      options?: { adapter?: { toPdf: (html: string, opts?: unknown) => Promise<Uint8Array> } },
    ) => {
      /* 透传给 adapter，模拟真实实现的离屏窗口调用链 */
      await options?.adapter?.toPdf('<html></html>', {});
      return new Uint8Array([1, 2, 3]);
    },
  ),
  exportRasterPdf: vi.fn(async () => new Uint8Array([9, 9])),
  printHtml: vi.fn(),
  renderPrintHtml: vi.fn(() => '<html><body>mock</body></html>'),
  summarizePdfGlyphProblems: vi.fn(() => ''),
}));

/** 构造最小依赖（鸭子类型：只实现 onExportPdf 实际读取的成员） */
function makeDeps(
  pdfExportMode: PdfExportMode,
  pushToast: ReturnType<typeof vi.fn> = vi.fn(),
): ExportDeps {
  const emptyMap = new Map<string, number>();
  return {
    layout: {
      activeFontToken: ref(FONT_TOKENS.BODY),
      tokens: ref({}),
      effectiveLayout: ref(CLASSICAL_LAYOUT_OPTIONS),
      features: ref({}),
      namedStyles: ref({}),
    } as unknown as ExportDeps['layout'],
    reader: {
      reader: ref({ document: createEmptyDocument({ title: '测试书' }) }),
      pageMainSize: ref(600),
      bottomSlack: ref(0),
      typographyMeasure: () => ({ charsPerLine: 26, lineSize: 30 }),
      blockSizes: ref(emptyMap),
      blockLineOffsets: ref(new Map<string, number[]>()),
      blockLineSizes: ref(emptyMap),
      blockLineMainSizes: ref(new Map<string, number[]>()),
      blockBodySizes: ref(emptyMap),
    } as unknown as ExportDeps['reader'],
    pushToast: pushToast as unknown as ExportDeps['pushToast'],
    pdfExportMode: ref(pdfExportMode),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  delete window.electronPdf;
});

describe('useExport：PDF 三分路由', () => {
  it('in-app：走 exportRasterPdf（带 signal / onProgress / scale），直接下载', async () => {
    const deps = makeDeps('in-app');
    const { onExportPdf, pdfProgress } = useExport(deps);

    let captured: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } | undefined;
    vi.mocked(exportRasterPdf).mockImplementationOnce(async (_book, options) => {
      const opts = options ?? {};
      captured = { signal: opts.signal, onProgress: opts.onProgress };
      opts.onProgress?.(1, 2);
      return new Uint8Array([9, 9]);
    });

    await onExportPdf();

    expect(exportRasterPdf).toHaveBeenCalledTimes(1);
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
    /* 进度先回填、finally 清空 */
    expect(captured?.onProgress).toBeDefined();
    expect(pdfProgress.value).toBeNull();
    expect(downloadPdf).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadPdf).mock.calls[0]?.[1]).toBe('测试书.pdf');
    expect(printHtml).not.toHaveBeenCalled();
    expect(deps.pushToast).toHaveBeenCalledWith(expect.stringContaining('应用内直出'), 'success');
  });

  it('browser-dialog：走 renderPrintHtml + 打印对话框，不走光栅', async () => {
    const deps = makeDeps('browser-dialog');
    const { onExportPdf } = useExport(deps);

    await onExportPdf();

    expect(renderPrintHtml).toHaveBeenCalledTimes(1);
    expect(printHtml).toHaveBeenCalledTimes(1);
    expect(exportRasterPdf).not.toHaveBeenCalled();
    expect(deps.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('另存为 PDF'),
      'info',
      8000,
    );
  });

  it('Electron 桥存在：恒走矢量直出，设置项不影响', async () => {
    const bridgeExport = vi.fn(async () => new Uint8Array([7]));
    window.electronPdf = { exportPdf: bridgeExport };
    const deps = makeDeps('in-app');
    const { onExportPdf } = useExport(deps);

    await onExportPdf();

    expect(bridgeExport).toHaveBeenCalledTimes(1);
    expect(exportRasterPdf).not.toHaveBeenCalled();
    expect(printHtml).not.toHaveBeenCalled();
    expect(downloadPdf).toHaveBeenCalledTimes(1);
    expect(deps.pushToast).toHaveBeenCalledWith(expect.stringContaining('Electron'), 'success');
  });

  it('导出中再点 = 中止：signal 被打断，任务以 AbortError 收尾并提示', async () => {
    const deps = makeDeps('in-app');
    const { onExportPdf, pdfExporting } = useExport(deps);

    let capturedSignal: AbortSignal | undefined;
    vi.mocked(exportRasterPdf).mockImplementationOnce(async (_book, options) => {
      const opts = options ?? {};
      capturedSignal = opts.signal;
      return new Promise((_, reject) => {
        opts.signal?.addEventListener('abort', () =>
          reject(new DOMException('PDF 导出已中止。', 'AbortError')),
        );
      });
    });

    const first = onExportPdf();
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(pdfExporting.value).toBe(true);

    onExportPdf();
    await first;

    expect(capturedSignal?.aborted).toBe(true);
    expect(pdfExporting.value).toBe(false);
    expect(deps.pushToast).toHaveBeenCalledWith('PDF 导出已中止', 'info');
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('失败路径：非中止错误 → error 提示，状态复位', async () => {
    const deps = makeDeps('in-app');
    const { onExportPdf, pdfExporting, pdfProgress } = useExport(deps);

    vi.mocked(exportRasterPdf).mockImplementationOnce(async () => {
      throw new Error('画布导出 JPEG 失败。');
    });

    await onExportPdf();

    expect(pdfExporting.value).toBe(false);
    expect(pdfProgress.value).toBeNull();
    expect(deps.pushToast).toHaveBeenCalledWith(expect.stringContaining('导出 PDF 失败'), 'error');
  });
});
