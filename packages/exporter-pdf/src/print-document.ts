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
  type RevisionView,
} from '@bibliotype/core';
import type { FeatureStyleSheet, NamedStyleSet } from '@bibliotype/core';
import {
  DEFAULT_LAYOUT_OPTIONS,
  isVerticalMode,
  mergeLayoutOptions,
  resolvePageMainSize,
  resolveBottomSlack,
  type BlockAxis,
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
import { buildPrintCss, type PrintFacingOptions, type PrintMode } from './print-styles.js';

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
   * 修订视图（C5，缺省 `'final'`：导出终稿）
   *
   * 打印稿是成品交付物，缺省隐去修订标记；需要留痕时显式传 `'marked'`。
   */
  revisionView?: RevisionView;
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
  /**
   * 对页镜像（E8）：奇数页（右页 / recto）装订边在左、偶数页在右
   *
   * `true` 等价 `{}`；`gutter` 为中缝装订补偿（px），加在内侧页边距上。
   * paged 模式逐页打 `bt-page-recto / bt-page-verso` 标记；auto 模式走
   * `@page :right / :left`（Chromium 对页选择器支持有限，需要精确对页
   * 时用 paged 模式）。
   */
  facing?: boolean | PrintFacingOptions;
  /**
   * 出血（mm，单边）：页面四周外扩，版心位置与尺寸不变
   *
   * paged 模式下 `.bt-page` 与 `@page` 同步放大、padding 补回出血；
   * auto 模式额外下发 `marks` / `bleed` 描述符（Chromium 忽略，
   * 交给 Prince / Vivliostyle 等支持 CSS Paged Media 的引擎）。
   */
  bleed?: number;
  /** 是否输出四角裁切标记（仅 paged 模式且出血 > 0） */
  cropMarks?: boolean;
  /** 是否输出图片打印尺寸规则（按版心等比缩小，不裁切） */
  imageRules?: boolean;
}

/** 打印分页器：Reader 构建、全量分页与 CSS 拼装缓存一次，供整份文档 / 逐页光栅共用 */
export interface PrintPager {
  /** 打印模式 */
  readonly mode: PrintMode;
  /** 页数（仅 paged；auto 为流式单文档，恒 0） */
  readonly pageCount: number;
  /** 页面样式表（bookCss + printCss）：完整文档与光栅容器共用同一份 */
  readonly documentCss: string;
  /** 渲染单页 `.bt-page` 片段（仅 paged；index 从 0 起） */
  renderPage(index: number): string;
  /**
   * 渲染页区间 [from, to]（0 起含端点，越界自动收敛）为独立 HTML 文档
   *
   * 分段打印用：结构与 `renderDocument()` 完全一致，仅正文含区间内页面——
   * 每段可独立交给隐藏窗口 `printToPDF` 后按序合并（大书分段导出）。
   * 仅 paged；auto 为流式单文档，调用即抛错。
   */
  renderPageRange(from: number, to: number): string;
  /** 渲染完整 HTML 文档（与 renderPrintHtml 产物逐字节一致） */
  renderDocument(): string;
}

/**
 * 创建打印分页器
 *
 * 导出前一次分页，逐页渲染不再重复构建 Reader（光栅直出逐页取片段用）。
 *
 * 直排修正：Reader 显式传 `axis`（writingMode 竖排 → `'column'`）与 `tokens`——
 * 屏幕量尺在直排下产出的块推进量是**列向宽度**，缺 axis 会被按横排行高口径
 * 解释，分页与跨页行切片全错位（古籍直排导出空白页的根因）。
 */
