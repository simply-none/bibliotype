/**
 * 导出 / 打印（EPUB · PDF）
 *
 * 环境判别式：`host.isDesktop`（web 宿主恒 false，Electron 宿主恒 true）。
 * - Web：EPUB / 文本走浏览器下载；PDF 按「其他」分区设置走应用内光栅直出或打印对话框。
 * - Electron：EPUB / 文本经宿主同步 IPC 直接落盘（回传绝对路径）；PDF 恒走矢量打印引擎
 *   （`bibliotype:export-*` 分段会话，逐段落盘）。桌面通道缺失时明确报错，不静默降级。
 *
 * EPUB：按当前主题、字号行距与配色令牌所见即所得导出（含已保存编辑内容），
 * 导出前跑 epubcheck 规则子集校验，error 汇总提示（避免「自研能开、第三方打不开」）。
 * 缺字（K6）只警告、不阻断。
 *
 * 消费 layout / reader 两块产出的响应式引用，保证与屏幕预览同源。
 */
import { ref, shallowRef } from 'vue';
import { DEFAULT_THEME, FONT_TOKENS, type BookDocument } from '@bibliotype/core';
import {
  collectEpubGlyphProblems,
  exportEpub,
  type ValidationProblem,
} from '@bibliotype/exporter-epub';
import {
  collectPdfGlyphProblems,
  createImageBlobRewriter,
  dedupeInlineImages,
  downloadPdf,
  exportPdfBytes,
  exportRasterPdf,
  printHtml,
  renderPrintHtml,
  summarizePdfGlyphProblems,
  type PdfAdapterOptions,
  type RasterPdfOptions,
} from '@bibliotype/exporter-pdf';
import { createFontCheckProbe, splitFontFamilyList } from '@bibliotype/vue';
import { lunyuDocument } from '../data/lunyu.js';
import { host } from '../host/index.js';
import type { ExportFileResult } from '../host/types.js';
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

/**
 * 桌面宿主 preload 暴露的通用 IPC 桥（仅取 PDF 导出用到的三个方法）
 *
 * 刻意不写 `declare global { interface Window ... }`：宿主项目（如 Electron 应用）
 * 往往已对 `window.ipcRenderer` 做了完整声明，重复声明会因修饰符 / 类型不一致
 * 导致 `vue-tsc` 报 TS2687 / TS2717。这里改为局部类型 + `globalThis` 断言。
 */
interface DesktopIpcBridge {
  handlePromise: (channel: string, args?: unknown) => Promise<unknown>;
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
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

/** 收敛分段页数（clamp 100~2000） */
function clampSegmentPages(segmentPages: number): number {
  return Math.min(2000, Math.max(100, Math.round(segmentPages)));
}

/**
 * 跨 contextBridge 安全化：深拷贝为纯对象 / 数组 / Map / Set
 *
 * 背景（Electron 44 实测）：渲染端 → preload 的函数参数要过 contextBridge 的
 * 结构化克隆；`Map` / `Set` 原样支持，但 **Vue 的 `ref` / `reactive` 值（Proxy）
 * 会直接抛 `An object could not be cloned.`**，而报错发生在渲染端、preload 的
 * 消毒函数还没机会执行——桌面导出因此静默失败（弹窗仍显示成功、磁盘无文件）。
 *
 * 书档里未改动的节点与打印选项的 `features` / `namedStyles` 都直接来自 ref，
 * 必须先去代理再交给 IPC。
 *
 * @param value 待安全化的值（可含 Proxy / Map / Set / 数组 / 嵌套对象）
 * @param seen 循环引用缓存（内部递归用）
 * @returns 同结构纯值：Map 仍为 Map、Set 仍为 Set、对象为纯对象
 */
export function toPlainPayload<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  const tag = Object.prototype.toString.call(value);

  if (tag === '[object Map]') {
    const cached = seen.get(value as object) as Map<unknown, unknown> | undefined;
    if (cached !== undefined) return cached as unknown as T;
    const out = new Map<unknown, unknown>();
    seen.set(value as object, out);
    for (const [key, item] of value as unknown as Map<unknown, unknown>) {
      out.set(toPlainPayload(key, seen), toPlainPayload(item, seen));
    }
    return out as unknown as T;
  }

