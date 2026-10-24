/**
 * 应用内光栅直出 PDF（免打印对话框）
 *
 * 动机：纯浏览器环境导出 PDF 只能走 iframe + `window.print()` 打印对话框——
 * 大部头（千页级）打印预览要渲染全部页面，分钟级且需手动「另存为 PDF」。
 * 本模块改走「逐页光栅化」：打印分页器（`createPrintPager`）给出与预览同源的
 * 固定页片段，每页由真浏览器排版引擎渲染进 `<svg><foreignObject>` 后转位图，
 * 经 pdf-lib 逐页拼成 PDF 文件直接下载——免对话框、进度可回调、可中止。
 *
 * 产物是图片型 PDF（文字不可选中）；矢量文字仍走 Electron 宿主 `printToPDF`
 * （`exportPdfBytes`）或打印对话框路径。
 *
 * 并发流水线：光栅化按滑动窗口并发（SVG 解码与下一页序列化重叠、Worker 编码
 * 完全离主线程），PDF 页序恒按页码嵌入，进度与中止语义不受并发影响。
 *
 * foreignObject 行为要点（Chromium）：
 * - SVG 以图像加载时禁**外部**资源，但系统字体与 data URI 图片可用——
 *   打印 CSS 的字体按令牌落到系统字体族，图片在降级链路已是 data URI；
 * - 内容必须 XML 合法：这里不走字符串拼 SVG，而是 DOM 构造后
 *   `XMLSerializer` 序列化（`&nbsp;` 等已解析为真实字符，输出天然合法 XML）。
 */
import { PDFDocument } from 'pdf-lib';
import type { BookDocument } from '@bibliotype/core';
import { DEFAULT_LAYOUT_OPTIONS } from '@bibliotype/layout';
import { createPrintPager, type PrintDocumentOptions } from './print-document.js';
import { resolveBleedPx } from './print-styles.js';
import { createWorkerRasterPool, supportsWorkerRaster, type WorkerRasterPool } from './raster-worker.js';

/** 光栅直出选项（打印文档选项 + 光栅控制） */
export interface RasterPdfOptions extends PrintDocumentOptions {
  /**
   * 清晰度档位（canvas 缩放倍率，1~4，非法值回退 2）
   *
   * 1 = 96dpi（草稿，文件最小）；2 = 192dpi（标准，缺省）；3 = 288dpi（高清）；
   * 4 = 384dpi（印刷）。像素量、编码耗时与文件体积按倍率平方增长。
   */
  scale?: number;
  /** JPEG 质量（0~1，缺省 0.92） */
  quality?: number;
  /**
   * 光栅化并发窗口（1~6，非法值回退 3）
   *
   * 同时在途的页光栅任务数：SVG 解码 / Worker 编码与下一页序列化重叠。
   * PDF 页序恒按页码嵌入，进度与中止语义不受并发影响。
   */
  concurrency?: number;
  /** 逐页进度回调（done / total，均为含首页的完成数） */
  onProgress?: (done: number, total: number) => void;
  /** 中止信号：每轮循环检查，中止后抛 `AbortError` */
  signal?: AbortSignal;
  /**
   * 页区间导出（0 起含端点，缺省整本）
   *
   * 分段多文件导出用：只光栅化 `[from, to]` 区间内的页面产出**单卷 PDF**，
   * 与整本导出共用同一份分页（页序、页码、样式完全一致）；越界自动收敛。
   */
  from?: number;
  to?: number;
  /**
   * 单页光栅化回调（注入用）
   *
   * 输入单页 `.bt-page` 片段与页面 CSS 尺寸（px，已含出血放大），
   * 输出 JPEG 字节。缺省为浏览器实现（foreignObject → canvas → Worker 编码）；
   * Node 测试注入 mock 不触 DOM，且注入后不启用 Worker 池。
   */
  rasterize?: (pageHtml: string, width: number, height: number) => Promise<Uint8Array>;
}

