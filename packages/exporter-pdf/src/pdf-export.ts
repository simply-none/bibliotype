/**
 * PDF 导出适配层（HTML → PDF 字节 → 文件）
 *
 * 动机：浏览器内「打印为 PDF」必须走 Chromium 打印管线——大书（千页 / MB 级
 * 内联图片）实测要数分钟且阻塞主线程、必经打印对话框。真正秒级的「导出 PDF」
 * 需要宿主打印引擎：
 * - **Electron（推荐）**：离屏窗口 `loadURL(data:...)` + `webContents.printToPDF`
 *   → PDF Buffer，直接落盘（矢量、文本可选、无对话框）。宿主经 `PdfExportAdapter`
 *   注入，库不依赖 electron；
 * - **Node 无头浏览器**：puppeteer / playwright 的 `page.pdf()` 同样经本适配层；
 * - **浏览器降级**：无 adapter 时走既有 iframe + `window.print()`（demo 兜底），
 *   配 `createImageBlobRewriter` 做图片去重瘦身（见下）。
 *
 * 两个关键契约：
 * 1. **adapter 路径的 HTML 必须自包含**：离屏窗口 / 跨进程场景不共享 blob: URL，
 *    故 adapter 路径用 inline data URI 图片（`renderPrintHtml` 缺省行为）；
 * 2. **降级路径用 blob 化去重**：同窗口 iframe 里 `blob:` URL 有效，
 *    `createImageBlobRewriter` 把重复的 data URI（如 1162 处引用 / 17 张唯一图）
 *    归一为按 URL 缓存解码的 blob 引用，HTML 体积与打印引擎解码负担同步大降。
 */
import type { BookDocument } from '@bibliotype/core';
import { renderPrintHtml, type PrintDocumentOptions } from './print-document.js';

/** 适配器选项（透传宿主打印引擎的纸张 / 边距 / 背景设置） */
export interface PdfAdapterOptions {
  /** 纸张尺寸（如 'A4' / 'A5' / { width, height }；口径由宿主定，缺省适配器自定） */
  pageSize?: string | { width: number; height: number };
  /** 页边距（单位由宿主定；缺省适配器自定） */
  margins?: { top?: number; right?: number; bottom?: number; left?: number };
  /** 是否打印背景色 / 背景图（缺省 true：古籍版式的框线 / 底纹依赖背景） */
  printBackground?: boolean;
  /** 是否优先使用 CSS 声明的 @page 尺寸（缺省 true：与版式布局一致） */
  preferCssPageSize?: boolean;
}

/** PDF 导出适配器（宿主注入：Electron 主进程 / 无头浏览器 / 测试假实现） */
export interface PdfExportAdapter {
  /** 自包含 HTML → PDF 字节（实现方负责打印引擎调用） */
  toPdf(html: string, options?: PdfAdapterOptions): Promise<Uint8Array>;
}

/** 导出 PDF 选项（打印文档选项 + 适配器） */
export interface ExportPdfOptions extends PrintDocumentOptions {
  /** PDF 适配器（缺省抛错：无适配器应走浏览器降级，见 printBook） */
  adapter: PdfExportAdapter;
  /** 透传适配器的选项 */
  adapterOptions?: PdfAdapterOptions;
}

/**
 * 渲染并导出 PDF 字节（adapter 路径）
 *
 * 链路：BookDocument → `renderPrintHtml`（inline 图片的自包含文档）→
 * `adapter.toPdf` → PDF 字节。浏览器与 Node 同构：本函数不碰 DOM，
 * 打印引擎调用完全由宿主适配器负责。
 */
export async function exportPdfBytes(
  book: BookDocument,
  options: ExportPdfOptions,
): Promise<Uint8Array> {
  const { adapter, adapterOptions, ...printOptions } = options;
  if (adapter === undefined) {
    throw new Error(
      'exportPdfBytes 需要 PdfExportAdapter（Electron / 无头浏览器宿主注入）；浏览器内请用 printBook 降级。',
    );
  }
  /* adapter 路径不传 rewriteSrc：离屏窗口 / 跨进程拿不到 blob: URL，必须 inline */
  const html = renderPrintHtml(book, printOptions);
  return adapter.toPdf(html, adapterOptions);
}

/** 下载 PDF 字节为文件（浏览器 Blob 下载；调用方负责文件名） */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([asBlobPart(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Uint8Array → BlobPart（兼容 TS 5.7+ 的 ArrayBuffer 泛型严格化）
 *
 * `Uint8Array<ArrayBufferLike>` 与 `BlobPart` 直接不兼容（可能是
 * SharedArrayBuffer）；实际不会是，故视图完整时直接用底层 buffer（零拷贝），
 * 否则拷贝为独立 ArrayBuffer（适配器返回子视图的场景）。
 */
function asBlobPart(bytes: Uint8Array): BlobPart {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : new Uint8Array(bytes);
}

/** 图片 src 改写器（降级路径：data URI → blob URL，按内容去重） */
export interface ImageBlobRewriter {
  /** data URI → blob URL（非 data:image src 返回 undefined 透传）；重复内容返回同一 URL */
  rewrite(src: string): string | undefined;
  /** 释放全部 blob URL（打印结束 / 导出失败时调用） */
  revokeAll(): void;
  /** 已登记的唯一图片数（去重效果观测用） */
  readonly uniqueCount: number;
}

/** data URI（base64 形态）→ 字节 */
function dataUriToBytes(src: string): { bytes: Uint8Array; type: string } | undefined {
  const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(src);
  if (match === null || match[2] === undefined) return undefined;
  const body = match[3] ?? '';
  if (body === '') return undefined;
  try {
    const binary = atob(body);
    /* 8K 分片：fromCharCode(...bytes) 摊开在大图上爆栈 */
    const bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 0x2000) {
      const end = Math.min(offset + 0x2000, binary.length);
      for (let i = offset; i < end; i += 1) bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, type: match[1] ?? 'application/octet-stream' };
  } catch {
    return undefined;
  }
}

/**
 * 创建图片 blob 化改写器（浏览器降级路径专用）
 *
 * 用法：`renderPrintHtml(book, { rewriteSrc: rewriter.rewrite })`，打印结束
 * （`printHtml` 的 `onAfterPrint`）或导出失败时 `revokeAll()`。
 *
 * 为什么降级路径要它：打印 HTML 里同一张图被上百处引用（篇间装饰符等），
 * 每处一份 base64 会把 HTML 撑到 MB 级；Chromium 对重复 data URI 逐处解码。
 * 归一为 blob URL 后 HTML 只含短引用，解码按 URL 缓存一次。
 */
export function createImageBlobRewriter(): ImageBlobRewriter {
  const urls = new Map<string, string>();
  const rewriter: ImageBlobRewriter = {
    rewrite(src: string): string | undefined {
      if (!src.startsWith('data:image/')) return undefined;
      const existing = urls.get(src);
      if (existing !== undefined) return existing;
      const parsed = dataUriToBytes(src);
      if (parsed === undefined) return undefined;
      const url = URL.createObjectURL(new Blob([asBlobPart(parsed.bytes)], { type: parsed.type }));
      urls.set(src, url);
      return url;
    },
    revokeAll(): void {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
    get uniqueCount(): number {
      return urls.size;
    },
  };
  return rewriter;
}