  if (tag === '[object Set]') {
    const cached = seen.get(value as object) as Set<unknown> | undefined;
    if (cached !== undefined) return cached as unknown as T;
    const out = new Set<unknown>();
    seen.set(value as object, out);
    for (const item of value as unknown as Set<unknown>) out.add(toPlainPayload(item, seen));
    return out as unknown as T;
  }

  if (Array.isArray(value) || tag === '[object Object]') {
    const cached = seen.get(value as object) as unknown;
    if (cached !== undefined) return cached as T;
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value as object, out);
      for (const item of value as unknown[]) out.push(toPlainPayload(item, seen));
      return out as unknown as T;
    }
    const out: Record<string, unknown> = {};
    seen.set(value as object, out);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = toPlainPayload((value as Record<string, unknown>)[key], seen);
    }
    return out as unknown as T;
  }

  /* Date / RegExp / TypedArray / ArrayBuffer 等结构化克隆原生支持的类型原样放行 */
  return value;
}

/** 分段方案条目（from / to 为 0 起含端点页码） */
export interface SegmentPlanItem {
  /** 卷序号（1 起） */
  index: number;
  from: number;
  to: number;
}

/** 按总页数与每卷页数计算分段方案（展示与实际导出同源） */
export function buildSegmentPlan(totalPages: number, segmentPages: number): SegmentPlanItem[] {
  const size = clampSegmentPages(segmentPages);
  const total = Math.max(0, Math.floor(totalPages));
  const count = Math.max(1, Math.ceil(total / size));
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    from: index * size,
    to: Math.min(total - 1, (index + 1) * size - 1),
  }));
}

/** 分段导出执行器（弹窗驱动；桌面与浏览器各有一个实现） */
export interface PdfSegmentedRunner {
  /** 执行器类型（桌面 = 宿主会话；浏览器 = 逐段光栅下载） */
  readonly kind: 'desktop' | 'browser';
  /**
   * 开始会话：书档 data URI 去重 → 逐张上传图片 → 主进程缓存分页器
   *
   * @param onUploadProgress 图片上传进度（done / total；浏览器实现不经过上传，恒 0/0）
   * @returns 分页后的总页数（实际分段表据此计算）
   */
  start(onUploadProgress?: (done: number, total: number) => void): Promise<{ pageCount: number }>;
  /** 打印一个页区间（0 起含端点）并落盘 → 文件路径（浏览器实现触发下载后返回文件名） */
  exportSegment(from: number, to: number, filename: string): Promise<string>;
}

/**
 * 创建分段导出执行器（桌面宿主实现）
 *
 * 会话协议（渐离App `bibliotype:export-*`）：书档 data URI 去重令牌化后逐张
 * 上传（宿主收即写临时资源文件），`export-prepare` 在主进程缓存分页器——
 * 后续逐段 `export-segment` 复用，整本 HTML 与书档均不过 IPC。
 *
 * 书档与打印选项在发送前一律经 `toPlainPayload` 去代理：它们直接来自
 * `ref` / `reader`，是 Vue 的 Proxy，过 contextBridge 会抛
 * `An object could not be cloned.`（曾在 Electron 里表现为「提示成功但无文件」）。
 */