/** 清晰度档位收敛（clamp 1~4，非有限数值回退 2 = 192dpi 标准） */
export function resolveRasterScale(scale: number | undefined): number {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return 2;
  return Math.min(4, Math.max(1, Math.round(scale)));
}

/** 并发窗口收敛（clamp 1~6，非有限数值回退 3） */
export function resolveRasterConcurrency(concurrency: number | undefined): number {
  if (typeof concurrency !== 'number' || !Number.isFinite(concurrency)) return 3;
  return Math.min(6, Math.max(1, Math.round(concurrency)));
}

/** 让出主线程一拍：MessageChannel 宏任务（setTimeout 嵌套有 ~4ms 钳制，大书累计可观） */
function yieldToHost(): Promise<void> {
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 页面片段 + 样式表 → XML 合法的 `<svg><foreignObject>` 串（HTML 解析还原实体后序列化） */
function buildSvgXml(pageHtml: string, css: string, width: number, height: number): string {
  /* 页面片段 + 样式表在 HTML 上下文解析成 DOM（实体已还原），再以 XML 序列化 */
  const holder = document.createElement('div');
  holder.innerHTML = `<style>${css}</style>${pageHtml}`;
  const body = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  while (holder.firstChild !== null) body.appendChild(holder.firstChild);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  foreignObject.setAttribute('width', '100%');
  foreignObject.setAttribute('height', '100%');
  foreignObject.appendChild(body);
  svg.appendChild(foreignObject);
  return new XMLSerializer().serializeToString(svg);
}

/** SVG XML → 解码完成的图像（真浏览器排版引擎在此渲染整页） */
function loadSvgImage(xml: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('页面光栅化失败（SVG 解码错误，请检查页面内容）'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
}

/** 中止异常（统一文案） */
function abortError(): DOMException {
  return new DOMException('PDF 导出已中止。', 'AbortError');
}

/**
 * 光栅直出 PDF（应用内，免打印对话框）
 *
 * 内部恒按 `paged` 预分页渲染（逐页光栅需要固定页尺寸；连续流式版面请走
 * 打印对话框或 Electron 宿主）。页面尺寸取布局 `pageSize` 并叠加出血放大，
 * 与打印 CSS 的 `.bt-page` / `@page` 同一口径。
 *
 * 缺省光栅实现分两段：主线程「SVG 解码 + 按 scale 矢量直绘」（清晰度来源，
 * 不做先小后大缩放）→ 位图 transfer 给 Worker 池做白底 + JPEG 编码（像素量
 * 最大的段，多 Worker 并行且离主线程）；能力不全时整体回退主线程 toBlob。
 *
 * @example
 * const bytes = await exportRasterPdf(book, {
 *   layout, tokens, mode: 'paged',
 *   scale: 3,
 *   onProgress: (done, total) => report(done, total),
 *   signal: controller.signal,
 * });
 * downloadPdf(bytes, '书名.pdf');
 */
export async function exportRasterPdf(
  book: BookDocument,
  options: RasterPdfOptions = {},
): Promise<Uint8Array> {
  const {
    scale: rawScale,
    quality = 0.92,
    concurrency: rawConcurrency,
    onProgress,
    signal,
    rasterize,
    from: rawFrom,
    to: rawTo,
    ...printOptions
  } = options;
  const scale = resolveRasterScale(rawScale);
  const concurrency = resolveRasterConcurrency(rawConcurrency);
  const layout = printOptions.layout ?? DEFAULT_LAYOUT_OPTIONS;
  /* 容器 / PDF 页尺寸 = 版面页尺寸 + 四周出血（与 buildPrintCss paged 分支同步放大） */
  const bleed = resolveBleedPx(printOptions.bleed ?? 0);
  const width = layout.pageSize.width + bleed * 2;
  const height = layout.pageSize.height + bleed * 2;

  const pager = createPrintPager(book, { ...printOptions, mode: 'paged' });
  /* 页区间收敛（0 起含端点）：缺省整本；越界截到合法范围 */
  const lastPage = Math.max(1, pager.pageCount) - 1;
  const from = Math.max(0, Math.min(Math.round(rawFrom ?? 0), lastPage));
  const to = Math.max(from, Math.min(Math.round(rawTo ?? lastPage), lastPage));
  const total = to - from + 1;

  /* Worker 池只在缺省光栅实现且能力齐备时启用（注入 rasterize 的测试路径不涉及） */
  const workerCount =
    rasterize === undefined && supportsWorkerRaster() && typeof document !== 'undefined'
      ? Math.max(
          1,
          Math.min(concurrency, Math.floor((navigator.hardwareConcurrency ?? 2) - 1), 4),
        )
      : 0;
  let pool: WorkerRasterPool | null = workerCount > 0 ? createWorkerRasterPool(workerCount) : null;

  /* 同一次导出的页尺寸 / 倍率恒定：主线程直绘 canvas 复用（createImageBitmap 是快照，重绘安全） */
  let sharedCanvas: HTMLCanvasElement | null = null;

  const raster =
    rasterize ??
    (async (pageHtml: string): Promise<Uint8Array> => {
      if (typeof document === 'undefined') {
        throw new Error('光栅化需要浏览器环境；Node 侧请注入 rasterize 回调。');
      }
      const image = await loadSvgImage(buildSvgXml(pageHtml, pager.documentCss, width, height));
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;

      if (pool !== null) {
        /* 主线程按 scale 矢量直绘（清晰度来源），编码 transfer 给 Worker */
        const canvas = (sharedCanvas ??= document.createElement('canvas'));
        if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
          canvas.width = scaledWidth;
          canvas.height = scaledHeight;
        }
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('无法创建 2D 画布上下文。');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, scaledWidth, scaledHeight);
        context.drawImage(image, 0, 0, scaledWidth, scaledHeight);
        const bitmap = await createImageBitmap(canvas);
        return pool.encode(bitmap, scaledWidth, scaledHeight, quality);
      }

      /* 回退（能力不全的旧浏览器）：主线程整页绘制 + toBlob 编码 */
      const canvas = document.createElement('canvas');
      canvas.width = scaledWidth;
      canvas.height = scaledHeight;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('无法创建 2D 画布上下文。');
      /* JPEG 无透明通道：先铺白底，页面自身背景色再覆盖（纸色 / 版框由 CSS 带入） */
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, scaledWidth, scaledHeight);
      context.drawImage(image, 0, 0, scaledWidth, scaledHeight);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (blob === null) throw new Error('画布导出 JPEG 失败。');
      return new Uint8Array(await blob.arrayBuffer());
    });

  const pdf = await PDFDocument.create();
  /* 滑动窗口：窗口内并发光栅，按页序等待嵌入（PDF 页序不受并发影响）。
   * 中止语义：停止填入新页、排空在途页（已完成工作不弃）后再抛 AbortError */
  let nextToRaster = 0;
  let nextToEmbed = 0;
  const inFlight = new Map<number, Promise<Uint8Array>>();
  try {
    while (nextToEmbed < total) {
      if (signal?.aborted === true && inFlight.size === 0) throw abortError();
      while (nextToRaster < total && inFlight.size < concurrency) {
        if (signal?.aborted === true) break;
        const index = nextToRaster;
        nextToRaster += 1;
        const job = raster(pager.renderPage(from + index), width, height);
        /* 主循环只按序 await 下一页；其余在途任务失败时避免 unhandled rejection */
        job.catch(() => undefined);
        inFlight.set(index, job);
      }
      const jpeg = await inFlight.get(nextToEmbed)!;
      inFlight.delete(nextToEmbed);
      const image = await pdf.embedJpg(jpeg);
      /* px → pt（96dpi → 72pt/in）：页面物理尺寸与打印稿一致 */
      const page = pdf.addPage([(width * 72) / 96, (height * 72) / 96]);
      page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      nextToEmbed += 1;
      onProgress?.(nextToEmbed, total);
      /* 缺省浏览器实现逐页让出主线程（注入 mock 的测试路径无需等待） */
      if (rasterize === undefined) await yieldToHost();
    }
  } finally {
    pool?.dispose();
  }
  return pdf.save();
}
