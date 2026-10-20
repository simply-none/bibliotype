/**
 * 打印样式生成（@page 与分页规则）
 *
 * 两种模式：
 * - auto：交给浏览器打印引擎分页；@page 声明页面尺寸与页边距，
 *   结构节点（卷/章/节等）经 break-before 另起页；
 * - paged：调用方已完成预分页（layout.paginate），每页为固定尺寸
 *   .bt-page；@page margin 置 0，页边距由 .bt-page 的 padding 承担。
 *
 * 与 buildBookCss 叠加使用（变量层与节点类样式来自后者）。
 */
import { COLOR_TOKENS, FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  resolveFacsimileGutterSize,
  resolvePageMarginBox,
  type LayoutOptions,
} from '@bibliotype/layout';

/** 打印模式 */
export type PrintMode = 'auto' | 'paged';

/** 打印样式生成输入 */
export interface PrintCssOptions {
  /** 布局选项（决定 @page 尺寸与页码样式） */
  options: LayoutOptions;
  /** 主题令牌值表（page-margin 决定页边距） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 打印模式 */
  mode: PrintMode;
}

/** 生成打印样式表（与 buildBookCss 叠加使用） */
export function buildPrintCss(input: PrintCssOptions): string {
  const { options, tokens, mode } = input;
  const page = options.pageSize;
  const margin = tokens[LAYOUT_TOKENS.PAGE_MARGIN] ?? '48px 56px';

  const rules: string[] = [];

  if (mode === 'auto') {
    rules.push(`@page {
  size: ${page.width}px ${page.height}px;
  margin: ${margin};
}`);
    rules.push(`.bt-book > :first-child,
.bt-volume > :first-child {
  break-before: auto;
}
.bt-volume,
.bt-chapter,
.bt-section,
.bt-appendix,
.bt-preface,
.bt-postscript,
.bt-toc {
  break-before: page;
}`);
  } else {
    rules.push(`@page {
  size: ${page.width}px ${page.height}px;
  margin: 0;
}`);
    /*
     * 页眉 / 页脚占位高度：与 buildRootStyle 下发的同名变量同源，
     * 供 .bt-page-header / .bt-page-footer 取用（打印路径不套 inline 根样式，
     * 故在此显式补上；未启用时不出声明，回退 book-css 的默认值）。
     */
    const chrome = options.pageChrome;
    const chromeVars =
      chrome === undefined
        ? ''
        : `${
            chrome.header === 'none'
              ? ''
              : `  --bt-page-header-size: ${Math.max(0, chrome.headerSize)}px;\n`
          }${
            chrome.footer === 'none'
              ? ''
              : `  --bt-page-footer-size: ${Math.max(0, chrome.footerSize)}px;\n`
          }`;
    /*
     * 版心（书口）占位：与 buildRootStyle 的内缩同源（页边距 + 带宽）。
     * 未启用仿真版式时 gutterSize 为 0 → 不输出声明，古典 / 现代打印稿
     * 的 CSS 与改造前逐字符一致。
     */
    const gutterSize = resolveFacsimileGutterSize(options);
    const gutterSide = options.facsimile?.gutter?.side;
    const gutterPadding =
      gutterSize > 0 && gutterSide !== undefined
        ? (() => {
            const box = resolvePageMarginBox(tokens);
            return gutterSide === 'left'
              ? `  padding-left: ${box.left + gutterSize}px;\n`
              : `  padding-right: ${box.right + gutterSize}px;\n`;
          })()
        : '';
    rules.push(`.bt-page {
  box-sizing: border-box;
  width: ${page.width}px;
  height: ${page.height}px;
  padding: ${margin};
${gutterPadding}  overflow: hidden;
  position: relative;
${chromeVars}  break-after: page;
}
.bt-page:last-child {
  break-after: auto;
}
/* 页首块 margin 吞掉（书排惯例）：分页模型把块间折叠间距计入前一块推进量，
   新页从版心上缘 0 起排；保留首块 margin-top 会溢出到页边距区并裁掉末行 */
.bt-page > :first-child {
  margin-block-start: 0;
}
.bt-page-number {
  position: absolute;
  bottom: 0.5em;
  left: 0;
  right: 0;
  text-align: center;
  font-size: var(--bt-${FONT_SIZE_TOKENS.NOTE});
  color: var(--bt-${COLOR_TOKENS.NOTE_TEXT});
}`);
  }

  rules.push(`@media print {
  a {
    color: inherit;
    text-decoration: none;
  }
}`);

  return `${rules.join('\n\n')}\n`;
}