export function createSegmentedPdfRunner(args: {
  channel: (channel: string, args?: unknown) => Promise<unknown>;
  book: BookDocument;
  options: Record<string, unknown>;
  title: string;
}): PdfSegmentedRunner {
  let exportId: string | null = null;
  /** 会话失败后单发回退的落盘路径（非 null 表示整本已由主进程一次打印完成） */
  let fallbackPath: string | null = null;
  /* 打印选项只随会话走一次：去代理后缓存，prepare 与单发回退共用 */
  const options = toPlainPayload(args.options);
  return {
    kind: 'desktop',
    async start(onUploadProgress) {
      try {
        const { document: slimDocument, assets } = dedupeInlineImages(args.book);
        /* 去重后未改动的节点仍是原 Proxy：必须整体去代理后再过桥 */
        const plainDocument = toPlainPayload(slimDocument);
        const begin = (await args.channel('bibliotype:export-begin', {})) as {
          exportId?: string;
          error?: string;
        };
        if (begin?.exportId === undefined) {
          throw new Error(`[桌面导出·开始会话] ${begin?.error ?? '未返回会话 id'}`);
        }
        exportId = begin.exportId;
        for (let index = 0; index < assets.length; index += 1) {
          const asset = assets[index]!;
          onUploadProgress?.(index, assets.length);
          const result = (await args.channel('bibliotype:export-asset', {
            exportId,
            token: asset.token,
            dataUri: asset.dataUri,
          })) as { success?: boolean; error?: string };
          if (result?.success !== true) {
            throw new Error(`[桌面导出·上传图片 ${asset.token}] ${result?.error ?? '接收失败'}`);
          }
        }
        onUploadProgress?.(assets.length, assets.length);
        const prepared = (await args.channel('bibliotype:export-prepare', {
          exportId,
          document: plainDocument,
          options,
        })) as { pageCount?: number; error?: string };
        if (prepared?.pageCount === undefined) {
          throw new Error(`[桌面导出·预分页] ${prepared?.error ?? '未返回页数'}`);
        }
        return { pageCount: prepared.pageCount };
      } catch (error) {
        /* 会话链路（begin / asset / prepare）失败：改走主进程单发形态
         * （一次性 renderPrintHtml + printToPDF + 落盘），保证「能导出」优先于
         * 「分段省内存」；单发也失败时把两条原因一起抛出，便于定位。 */
        const result = (await args.channel('bibliotype:export-pdf', {
          document: toPlainPayload(args.book),
          options,
          filename: `${args.title || '书籍'}.pdf`,
        })) as { success?: boolean; path?: string; error?: string };
        if (result?.success === true && result.path !== undefined) {
          fallbackPath = result.path;
          return { pageCount: 1 };
        }
        throw new Error(
          `[桌面导出] 分段会话失败：${error instanceof Error ? error.message : String(error)}；` +
            `整本单发也失败：${result?.error ?? '未返回落盘路径'}`,
        );
      }
    },
    async exportSegment(from, to, filename) {
      /* 单发回退：整本已落盘，只有一段，直接回传真实路径 */
      if (fallbackPath !== null) return fallbackPath;
      if (exportId === null) throw new Error('[桌面导出·分段] 会话未开始');
      const result = (await args.channel('bibliotype:export-segment', {
        exportId,
        from,
        to,
        filename,
      })) as { success?: boolean; path?: string; error?: string };
      if (result?.success !== true || result.path === undefined) {
        throw new Error(`[桌面导出·分段 ${from + 1}-${to + 1}] ${result?.error ?? '导出失败'}`);
      }
      return result.path;
    },
  };
}

/**
 * 创建分段导出执行器（浏览器实现）
 *
 * 大书在浏览器同样撞「整本光栅 + 单文件内存墙」：逐段调 `exportRasterPdf`
 * 的页区间形态（`from` / `to`），每段独立光栅化为单卷 PDF 触发浏览器下载。
 * 每次分卷共享同一份分页（exportRasterPdf 内部 createPrintPager，
 * 与预览同源实测口径下页序一致），内存峰值 = 单卷。
 */
