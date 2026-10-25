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
import { FONT_TOKENS, NODE_TYPES, createEmptyDocument } from '@bibliotype/core';
import {
  downloadPdf,
  exportRasterPdf,
  printHtml,
  renderPrintHtml,
} from '@bibliotype/exporter-pdf';
import type { PdfExportMode, PdfRasterScale } from '../composables/use-settings-snapshot.js';
import { useExport, type ExportDeps } from '../composables/use-export.js';

/**
 * 宿主判别式开关
 *
 * use-export 以 `host.isDesktop` 决定走 Electron 通道还是浏览器通道；
 * 真宿主由构建期复制决定，测试里用可变 mock 覆盖两种环境。
 */
const hostState = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('../host/index.js', () => ({
  host: {
    /** 是否桌面宿主（测试内可变） */
    get isDesktop() {
      return hostState.isDesktop;
    },
    /** 落盘结果（测试内恒成功；路径由用例自行断言） */
    downloadBytes: vi.fn(() => ({ ok: true })),
  },
}));

vi.mock('@bibliotype/exporter-pdf', async (importOriginal) => {
  /* 保留真实的 dedupeInlineImages（纯函数，桌面分支用它做 data URI 去重令牌化） */
  const actual = await importOriginal<typeof import('@bibliotype/exporter-pdf')>();
  return {
    ...actual,
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
  };
});

/** 构造最小依赖（鸭子类型：只实现 onExportPdf 实际读取的成员） */
function makeDeps(
  pdfExportMode: PdfExportMode,
  pushToast: ReturnType<typeof vi.fn> = vi.fn(),
  pdfRasterScale: PdfRasterScale = 2,
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
    pdfRasterScale: ref(pdfRasterScale),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  hostState.isDesktop = false;
  delete window.electronPdf;
  delete (window as unknown as { ipcRenderer?: unknown }).ipcRenderer;
});

describe('useExport：PDF 三分路由', () => {
  it('in-app（浏览器）：打开分段导出弹窗，确认前不整本光栅、不直接下载', async () => {
    const deps = makeDeps('in-app');
    const { onExportPdf, segmentDialogOpen, segmentRunner, segmentTitle } = useExport(deps);

    await onExportPdf();

    /* 弹窗打开，逐段导出由弹窗确认后触发（exportRasterPdf 的页区间形态） */
    expect(segmentDialogOpen.value).toBe(true);
    expect(segmentRunner.value).not.toBeNull();
    expect(segmentTitle.value).toBe('测试书');
    expect(exportRasterPdf).not.toHaveBeenCalled();
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(printHtml).not.toHaveBeenCalled();
  });

  it('in-app：浏览器弹窗 runner 逐段调 exportRasterPdf 页区间并独立下载（_00x 命名）', async () => {
    const deps = makeDeps('in-app', vi.fn(), 3);
    const { onExportPdf, segmentRunner } = useExport(deps);
    await onExportPdf();

    /* 模拟弹窗确认后的逐段导出：页区间 [0,99]，清晰度档位与命名随段传入 */
    const downloads: Array<{ filename: string; bytes: Uint8Array }> = [];
    vi.mocked(exportRasterPdf).mockImplementationOnce(async (_book, options) => {
      expect(options?.from).toBe(0);
      expect(options?.to).toBe(99);
      expect(options?.scale).toBe(3);
      return new Uint8Array([9, 9]);
    });
    vi.mocked(downloadPdf).mockImplementationOnce((bytes, filename) => {
      downloads.push({ filename, bytes });
    });

    const path = await segmentRunner.value!.exportSegment(0, 99, '测试书_001.pdf');

    expect(exportRasterPdf).toHaveBeenCalledTimes(1);
    expect(path).toBe('测试书_001.pdf');
    expect(downloads[0]?.filename).toBe('测试书_001.pdf');
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
    hostState.isDesktop = true;
    const bridgeExport = vi.fn(async () => new Uint8Array([7]));
    window.electronPdf = { exportPdf: bridgeExport };
    const deps = makeDeps('in-app');
    const { onExportPdf } = useExport(deps);

    await onExportPdf();

    expect(bridgeExport).toHaveBeenCalledTimes(1);
    expect(exportRasterPdf).not.toHaveBeenCalled();
    expect(printHtml).not.toHaveBeenCalled();
    /* 桌面分支不走浏览器 Blob 下载，由宿主端口落盘 */
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(deps.pushToast).toHaveBeenCalledWith(expect.stringContaining('Electron'), 'success');
  });

  it('桌面宿主（window.ipcRenderer）：打开分段导出弹窗，确认前不发导出 IPC', async () => {
    hostState.isDesktop = true;
    const channels: string[] = [];
    const handlePromise = vi.fn(async (channel: string) => {
      channels.push(channel);
      return { success: true };
    });
    (window as unknown as { ipcRenderer?: unknown }).ipcRenderer = {
      handlePromise,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const deps = makeDeps('in-app');
    /* 书档注入一张内联缺字图（分段弹窗确认后会去重令牌化并逐张上传） */
    const doc = deps.reader.reader.value.document!;
    (doc.root.children ??= []).push({
      type: NODE_TYPES.GLYPH_IMAGE,
      attrs: { src: 'data:image/png;base64,AAAA' },
    });
    const { onExportPdf, segmentDialogOpen, segmentRunner, segmentTitle, segmentTotalPages } =
      useExport(deps);

    await onExportPdf();

    /* 打开弹窗即返回：begin / asset / prepare / segment 都由弹窗确认后触发 */
    expect(channels).toEqual([]);
    expect(segmentDialogOpen.value).toBe(true);
    expect(segmentRunner.value).not.toBeNull();
    expect(segmentTitle.value).toBe('测试书');
    expect(exportRasterPdf).not.toHaveBeenCalled();
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(printHtml).not.toHaveBeenCalled();
  });
  it('桌面宿主但无任何导出通道：明确报错，不静默落到浏览器打印', async () => {
    hostState.isDesktop = true;
    const deps = makeDeps('in-app');
    const { onExportPdf, segmentDialogOpen } = useExport(deps);

    await onExportPdf();

    expect(segmentDialogOpen.value).toBe(false);
    expect(printHtml).not.toHaveBeenCalled();
    expect(renderPrintHtml).not.toHaveBeenCalled();
    expect(deps.pushToast).toHaveBeenCalledWith(expect.stringContaining('导出通道不可用'), 'error');
  });

  it('弹窗分段导出失败：段错误返回给弹窗（由弹窗标红该段并停止）', async () => {
    const deps = makeDeps('in-app');
    const { onExportPdf, segmentRunner } = useExport(deps);
    await onExportPdf();

    vi.mocked(exportRasterPdf).mockImplementationOnce(async () => {
      throw new Error('画布导出 JPEG 失败。');
    });

    await expect(segmentRunner.value!.exportSegment(0, 99, '测试书_001.pdf')).rejects.toThrow(
      '画布导出 JPEG 失败',
    );
    expect(downloadPdf).not.toHaveBeenCalled();
  });
});
