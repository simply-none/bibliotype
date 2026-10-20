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
import {
  DEFAULT_THEME,
  FONT_SIZE_TOKENS,
  LAYOUT_TOKENS,
  type BookDocument,
} from '@bibliotype/core';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  resolvePageMainSize,
  resolveBottomSlack,
  type LayoutOptions,
  type VerticalTextOptions,
} from '@bibliotype/layout';
import {
  buildBookCss,
  escapeHtml,
  serializeNode,
  serializePageGutter,
} from '@bibliotype/layout/html';
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
  /**
   * 页底溢出（px，仅 paged）：末行允许伸入下边距的深度
   *
   * 缺省按「布局 + 令牌 + 正文行高」推导并截断到不压页码带；传 0 关闭。
   * 与预览 / 编辑画布传同一值可保证逐页归属一致。
   */
  bottomSlack?: number;
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
  /**
   * 块 id → 逐行主轴尺寸（px，DOM 实测，仅 paged）
   *
   * 与 lineSizes 同源产出；注音（ruby）等行高不等时按行判页，与屏幕预览一致。
   */
  lineMainSizes?: ReadonlyMap<string, number[]>;
  /**
   * 块 id → 块体高（px，DOM 实测自身盒高，不含外边距，仅 paged）
   *
   * 与 blockSizes 同源产出；blockSizes 是含块间距的推进量，本值为块体高，
   * 使 paginate 按体高计追加代价，消除逐页重复扣一份间距造成的页底空白
   * （与屏幕预览 / 编辑分页同源口径）。
   */
  bodySizes?: ReadonlyMap<string, number>;
  /**
   * 竖排文字形态（透传序列化器，B7）
   *
   * 显式开启后标点换竖排形态（`︒` `︑` `﹁`），数字可选汉字 / 全角；
   * 缺省不转换（交给浏览器 `vert` 特性）。仅直排书刊建议开启。
   */
  verticalText?: VerticalTextOptions;
  /** 节点类型 → 标签覆盖（透传序列化器，用于插件节点定制） */
  tagOverrides?: Readonly<Record<string, string>>;
  /**
   * 图片 src 改写回调（透传序列化器）
   *
   * 浏览器降级路径用它做「data URI → blob URL」去重瘦身（见 pdf-export.ts
   * 的 `createImageBlobRewriter`）；adapter 路径不传（离屏窗口需 inline）。
   */
  rewriteSrc?: (src: string) => string | undefined;
  /** 功能样式表（按功能粒度的样式覆盖，与阅读 / 编辑画布同源） */
  features?: FeatureStyleSheet;
  /** 命名样式集合（`[data-style-id]` 规则） */
  namedStyles?: NamedStyleSet;
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
    features: options.features,
    namedStyles: options.namedStyles,
    /* 装饰图层只在「预分页」打印稿生效：auto 模式交给打印引擎重排，不适用 */
    pageDecoration: mode === 'paged' && layout.facsimile !== undefined,
    /* 书册根规则仍挂 body（既有口径不变），装饰逐页挂 .bt-page */
    decorationSelector: mode === 'paged' ? '.bt-page' : undefined,
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
    verticalText: options.verticalText,
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
    bottomSlack:
      options.bottomSlack ??
      resolveBottomSlack(layout, tokens, defaultLineSize(tokens)),
    lineOffsets: options.lineOffsets,
    lineSizes: options.lineSizes,
    lineMainSizes: options.lineMainSizes,
    bodySizes: options.bodySizes,
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
            verticalText: options.verticalText,
          }),
        )
        .join('\n');
      /*
       * 页眉 / 页脚放在正文之后：`.bt-page > :first-child` 的「页首块吞 margin」
       * 规则必须继续命中正文首块（页眉是绝对定位，DOM 顺序不影响视觉层级）。
       * `chrome === undefined` 表示未启用（或封面页）→ 回退老的「页脚仅页码」。
       */
      const chrome = reader.getPageChromeTexts(page.index);
      /* 版心（书口）：与阅读视图 / 编辑分页同源；封面与未启用仿真版式时为空 */
      const gutterTexts = reader.getPageGutterTexts(page.index);
      const gutter =
        gutterTexts === undefined
          ? ''
          : serializePageGutter(gutterTexts, layout.facsimile);
      const header =
        chrome !== undefined && chrome.header !== ''
          ? `<div class="bt-page-header">${escapeHtml(chrome.header)}</div>\n`
          : '';
      const footer =
        chrome !== undefined && chrome.footer !== ''
          ? `<div class="bt-page-footer">${escapeHtml(chrome.footer)}</div>\n`
          : chrome === undefined
            ? `<div class="bt-page-number">${escapeHtml(
                formatPageNumber(page.index + 1, layout.pageNumberStyle),
              )}</div>\n`
            : '';
      return (
        `<section class="bt-page" data-page="${page.index + 1}">\n` +
        `${content}\n` +
        `${gutter}${header}${footer}</section>`
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

/** 正文行高（px）：字号令牌 × 行高令牌（无 DOM 时的回退口径，与量尺同源近似） */
function defaultLineSize(
  tokens: Readonly<Record<string, string | undefined>>,
): number {
  const num = (value: string | undefined, fallback: number): number => {
    const match = /^(\d+(?:\.\d+)?)(?:px)?$/.exec((value ?? '').trim());
    return match === null ? fallback : Number(match[1]);
  };
  return num(tokens[FONT_SIZE_TOKENS.BODY], 16) * num(tokens[LAYOUT_TOKENS.LINE_HEIGHT], 1.9);
}
