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
 * （`exportPdfBytes`）或打印对话框路径。逐页渲染让出主线程，导出期间 UI 不卡死。
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

/** 光栅直出选项（打印文档选项 + 光栅控制） */
export interface RasterPdfOptions extends PrintDocumentOptions {
  /**
   * 清晰度档位（canvas 缩放倍率，缺省 1）
   *
   * 1 = 96dpi（草稿，文件小）；2 = 192dpi（高清，文件约为 4 倍）。
   */
  scale?: 1 | 2;
  /** JPEG 质量（0~1，缺省 0.92） */
  quality?: number;
  /** 逐页进度回调（done / total，均为含首页的完成数） */
  onProgress?: (done: number, total: number) => void;
  /** 中止信号：每页开始前检查，中止后抛 `AbortError` */
  signal?: AbortSignal;
  /**
   * 单页光栅化回调（注入用）
   *
   * 输入单页 `.bt-page` 片段与页面 CSS 尺寸（px，已含出血放大），
   * 输出 JPEG 字节。缺省为浏览器实现（foreignObject → canvas）；
   * Node 测试注入 mock 不触 DOM。
   */
  rasterize?: (pageHtml: string, width: number, height: number) => Promise<Uint8Array>;
}

/** 让出主线程一拍（setTimeout 而非 rAF：后台标签 rAF 会被节流停摆，导出需要可后台） */
function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 缺省单页光栅化（浏览器）：foreignObject → Image → canvas → JPEG
 *
 * 每页独立构建与销毁（holder 不挂 DOM，仅借 innerHTML 解析；canvas 用完即弃），
 * 中止时无残留需要清理。
 */
async function defaultRasterize(
  pageHtml: string,
  css: string,
  width: number,
  height: number,
  scale: number,
  quality: number,
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('光栅化需要浏览器环境；Node 侧请注入 rasterize 回调。');
  }
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
  const xml = new XMLSerializer().serializeToString(svg);

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('页面光栅化失败（SVG 解码错误，请检查页面内容）'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('无法创建 2D 画布上下文。');
  /* JPEG 无透明通道：先铺白底，页面自身背景色再覆盖（纸色 / 版框由 CSS 带入） */
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (blob === null) throw new Error('画布导出 JPEG 失败。');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 光栅直出 PDF（应用内，免打印对话框）
 *
 * 内部恒按 `paged` 预分页渲染（逐页光栅需要固定页尺寸；连续流式版面请走
 * 打印对话框或 Electron 宿主）。页面尺寸取布局 `pageSize` 并叠加出血放大，
 * 与打印 CSS 的 `.bt-page` / `@page` 同一口径。
 *
 * @example
 * const bytes = await exportRasterPdf(book, {
 *   layout, tokens, mode: 'paged',
 *   scale: 2,
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
    scale = 1,
    quality = 0.92,
    onProgress,
    signal,
    rasterize,
    ...printOptions
  } = options;
  const layout = printOptions.layout ?? DEFAULT_LAYOUT_OPTIONS;
  /* 容器 / PDF 页尺寸 = 版面页尺寸 + 四周出血（与 buildPrintCss paged 分支同步放大） */
  const bleed = resolveBleedPx(printOptions.bleed ?? 0);
  const width = layout.pageSize.width + bleed * 2;
  const height = layout.pageSize.height + bleed * 2;

  const pager = createPrintPager(book, { ...printOptions, mode: 'paged' });
  const total = pager.pageCount;
  const raster =
    rasterize ?? ((pageHtml: string) => defaultRasterize(pageHtml, pager.documentCss, width, height, scale, quality));

  const pdf = await PDFDocument.create();
  for (let index = 0; index < total; index += 1) {
    if (signal?.aborted === true) {
      throw new DOMException('PDF 导出已中止。', 'AbortError');
    }
    const jpeg = await raster(pager.renderPage(index), width, height);
    const image = await pdf.embedJpg(jpeg);
    /* px → pt（96dpi → 72pt/in）：页面物理尺寸与打印稿一致 */
    const page = pdf.addPage([(width * 72) / 96, (height * 72) / 96]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    onProgress?.(index + 1, total);
    /* 缺省浏览器实现逐页让出主线程（注入 mock 的测试路径无需等待） */
    if (rasterize === undefined) await nextTick();
  }
  return pdf.save();
}