export function createPrintPager(
  book: BookDocument,
  options: PrintDocumentOptions = {},
): PrintPager {
  const layout = options.layout ?? DEFAULT_LAYOUT_OPTIONS;
  const tokens = options.tokens ?? DEFAULT_THEME;
  const mode: PrintMode = options.mode ?? 'auto';
  const language = book.metadata.language ?? 'zh-Hans';

  const documentCss = `${buildBookCss({
    tokens,
    options: layout,
    fontToken: options.fontToken,
    features: options.features,
    namedStyles: options.namedStyles,
    /* 装饰图层只在「预分页」打印稿生效：auto 模式交给打印引擎重排，不适用 */
    pageDecoration: mode === 'paged' && layout.facsimile !== undefined,
    /* 书册根规则仍挂 body（既有口径不变），装饰逐页挂 .bt-page */
    decorationSelector: mode === 'paged' ? '.bt-page' : undefined,
  })}\n${buildPrintCss({
    options: layout,
    tokens,
    mode,
    ...(options.facing === undefined ? {} : { facing: options.facing }),
    ...(options.bleed === undefined ? {} : { bleed: options.bleed }),
    ...(options.cropMarks === undefined ? {} : { cropMarks: options.cropMarks }),
    ...(options.imageRules === undefined ? {} : { imageRules: options.imageRules }),
  })}`;

  const wrapDocument = (body: string): string => `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(book.metadata.title)}</title>
<style>
${documentCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;

  if (mode !== 'paged') {
    /* auto 模式：整书语义 HTML 单文档流，由打印引擎分页（无固定页界） */
    return {
      mode,
      pageCount: 0,
      documentCss,
      renderPage(): string {
        throw new Error('auto 模式为流式单文档，无固定页可渲染；逐页导出请用 mode: "paged"。');
      },
      renderPageRange(): string {
        throw new Error('auto 模式为流式单文档，无固定页区间可渲染；分段导出请用 mode: "paged"。');
      },
      renderDocument: () => wrapDocument(renderFlowBody(book, options)),
    };
  }

  /* 复用 Reader 的分页与行片段契约：与预览走同一 getPageFragments，消除整段重复 / 裁切；
   * axis / tokens 与屏幕阅读路径同源（见上方 JSDoc 的直排修正说明） */
  const merged = mergeLayoutOptions(DEFAULT_LAYOUT_OPTIONS, layout);
  const reader = new Reader({
    layout,
    tokens,
    axis: isVerticalMode(merged.writingMode) ? 'column' : 'row',
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

  const renderPage = (index: number): string => {
    const page = pages[index];
    /* 空书：保证至少一页，打印文档结构完整 */
    if (page === undefined) {
      return `<section class="bt-page${pageSideClass(options, 0)}" data-page="1">${cropMarksOverlay(options)}</section>`;
    }
    const nodes = reader.getPageFragments(page.index);
    const content = nodes
      .map((node) =>
        serializeNode(node, {
          tagOverrides: options.tagOverrides,
          rewriteSrc: options.rewriteSrc,
          verticalText: options.verticalText,
          revisionView: options.revisionView ?? 'final',
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
      `<section class="bt-page${pageSideClass(options, page.index)}" data-page="${page.index + 1}">\n` +
      `${content}\n` +
      `${gutter}${header}${footer}${cropMarksOverlay(options)}</section>`
    );
  };

  return {
    mode,
    pageCount: Math.max(1, pages.length),
    documentCss,
    renderPage,
    /* 页区间子集文档：外壳与 renderDocument 一致，正文仅含区间内页面（分段打印用） */
    renderPageRange: (from: number, to: number): string => {
      const first = Math.max(0, Math.min(from, to));
      const last = Math.min(Math.max(1, pages.length) - 1, Math.max(from, to));
      const body = Array.from(
        { length: Math.max(1, last - first + 1) },
        (_, offset) => renderPage(first + offset),
      ).join('\n');
      return wrapDocument(body);
    },
    /* 空书 pages 为空：length 兕底 1，renderPage(0) 走空白页分支 */
    renderDocument: () =>
      wrapDocument(
        Array.from({ length: Math.max(1, pages.length) }, (_, index) => renderPage(index)).join('\n'),
      ),
  };
}

/** 生成打印文档（完整 HTML 字符串；等价 `createPrintPager(book, options).renderDocument()`） */
export function renderPrintHtml(
  book: BookDocument,
  options: PrintDocumentOptions = {},
): string {
  return createPrintPager(book, options).renderDocument();
}

/** auto 模式正文：整书单文档流（结构节点经 CSS break-before 另起页） */
function renderFlowBody(book: BookDocument, options: PrintDocumentOptions): string {
  const content = serializeNode(book.root, {
    tagOverrides: options.tagOverrides,
    rewriteSrc: options.rewriteSrc,
    verticalText: options.verticalText,
    // 打印稿是成品：缺省终稿，留痕版由调用方显式传 'marked'
    revisionView: options.revisionView ?? 'final',
  });
  return `<main class="bt-book">\n${content}\n</main>`;
}

/** 对页标记类（第 1 页为右页 / recto；未启用对页时为空串） */
function pageSideClass(options: PrintDocumentOptions, pageIndex: number): string {
  if (options.facing === undefined || options.facing === false) return '';
  return pageIndex % 2 === 0 ? ' bt-page-recto' : ' bt-page-verso';
}

/** 裁切标记覆盖层（仅 paged + 出血 > 0 + 显式开启；四角各一条 L 形标记） */
function cropMarksOverlay(options: PrintDocumentOptions): string {
  if (options.cropMarks !== true || (options.bleed ?? 0) <= 0) return '';
  return '<div class="bt-crop-marks" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
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
