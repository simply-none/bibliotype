/**
 * 打印文档生成（renderPrintHtml）
 *
 * 产物为完整 HTML（内联 <style>），供窗口直接打印或交给无头浏览器出 PDF：
 * - auto 模式：整书语义 HTML 单文档流，由浏览器打印引擎分页；
 * - paged 模式：复用 reader.extractBlocks + layout.paginate 预分页，
 *   每页序列化为固定尺寸 .bt-page，页码经 reader.formatPageNumber 格式化。
 *
 * 与 EPUB 共用 @bibliotype/layout/html 的序列化器与书册样式；
 * 不依赖 DOM，可在 Node（无头浏览器）与浏览器中同构生成。
 */
import { DEFAULT_THEME, LAYOUT_TOKENS, type BookDocument, type BookNode } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  paginate,
  resolveContentBox,
  type LayoutOptions,
} from '@bibliotype/layout';
import { buildBookCss, escapeHtml, serializeNode } from '@bibliotype/layout/html';
import {
  defaultEstimator,
  extractBlocks,
  formatPageNumber,
  type BlockMeasureContext,
  type BlockSizeEstimator,
} from '@bibliotype/reader';
import { findNodeById } from './find-node.js';
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
  /** 估算上下文覆盖（仅 paged） */
  context?: Partial<BlockMeasureContext>;
  /** 节点类型 → 标签覆盖（透传序列化器，用于插件节点定制） */
  tagOverrides?: Readonly<Record<string, string>>;
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
  const content = serializeNode(book.root, { tagOverrides: options.tagOverrides });
  return `<main class="bt-book">\n${content}\n</main>`;
}

/** paged 模式正文：预分页固定页（.bt-page 序列） */
function renderPagedBody(
  book: BookDocument,
  layout: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
  options: PrintDocumentOptions,
): string {
  const blocks = extractBlocks(book, {
    estimator: options.estimator ?? defaultEstimator,
    context: options.context,
  });
  const pageMainSize = options.pageMainSize ?? defaultPageMainSize(layout, tokens);
  const result = paginate(blocks, { pageMainSize });

  /* 空书：保证至少一页，打印文档结构完整 */
  if (result.pages.length === 0) {
    return '<section class="bt-page" data-page="1"></section>';
  }

  return result.pages
    .map((page) => {
      const nodes = page.blocks
        .map((block) => findNodeById(book.root, block.id))
        .filter((node): node is BookNode => node !== undefined);
      const content = nodes
        .map((node) => serializeNode(node, { tagOverrides: options.tagOverrides }))
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

/** 每页可用主轴尺寸（与 reader 默认一致：页边距取 page-margin 令牌） */
function defaultPageMainSize(
  layout: LayoutOptions,
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const { vertical, horizontal } = parsePageMargin(
    tokens[LAYOUT_TOKENS.PAGE_MARGIN] ?? '48px 56px',
  );
  const box = resolveContentBox(layout.pageSize, vertical, horizontal);
  return isVerticalMode(layout.writingMode) ? box.width : box.height;
}

/** 解析 page-margin 令牌（如 "48px 56px"；取纵向 / 横向两向值） */
function parsePageMargin(value: string): { vertical: number; horizontal: number } {
  const numbers = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const vertical = numbers[0] ?? 0;
  const horizontal = numbers[1] ?? vertical;
  return { vertical, horizontal };
}
