/**
 * 浏览器打印辅助（printHtml / printBook）
 *
 * 通过隐藏 iframe 装载打印文档并调用 window.print()，
 * 打印样式（@page 等）随 iframe 文档生效，不污染当前页面；
 * 打印结束后（afterprint）自动移除 iframe。
 *
 * 宿主 document 可注入：测试（结构化假宿主）与多窗口场景。
 */
import type { BookDocument } from '@bibliotype/core';
import { renderPrintHtml, type PrintDocumentOptions } from './print-document.js';

/** 打印辅助选项 */
export interface PrintHtmlOptions {
  /** 宿主 document（缺省取全局 document；无则抛错） */
  document?: Document;
}

/** 打印一段完整 HTML 文档（浏览器环境） */
export function printHtml(html: string, options: PrintHtmlOptions = {}): void {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  if (doc === undefined) {
    throw new Error('printHtml 需要在浏览器环境运行（未检测到 document）。');
  }

  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  doc.body.appendChild(frame);

  const frameDoc = frame.contentDocument;
  const frameWin = frame.contentWindow;
  if (frameDoc === null || frameWin === null) {
    frame.remove();
    throw new Error('无法创建打印 iframe（contentDocument / contentWindow 不可用）。');
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const cleanup = (): void => {
    frameWin.removeEventListener('afterprint', cleanup);
    frame.remove();
  };
  frameWin.addEventListener('afterprint', cleanup);
  frameWin.focus();
  frameWin.print();
}

/** 渲染并打印书籍（renderPrintHtml + printHtml 一步到位） */
export function printBook(
  book: BookDocument,
  options: PrintDocumentOptions & PrintHtmlOptions = {},
): void {
  printHtml(renderPrintHtml(book, options), options);
}
