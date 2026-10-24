/**
 * 导出 / 打印（EPUB · PDF）
 *
 * EPUB：按当前主题、字号行距与配色令牌所见即所得导出（含已保存编辑内容），
 * 导出前跑 epubcheck 规则子集校验，error 汇总提示（避免「自研能开、第三方打不开」）。
 * PDF 三条路径——
 * 1. Electron 宿主（window.electronPdf）：自包含 HTML → printToPDF 矢量直出，恒定可用；
 * 2. 浏览器「应用内直出」（pdfExportMode 缺省）：exportRasterPdf 逐页光栅化后
 *    经 pdf-lib 拼成 PDF 直接下载，免打印对话框、带进度可中止，大部头显著更快；
 * 3. 浏览器「浏览器对话框导出」：blob 化去重 + 隐藏 iframe 打印（需手动另存为 PDF）。
 * 缺字（K6）只警告、不阻断。
 *
 * 消费 layout / reader 两块产出的响应式引用，保证与屏幕预览同源。
 */
import { ref } from 'vue';
import { DEFAULT_THEME, FONT_TOKENS } from '@bibliotype/core';
import {
  collectEpubGlyphProblems,
  exportEpub,
  type ValidationProblem,
} from '@bibliotype/exporter-epub';
import {
  collectPdfGlyphProblems,
  createImageBlobRewriter,
  downloadPdf,
  exportPdfBytes,
  exportRasterPdf,
  printHtml,
  renderPrintHtml,
  summarizePdfGlyphProblems,
  type PdfAdapterOptions,
} from '@bibliotype/exporter-pdf';
import { createFontCheckProbe, splitFontFamilyList } from '@bibliotype/vue';
import { lunyuDocument } from '../data/lunyu.js';
import type { PdfExportMode, PdfRasterScale } from './use-settings-snapshot.js';
import type { LayoutTokensApi } from './use-layout-tokens.js';
import type { ReaderSessionApi } from './use-reader-session.js';
import type { useToast } from './use-toast.js';

/**
 * 宿主注入的 PDF 导出桥（Electron preload 挂载到 window.electronPdf）
 *
 * 契约见 docs/08-export-pdf.md：主进程以离屏窗口加载自包含 HTML 后
 * `webContents.printToPDF()`，经 IPC 回传 PDF 字节。浏览器无此桥。
 */
interface ElectronPdfBridge {
  exportPdf(html: string, options?: PdfAdapterOptions): Promise<Uint8Array>;
}

declare global {
  interface Window {
    electronPdf?: ElectronPdfBridge;
  }
}

export interface ExportDeps {
  layout: LayoutTokensApi;
  reader: ReaderSessionApi;
  pushToast: ReturnType<typeof useToast>['push'];
  /** PDF 导出方式（「其他」分区；仅影响纯浏览器环境，Electron 恒走矢量桥） */
  pdfExportMode: { value: PdfExportMode };
  /** 光栅直出清晰度档位（「其他」分区；仅应用内直出生效） */
  pdfRasterScale: { value: PdfRasterScale };
}