export function createBrowserSegmentedPdfRunner(args: {
  book: () => BookDocument;
  options: () => Record<string, unknown>;
  scale: number;
  signal: () => AbortSignal | undefined;
  download: (bytes: Uint8Array, filename: string) => void;
}): PdfSegmentedRunner {
  return {
    kind: 'browser',
    async start() {
      /* 页数以预分页口径为准：用 exportRasterPdf 的空跑会重复整本光栅，
       * 这里直接读 reader 的总页数由弹窗传入；浏览器实现无需上传资源 */
      return { pageCount: 0 };
    },
    async exportSegment(from, to, filename) {
      const bytes = await exportRasterPdf(args.book(), {
        ...(args.options() as RasterPdfOptions),
        scale: args.scale,
        signal: args.signal(),
        from,
        to,
      });
      args.download(bytes, filename);
      return filename;
    },
  };
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
  /** 桌面宿主分段导出弹窗：打开状态 / 执行器 / 书名 / 预览总页数 */
  const segmentDialogOpen = ref(false);
  const segmentRunner = shallowRef<PdfSegmentedRunner | null>(null);
  const segmentTitle = ref('');
  const segmentTotalPages = ref(0);
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

  /**
   * 触发文件下载（委托宿主）
   *
   * web：浏览器下载；Electron：写宿主缓存目录并返回落盘路径。
   *
   * @param filename 文件名（含扩展名）
   * @param bytes 文件字节
   * @returns 导出结果（Electron 含落盘路径；失败含原因）
   */
  function download(filename: string, bytes: Uint8Array): ExportFileResult {
    return host.downloadBytes(bytes, filename);
  }

  /** 导出 EPUB（按当前主题、字号行距与配色令牌，所见即所得；含已保存的编辑内容） */
  function onExportEpub(): void {
    warnGlyphProblems('epub');
    const fontToken = layout.activeFontToken.value;
    const book = readerApi.reader.value.document ?? lunyuDocument;
    /* 导出前校验（epubcheck 规则子集）：error 级问题在此汇总提示，
       避免「自研阅读器能开、京东读书 / 微信读书打不开」的兼容黑洞。 */
    const problems: ValidationProblem[] = [];
    let bytes: Uint8Array;
    try {
      bytes = exportEpub(book, {
        layout: layout.effectiveLayout.value,
        tokens: layout.tokens.value,
        fontToken,
        features: layout.features.value,
        namedStyles: layout.namedStyles.value,
        onValidation: (list) => {
          problems.push(...list);
        },
      });
    } catch (error) {
      /* 生成阶段异常（书档异常 / 字体资源缺失）不能静默：此前无捕获会让点击毫无反应 */
      pushToast(`导出 EPUB 失败：${error instanceof Error ? error.message : String(error)}`, 'error');
      return;
    }
    /* 文件名取书名：此前写死「论语.epub」，导入的书导出后全叫《论语》 */
    const result = download(`${book.metadata.title || '书籍'}.epub`, bytes);
    if (!result.ok) {
      pushToast(`导出 EPUB 失败：${result.error ?? '未知原因'}`, 'error');
      return;
    }
    reportExportProblems(problems, result.path);
  }

  /**
   * 导出校验结果 → 消息条
   *
   * 无问题：一条「已导出 EPUB」成功提示；有问题：按 error / warning 给不同语气，
   * 并把前 3 条明细带进文案（完整清单仍逐条打印到 console）。
   *
   * @param problems 校验问题清单
   * @param savedPath 落盘绝对路径（Electron 宿主有值；Web 缺省）
   */
  function reportExportProblems(
    problems: readonly ValidationProblem[],
    savedPath?: string,
  ): void {
    if (problems.length === 0) {
      pushToast(
        savedPath === undefined
          ? '已导出 EPUB（校验通过）'
          : `已导出 EPUB（校验通过）：${savedPath}`,
        'success',
      );
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
    return typeof window !== 'undefined'
      ? (window as unknown as { electronPdf?: ElectronPdfBridge }).electronPdf
      : undefined;
  }

  /**
   * 桌面宿主通用 IPC（渐离App preload 暴露的 contextBridge；浏览器为 undefined）
   *
   * 命中时「导出 PDF」打开分段导出弹窗：书档 + 打印选项交 `bibliotype:export-*`
   * 会话（资源逐张上传收即落盘 / 按页区间分段 printToPDF 逐段落盘多文件）——
   * 矢量小文件，绕开光栅路径的整本内存墙。
   */
  function getDesktopIpc():
    | { channel: (channel: string, args?: unknown) => Promise<unknown> }
    | undefined {
    const bridge =
      typeof window !== 'undefined'
        ? (window as unknown as { ipcRenderer?: DesktopIpcBridge }).ipcRenderer
        : undefined;
    if (bridge === undefined || typeof bridge.handlePromise !== 'function') return undefined;
    /* 宿主 preload 的 handlePromise 多数要求传对象，这里兜底为空对象 */
    return { channel: (channel, args) => bridge.handlePromise(channel, args ?? {}) };
  }


  /**
   * 导出 PDF（替代原「打印 PDF」）
   *
   * 分页模式（pdfPagedMode）：逐页（paged，与屏幕预览逐页同源）/ 连续（auto，更快）。
   * 逐页模式附带屏幕实测数据（与预览同源）；连续模式由打印引擎分页。
   *
   * 路由（判别式 `host.isDesktop`）：
   * - Electron：矢量桥（window.electronPdf）优先并直接落盘；否则用 preload 的
   *   ipcRenderer 打开 `bibliotype:export-*` 分段会话弹窗。两者都缺则明确报错。
   * - Web：按「其他」分区的导出方式走应用内光栅直出（带进度，可中止）或浏览器打印对话框。
   * 导出中再点 = 中止当前任务。
   */
  async function onExportPdf(): Promise<void> {
    /* 导出中再点 = 中止：光栅路径逐页响应；桌面宿主分段路径透传中止（当前段完成后
     * 停止）；打印对话框路径无可中止语义（不处理） */
    if (pdfExporting.value) {
      pdfAbort?.abort();
      void getDesktopIpc()
        ?.channel('bibliotype:export-abort', {})
        .catch(() => undefined);
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
      /* 判别式：桌面宿主恒走 Electron 打印引擎；Web 走浏览器光栅 / 打印对话框 */
      if (host.isDesktop) {
        const bridge = getElectronPdfBridge();
        if (bridge !== undefined) {
          /* 矢量桥：自包含 HTML → 离屏窗口 printToPDF（不传 rewriteSrc，离屏窗口拿不到 blob: URL），
           * 结果经宿主 IPC 直接落盘（不走浏览器 Blob 下载）。 */
          const bytes = await exportPdfBytes(book, {
            ...base,
            ...measured,
            adapter: { toPdf: (html, opts) => bridge.exportPdf(html, opts) },
          });
          const result = download(`${book.metadata.title || '书籍'}.pdf`, bytes);
          if (!result.ok) throw new Error(result.error ?? '写入 PDF 文件失败');
          pushToast(
            result.path === undefined
              ? '已导出 PDF（Electron 打印引擎）'
              : `已导出 PDF（Electron 打印引擎）：${result.path}`,
            'success',
          );
          return;
        }

        const desktop = getDesktopIpc();
        if (desktop === undefined) {
          /* 无桌面通道：明确报错。此前会静默落到浏览器打印对话框，在 Electron 里表现为「点了没反应」 */
          pushToast(
            'Electron 导出通道不可用：preload 未暴露 ipcRenderer / electronPdf，无法调用矢量打印引擎',
            'error',
          );
          return;
        }

        /* 桌面宿主（如渐离App）：打开分段导出弹窗——用户设置每卷页数、预览分段区域，
         * 确认后弹窗内逐段矢量打印并独立落盘（`书名_00x.pdf`），不合并单文件。
         * 书档里同一缺字图以完整 data URI 逐处重复（整本数百 MB），会话协议把
         * 传输与打印都拆成有界小片（资源逐张上传收即落盘 / 每段独立 printToPDF）。 */
        segmentRunner.value = createSegmentedPdfRunner({
          channel: desktop.channel,
          book,
          options: { ...base, mode: 'paged' as const, ...measured },
          title: book.metadata.title || '书籍',
        });
        segmentTitle.value = book.metadata.title || '书籍';
        segmentTotalPages.value = readerApi.reader.value.totalPages;
        segmentDialogOpen.value = true;
        return;
      }

      if (pdfExportMode.value === 'in-app') {
        /* 浏览器「应用内直出」：同样打开分段导出弹窗——大书整本光栅 + 单文件
         * 下载会撞内存墙，改为逐段光栅（exportRasterPdf 页区间形态）独立下载
         * `书名_00x.pdf`；清晰度档位取「其他」分区设置。 */
        segmentRunner.value = createBrowserSegmentedPdfRunner({
          book: () => readerApi.reader.value.document ?? lunyuDocument,
          options: () => ({ ...base, mode: 'paged' as const, ...measured }),
          scale: pdfRasterScale.value,
          signal: () => pdfAbort?.signal,
          download: (bytes, filename) =>
            downloadPdf(bytes, filename),
        });
        segmentTitle.value = book.metadata.title || '书籍';
        segmentTotalPages.value = readerApi.reader.value.totalPages;
        segmentDialogOpen.value = true;
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
      } else if (error instanceof Error && error.message.includes('已中止')) {
        /* 桌面宿主分段导出的中止经错误通道返回 */
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
    /** 桌面宿主分段导出弹窗（仅桌面宿主路由会打开） */
    segmentDialogOpen,
    segmentRunner,
    segmentTitle,
    segmentTotalPages,
  };
}
