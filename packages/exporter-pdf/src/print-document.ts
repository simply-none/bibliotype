/**
 * 打印文档生成（renderPrintHtml）
 *
 * 产物为完整 HTML（内联 <style>），供窗口直接打印或交给无头浏览器出 PDF：
 * - auto 模式：整书语义 HTML 单文档流，由浏览器打印引擎分页；
 * - paged 模式：复用 reader.Reader 预分页（同 extractBlocks + paginate），
 *   每页取 reader.getPageFragments 的「行片段」序列化为固定尺寸 .bt-page，
 *   页码经 reader.formatPageNumber 格式化——跨页段落按真实行切片，与预览逐页同源。
 *
 * 与 EPUB 共用 @bibliotype/layout/html 的序列化器与书册样式；
 * 不依赖 DOM，可在 Node（无头浏览器）与浏览器中同构生成。
 */
import { DEFAULT_THEME, type BookDocument } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  resolvePageMainSize,
  type LayoutOptions,
} from '@bibliotype/layout';
import { buildBookCss, escapeHtml, serializeNode } from '@bibliotype/layout/html';
import {
  Reader,
  defaultEstimator,
  formatPageNumber,
  type BlockMeasureContext,
  type BlockSizeEstimator,
} from '@bibliotype/reader';
import { buildPrintCss, type PrintMode } from './print-styles.js';

/** 打印文档生成选项 */
export interface PrintDocumentOptions {
  /** 布局选项（缺省 DEFAULT_LAYOUT_OPTIONS；古籍传 CLASSICAL_LAYOUT_OPTIONS） */
  layout?: LayoutOptions;
  /** 主题令牌表（缺省 DEFAULT_THEME；古籍传古典主题覆盖 + 扩展令牌） */
  tokens?: Readonly<Record<string, string | undefined>>;
  /** 正文字体令牌键（缺省 FONT_TOKENS.BODY；古籍传 FONT_TOKENS.CLASSICAL_BODY） */
  fontToken?: string;
  /** 打印模式（缺省 'auto'：浏览器分页；'paged'：预分页固定页） */
  mode?: PrintMode;
  /** 每页可用主轴尺寸（px，仅 paged；缺省按页面尺寸与页边距推导） */
  pageMainSize?: number;
  /** 自定义块尺寸估算器（仅 paged；缺省 reader.defaultEstimator） */
  estimator?: BlockSizeEstimator;
  /**
   * 块 → 实测主轴尺寸（px，仅 paged）
   *
   * DOM 实测产出；命中且为正的块采用实测值，否则回退 estimator。
   * 传入与预览同一份可保证分页归属逐页一致。
   */
  blockSizes?: ReadonlyMap<string, number>;
  /** 估算上下文覆盖（仅 paged） */
  context?: Partial<BlockMeasureContext>;
  /**
   * 块 → 每行起始字符偏移表（DOM 实测，仅 paged）
   *
   * 与预览 / 编辑同源：缺省（无 DOM，如 Node 出 PDF）回退 charsPerLine 估算；
   * 浏览器侧若已实测可传入，使跨页段落切片与屏幕逐页一致。
   */
  lineOffsets?: ReadonlyMap<string, number[]>;
  /**
   * 块 id → 真实行高（px，DOM 实测，不含块间距，仅 paged）
   *
   * 与 lineOffsets / blockSizes 同源产出；使分页行高口径与屏幕逐页一致。
   */
  lineSizes?: ReadonlyMap<string, number>;
  /** 节点类型 → 标签覆盖（透传序列化器，用于插件节点定制） */
  tagOverrides?: Readonly<Record<string, string>>;
  /**
   * 图片 src 改写回调（透传序列化器）
   *
   * 浏览器降级路径用它做「data URI → blob URL」去重瘦身（见 pdf-export.ts
   * 的 `createImageBlobRewriter`）；adapter 路径不传（离屏窗口需 inline）。
   */
  rewriteSrc?: (src: string) => string | undefined;
}

/** 生成打印文档（完整 HTML 字符串） */
export function renderPrintHtml(
  book: BookDocument,
  options: PrintDocumentOptions = {},
): string {
  const layout = options.layout ?? DEFAULT_LAYOUT_OPTIONS;
  const tokens = options.tokens ?? DEFAULT_THEME;
  const mode = options.mode ?? 'auto';
  const language = book.metadata.language ?? 'zh-Hans';

  const css = `${buildBookCss({
    tokens,
    options: layout,
    fontToken: options.fontToken,
  })}\n${buildPrintCss({ options: layout, tokens, mode })}`;

  const body =
    mode === 'paged' ? renderPagedBody(book, layout, tokens, options) : renderFlowBody(book, options);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(book.metadata.title)}</title>
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** auto 模式正文：整书单文档流（结构节点经 CSS break-before 另起页） */
function renderFlowBody(book: BookDocument, options: PrintDocumentOptions): string {
  const content = serializeNode(book.root, {
    tagOverrides: options.tagOverrides,
    rewriteSrc: options.rewriteSrc,
  });
  return `<main class="bt-book">\n${content}\n</main>`;
}

/** paged 模式正文：预分页固定页（.bt-page 序列，跨页段落按行片段与预览同源） */
function renderPagedBody(
  book: BookDocument,
  layout: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
  options: PrintDocumentOptions,
): string {
  // 复用 Reader 的分页与行片段契约：与预览走同一 getPageFragments，消除整段重复 / 裁切
  const reader = new Reader({
    layout,
    measure: options.context,
    estimator: options.estimator ?? defaultEstimator,
    blockSizes: options.blockSizes,
    pageMainSize: options.pageMainSize ?? defaultPageMainSize(layout, tokens),
    lineOffsets: options.lineOffsets,
    lineSizes: options.lineSizes,
  });
  reader.loadDocument(book);
  const pages = reader.pagination;

  /* 空书：保证至少一页，打印文档结构完整 */
  if (pages.length === 0) {
    return '<section class="bt-page" data-page="1"></section>';
  }

  return pages
    .map((page) => {
      const nodes = reader.getPageFragments(page.index);
      const content = nodes
        .map((node) =>
          serializeNode(node, {
            tagOverrides: options.tagOverrides,
            rewriteSrc: options.rewriteSrc,
          }),
        )
        .join('\n');
      const number = escapeHtml(formatPageNumber(page.index + 1, layout.pageNumberStyle));
      return (
        `<section class="bt-page" data-page="${page.index + 1}">\n` +
        `${content}\n` +
        `<div class="bt-page-number">${number}</div>\n</section>`
      );
    })
    .join('\n');
}

/** 每页可用主轴尺寸（与 reader / 编辑画布同源：resolvePageMainSize，含页边距与版框边框扣除） */
function defaultPageMainSize(
  layout: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  return resolvePageMainSize(layout, tokens);
}