/** EPUB / PDF 导出动作与状态 */
export function useExport(deps: ExportDeps) {
  const { layout, reader: readerApi, pushToast, pdfExportMode, pdfRasterScale } = deps;

  /** PDF 导出是否进行中（按钮置灰 + 文案切换；导出中再点 = 中止） */
  const pdfExporting = ref(false);
  /** 应用内直出逐页进度（null = 非光栅路径或未开始） */
  const pdfProgress = ref<{ done: number; total: number } | null>(null);
  /** 当前导出的中止控制器（同刻至多一个导出任务） */
  let pdfAbort: AbortController | undefined;
  /** PDF 分页模式：true = 逐页（paged，与屏幕预览同源）/ false = 连续（auto，更快） */
  const pdfPagedMode = ref(true);
  /** 双页对照（D5）：以当前文档左右对页演示对照容器 */
  const compareOpen = ref(false);

  /**
   * 导出前缺字检查（K6）：只警告、不阻断
   *
   * 探测走 `document.fonts.check`；缺字在阅读器与打印里都会变豆腐块，但补字是
   * 作者决策，所以只提示不拦截。宿主若登记了 IDS 描述，可在提示里看到「可合成」。
   */
  function warnGlyphProblems(kind: 'epub' | 'pdf'): void {
    const book = readerApi.reader.value.document ?? lunyuDocument;
    const stack =
      layout.tokens.value[layout.activeFontToken.value] ?? DEFAULT_THEME[FONT_TOKENS.BODY] ?? '';
    const families = splitFontFamilyList(stack);
    const probe = createFontCheckProbe();

    if (kind === 'epub') {
      const problems = collectEpubGlyphProblems(book, { families, probe });
      if (problems.length > 0) {
        pushToast(
          `导出含 ${problems.length} 处缺字（可先补字体）：${problems[0]?.message ?? ''}`,
          'info',
        );
      }
      return;
    }

    const issues = collectPdfGlyphProblems(book, { families, probe });
    if (issues.length > 0) pushToast(summarizePdfGlyphProblems(issues), 'info');
  }

  /** 触发浏览器下载 */
  function download(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** 导出 EPUB（按当前主题、字号行距与配色令牌，所见即所得；含已保存的编辑内容） */
  function onExportEpub(): void {
    warnGlyphProblems('epub');
    const fontToken = layout.activeFontToken.value;
    const book = readerApi.reader.value.document ?? lunyuDocument;
    /* 导出前校验（epubcheck 规则子集）：error 级问题在此汇总提示，
       避免「自研阅读器能开、京东读书 / 微信读书打不开」的兼容黑洞。 */
    const problems: ValidationProblem[] = [];
    const bytes = exportEpub(book, {
      layout: layout.effectiveLayout.value,
      tokens: layout.tokens.value,
      fontToken,
      features: layout.features.value,
      namedStyles: layout.namedStyles.value,
      onValidation: (list) => {
        problems.push(...list);
      },
    });
    download('论语.epub', new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' }));
    reportExportProblems(problems);
  }

  /**
   * 导出校验结果 → 消息条
   *
   * 无问题：一条「已导出 EPUB」成功提示；有问题：按 error / warning 给不同语气，
   * 并把前 3 条明细带进文案（完整清单仍逐条打印到 console）。
   */
  function reportExportProblems(problems: readonly ValidationProblem[]): void {
    if (problems.length === 0) {
      pushToast('已导出 EPUB（校验通过）', 'success');
      return;
    }
    const errors = problems.filter((p) => p.severity === 'error');
    const head = errors.length > 0 ? `导出校验 ${errors.length} 个错误` : '导出校验通过（有警告）';
    const detail = problems
      .slice(0, 3)
      .map((p) => `${p.severity === 'error' ? '✕' : '!'} ${p.message}`)
      .join('；');
    pushToast(
      `${head}：${detail}${problems.length > 3 ? ` 等 ${problems.length} 项` : ''}`,
      errors.length > 0 ? 'error' : 'info',
    );
    for (const p of problems) {
      const line = `[epub-export] ${p.severity} ${p.code}: ${p.message}${p.path !== undefined ? ` (${p.path})` : ''}`;
      if (p.severity === 'error') console.error(line);
      else console.warn(line);
    }
  }

  /** 宿主 PDF 桥（Electron 注入；浏览器为 undefined → 走降级） */
  function getElectronPdfBridge(): ElectronPdfBridge | undefined {
    return typeof window !== 'undefined' ? window.electronPdf : undefined;
  }

  /**
   * 导出 PDF（替代原「打印 PDF」）
   *
   * 分页模式（pdfPagedMode）：逐页（paged，与屏幕预览逐页同源）/ 连续（auto，更快）。
   * 逐页模式附带屏幕实测数据（与预览同源）；连续模式由打印引擎分页。
   *
   * 路由：Electron 桥恒走矢量直出（设置项不影响宿主）；无桥时按「其他」分区的
   * 导出方式走应用内光栅直出（带进度，可中止）或浏览器打印对话框。导出中再点
   * = 中止当前任务。
   */
  async function onExportPdf(): Promise<void> {
    /* 导出中再点 = 中止：光栅路径逐页响应，打印对话框路径无可中止语义（不处理） */
    if (pdfExporting.value) {
      pdfAbort?.abort();
      return;
    }

    warnGlyphProblems('pdf');
    const fontToken = layout.activeFontToken.value;
    const book = readerApi.reader.value.document ?? lunyuDocument;
    const base = {
      layout: layout.effectiveLayout.value,
      tokens: layout.tokens.value,
      fontToken,
      features: layout.features.value,
      namedStyles: layout.namedStyles.value,
      mode: (pdfPagedMode.value ? 'paged' : 'auto') as 'paged' | 'auto',
    };
    const measured =
      base.mode === 'paged'
        ? {
            pageMainSize: readerApi.pageMainSize.value,
            bottomSlack: readerApi.bottomSlack.value,
            context: readerApi.typographyMeasure(),
            blockSizes: readerApi.blockSizes.value,
            lineOffsets: readerApi.blockLineOffsets.value,
            lineSizes: readerApi.blockLineSizes.value,
            lineMainSizes: readerApi.blockLineMainSizes.value,
            bodySizes: readerApi.blockBodySizes.value,
          }
        : {};

    pdfExporting.value = true;
    pdfProgress.value = null;
    pdfAbort = new AbortController();
    const { signal } = pdfAbort;
    try {
      const bridge = getElectronPdfBridge();
      if (bridge !== undefined) {
        /* adapter 路径：自包含 HTML（不传 rewriteSrc，离屏窗口拿不到 blob: URL） */
        const bytes = await exportPdfBytes(book, {
          ...base,
          ...measured,
          adapter: { toPdf: (html, opts) => bridge.exportPdf(html, opts) },
        });
        downloadPdf(bytes, `${book.metadata.title || '书籍'}.pdf`);
        pushToast('已导出 PDF（Electron 打印引擎）', 'success');
        return;
      }

      if (pdfExportMode.value === 'in-app') {
        /* 应用内直出：逐页光栅化 → pdf-lib 拼装 → 直接下载（免打印对话框）；
         * 清晰度档位取「其他」分区设置（1~4，缺省标准 192dpi） */
        const bytes = await exportRasterPdf(book, {
          ...base,
          ...measured,
          scale: pdfRasterScale.value,
          signal,
          onProgress: (done, total) => {
            pdfProgress.value = { done, total };
          },
        });
        downloadPdf(bytes, `${book.metadata.title || '书籍'}.pdf`);
        pushToast(`已导出 PDF（应用内直出，${base.mode === 'paged' ? '逐页' : '连续'}版面）`, 'success');
        return;
      }

      /* 浏览器对话框导出：blob 化去重 + iframe 打印 */
      const rewriter = createImageBlobRewriter();
      try {
        const html = renderPrintHtml(book, { ...base, ...measured, rewriteSrc: rewriter.rewrite });
        printHtml(html, { onAfterPrint: () => rewriter.revokeAll() });
        pushToast(
          `已打开打印对话框，请选择「另存为 PDF」；${rewriter.uniqueCount} 张唯一图片已去重，大书需数十秒`,
          'info',
          8000,
        );
      } catch (error) {
        rewriter.revokeAll();
        throw error;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        pushToast('PDF 导出已中止', 'info');
      } else {
        pushToast(`导出 PDF 失败：${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    } finally {
      pdfExporting.value = false;
      pdfProgress.value = null;
      pdfAbort = undefined;
    }
  }

  return {
    pdfExporting,
    pdfProgress,
    pdfPagedMode,
    compareOpen,
    download,
    onExportEpub,
    onExportPdf,
  };
}
