/**
 * 打印样式生成（@page 与分页规则）
 *
 * 两种模式：
 * - auto：交给浏览器打印引擎分页；@page 声明页面尺寸与页边距，
 *   结构节点（卷/章/节等）经 break-before 另起页；
 * - paged：调用方已完成预分页（layout.paginate），每页为固定尺寸
 *   .bt-page；@page margin 置 0，页边距由 .bt-page 的 padding 承担。
 *
 * 精排增强（E8，全部可选，缺省不输出、与改造前逐字符一致）：
 * - facing：对页镜像——奇数页（右页 / recto）装订边在左，偶数页（左页 /
 *   verso）在右；auto 模式用 `@page :right / :left`，paged 模式用
 *   `.bt-page-recto / .bt-page-verso`（页面节点由 print-document 打标），
 *   中缝补偿 gutter 加在内侧页边距上；
 * - bleed：出血（mm，单边）——页面四周外扩，版心位置不变（padding 同步
 *   加 bleed），auto 模式另下发 `marks: crop cross` / `bleed` 描述符供
 *   Prince / Vivliostyle 等引擎识别（Chromium 忽略，故 paged 模式用
 *   `.bt-crop-marks` 角标实绘）；
 * - cropMarks：paged 模式四角裁切标记（L 形，角点在裁切框角、臂伸到页面边）；
 * - imageRules：图片按版心等比缩小（不裁切、不放大），与
 *   `collectPdfImageProblems` 的 DPI 口径同源。
 *
 * 与 buildBookCss 叠加使用（变量层与节点类样式来自后者）。
 */
import { COLOR_TOKENS, FONT_SIZE_TOKENS, LAYOUT_TOKENS } from '@bibliotype/core';
import {
  isFacsimileEnabled,
  resolveFacsimileGutterSize,
  resolvePageMarginBox,
  type LayoutOptions,
  type PageMarginBox,
} from '@bibliotype/layout';

/** 打印模式 */
export type PrintMode = 'auto' | 'paged';

/** 对页（左右页镜像）选项 */
export interface PrintFacingOptions {
  /**
   * 中缝装订补偿（px）：加到左右页的**内侧**页边距上
   *
   * 书脊处需留出装订占位，右页（recto）加在左、左页（verso）加在右。
   * 缺省 0：只做镜像（页边距左右不等时才有可见差异）。
   */
  gutter?: number;
}

/** 打印样式生成输入 */
export interface PrintCssOptions {
  /** 布局选项（决定 @page 尺寸与页码样式） */
  options: LayoutOptions;
  /** 主题令牌值表（page-margin 决定页边距） */
  tokens: Readonly<Record<string, string | undefined>>;
  /** 打印模式 */
  mode: PrintMode;
  /** 对页镜像（`true` 等价 `{}`：只镜像不补偿中缝） */
  facing?: boolean | PrintFacingOptions;
  /** 出血（mm，单边）：页面四周外扩，版心尺寸不变 */
  bleed?: number;
  /** 是否输出裁切标记（仅 paged 模式；出血 > 0 时才有意义） */
  cropMarks?: boolean;
  /** 是否输出图片打印尺寸规则（max-width / max-height 等比缩小） */
  imageRules?: boolean;
  /**
   * 是否输出逐页分栏规则（`.bt-page__flow[data-columns]`，仅 paged）
   *
   * 由调用方按分页结果探测（任何一页的块级分栏 > 1 才传 true）：块级分栏
   * 来自结构节点 `attrs.columns`，与 `options.columns`（版面级）相互独立。
   * 缺省 false，无块级分栏的书产物逐字符不变。
   */
  flowColumns?: boolean;
}

/** 出血毫米 → 像素（96dpi；负数 / 非有限值按 0） */
export function resolveBleedPx(bleedMm: number): number {
  if (!Number.isFinite(bleedMm) || bleedMm <= 0) return 0;
  return Math.round((bleedMm * 96) / 25.4);
}

/** 解析 facing 选项 → 中缝补偿 px（undefined：未启用对页） */
function resolveFacingGutter(
  facing: boolean | PrintFacingOptions | undefined,
): number | undefined {
  if (facing === undefined || facing === false) return undefined;
  if (facing === true) return 0;
  const gutter = facing.gutter ?? 0;
  return Number.isFinite(gutter) && gutter > 0 ? Math.round(gutter) : 0;
}

/** 缺省页边距（与 buildPrintCss 的字符串回退同一口径） */
const DEFAULT_MARGIN = '48px 56px';

/** 四边盒 → CSS padding / margin 简写（出血按四边等量外扩；能折叠则折叠） */
function boxShorthand(box: PageMarginBox, extra: number): string {
  const top = box.top + extra;
  const right = box.right + extra;
  const bottom = box.bottom + extra;
  const left = box.left + extra;
  if (top === right && right === bottom && bottom === left) return `${top}px`;
  if (top === bottom && left === right) return `${top}px ${right}px`;
  if (left === right) return `${top}px ${right}px ${bottom}px`;
  return `${top}px ${right}px ${bottom}px ${left}px`;
}

/**
 * 解析页边距数值盒（带令牌缺省回退）
 *
 * `resolvePageMarginBox` 对缺失令牌返回全 0，而本模块的字符串回退是
 * `48px 56px`——精排选项依赖四边数值，必须与字符串回退保持一致。
 */
function resolveMarginBox(tokens: Readonly<Record<string, string | undefined>>): PageMarginBox {
  const raw = tokens[LAYOUT_TOKENS.PAGE_MARGIN];
  /* 缺失时用同一解析器解回退字符串，避免两处硬编码数值漂移 */
  return resolvePageMarginBox(
    raw === undefined || raw.trim() === ''
      ? { [LAYOUT_TOKENS.PAGE_MARGIN]: DEFAULT_MARGIN }
      : tokens,
  );
}

/** 出血 mm 的原样格式化（避免 2.9999999 之类的浮点尾巴） */
function formatMm(bleedMm: number): string {
  return `${Number(bleedMm.toFixed(2))}mm`;
}

/** 生成打印样式表（与 buildBookCss 叠加使用） */
export function buildPrintCss(input: PrintCssOptions): string {
  const { options, tokens, mode } = input;
  const page = options.pageSize;
  const margin = tokens[LAYOUT_TOKENS.PAGE_MARGIN] ?? DEFAULT_MARGIN;

  const bleedPx = resolveBleedPx(input.bleed ?? 0);
  const facingGutter = resolveFacingGutter(input.facing);
  /*
   * 只有用到「四边可加」的能力时才解析 page-margin 数值盒：
   * 未启用精排选项时保持原有的字符串直出（自定义非 px 边距不被拦）。
   */
  const needsBox = bleedPx > 0 || facingGutter !== undefined || input.imageRules === true;
  const box = needsBox ? resolveMarginBox(tokens) : undefined;

  const rules: string[] = [];

  /*
   * 根级首行缩进（与预览页框 inline 的 buildRootStyle 同源）：预览把 text-indent
   * 写在页框上，容器内段落经 `text-indent: inherit` 链解析到根值；打印文档的
   * 书册根规则（buildBookCss 的 body）不含 text-indent，不补这条则 inherit 链
   * 落到 0——双行小注 / 夹注等容器段落的首行缩进在 PDF 里丢失。
   * 变量缺失时整条失效（等价 setIfPresent），不扰动 EPUB 共用的 book-css。
   */
  const textIndent = tokens[LAYOUT_TOKENS.TEXT_INDENT];
  if (textIndent !== undefined && textIndent !== '') {
    rules.push(
      `body {\n  text-indent: var(--bt-${LAYOUT_TOKENS.TEXT_INDENT});\n}`,
    );
  }

  if (mode === 'auto') {
    /* 出血外扩：页面尺寸 + 2×bleed，页边距同步 + bleed（版心不动） */
    const width = page.width + bleedPx * 2;
    const height = page.height + bleedPx * 2;
    const bleedRules =
      bleedPx > 0
        ? `\n  marks: crop cross;\n  bleed: ${formatMm(input.bleed ?? 0)};`
        : '';
    const baseMargin = box === undefined ? margin : boxShorthand(box, bleedPx);
    rules.push(`@page {
  size: ${width}px ${height}px;
  margin: ${baseMargin};${bleedRules}
}`);
    if (facingGutter !== undefined && box !== undefined) {
      /*
       * 对页镜像：`:right` = 右页（recto，奇数页），装订边在左；
       * `:left` = 左页（verso，偶数页），装订边在右。两页其余三边等值。
       */
      const top = box.top + bleedPx;
      const right = box.right + bleedPx;
      const bottom = box.bottom + bleedPx;
      const left = box.left + bleedPx;
      rules.push(`@page :right {
  margin: ${top}px ${right}px ${bottom}px ${left + facingGutter}px;
}
@page :left {
  margin: ${top}px ${right + facingGutter}px ${bottom}px ${left}px;
}`);
    }
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
    /* 出血外扩同 auto：@page 与 .bt-page 同步放大，padding 补回 bleed */
    const width = page.width + bleedPx * 2;
    const height = page.height + bleedPx * 2;
    rules.push(`@page {
  size: ${width}px ${height}px;
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
            const box = resolveMarginBox(tokens);
            return gutterSide === 'left'
              ? `  padding-left: ${box.left + gutterSize + bleedPx}px;\n`
              : `  padding-right: ${box.right + gutterSize + bleedPx}px;\n`;
          })()
        : '';
    /*
     * 版框（page-border 扩展令牌，如 '3px double #b09a76'）：与预览页框 inline
     * border（buildRootStyle 的非仿真分支）同源同值。border-box 下 border 侵占
     * 内容区，恰与 resolvePageMainSize / resolvePageCrossSize 两端共同扣除的
     * border×2 口径对齐——此前导出不画框但分页仍扣位，PDF 版心四周多出空位。
     * 仅 paged 逐页绘制（auto 整书流无页界）；仿真版式自带版框图层，与
     * page-border 成对失效（同 buildRootStyle 闸门）。已知偏差：出血 >0 时
     * border 画在放大后的页盒外缘而非裁切线，精排场景待后续处理。
     */
    const pageBorderToken = tokens['page-border'];
    const pageBorder =
      !isFacsimileEnabled(options) && pageBorderToken !== undefined && pageBorderToken.trim() !== ''
        ? `  border: ${pageBorderToken};\n`
        : '';
    const padding = box === undefined ? margin : boxShorthand(box, bleedPx);
    rules.push(`.bt-page {
  box-sizing: border-box;
  width: ${width}px;
  height: ${height}px;
  padding: ${padding};
${gutterPadding}${pageBorder}  overflow: hidden;
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
    /*
     * 逐页分栏（两道独立闸门，不满足时产物逐字符不变）：
     * - 版面级（options.columns > 1）：`.bt-page` 根级分栏，与预览页框 inline
     *   （buildRootStyle 的 column-count）同源；
     * - 块级（flowColumns，结构节点 attrs.columns → 分页器按组乘容量）：
     *   正文片段由 print-document 包进 .bt-page__flow（data-columns 打标），
     *   这里复刻预览 __flow 的分栏声明——column-fill: auto 保证先填满前一栏
     *   再进下一栏（balancing 与分页器的行级切分不对应），子块
     *   break-inside: avoid 防止浏览器二次拆分已按行切好的片段。
     * body 根规则的分栏由 print-document 侧以 columns: 1 规避（paged 下
     * body 的栏会把 .bt-page 序列当栏内容排）。
     */
    if (options.columns > 1) {
      rules.push(`.bt-page {
  column-count: ${options.columns};
  column-gap: var(--bt-${LAYOUT_TOKENS.COLUMN_GAP});
}`);
    }
    if (input.flowColumns === true) {
      rules.push(`.bt-page__flow[data-columns='2'],
.bt-page__flow[data-columns='3'] {
  column-gap: var(--bt-${LAYOUT_TOKENS.COLUMN_GAP});
  column-fill: auto;
}
.bt-page__flow[data-columns='2'] {
  column-count: 2;
}
.bt-page__flow[data-columns='3'] {
  column-count: 3;
}
.bt-page__flow[data-columns] > * {
  break-inside: avoid;
}
.bt-page__flow > :first-child {
  margin-block-start: 0;
}`);
    }
    if (facingGutter !== undefined && box !== undefined) {
      /*
       * 对页镜像（paged）：`.bt-page-recto / .bt-page-verso` 由打印文档
       * 按页码奇偶打标（第 1 页为右页）。§ 版心带宽（直排书口）先并入
       * 对应物理边，再叠加中缝补偿；四边全量重写，避免与 .bt-page 的
       * padding 简写打架（同特异性，靠顺序决胜）。
       */
      const facLeft = gutterSide === 'left' ? gutterSize : 0;
      const facRight = gutterSide === 'right' ? gutterSize : 0;
      const top = box.top + bleedPx;
      const right = box.right + bleedPx + facRight;
      const bottom = box.bottom + bleedPx;
      const left = box.left + bleedPx + facLeft;
      rules.push(`.bt-page-recto {
  padding: ${top}px ${right}px ${bottom}px ${left + facingGutter}px;
}
.bt-page-verso {
  padding: ${top}px ${right + facingGutter}px ${bottom}px ${left}px;
}`);
    }
    if (input.cropMarks === true && bleedPx > 0) {
      /*
       * 裁切标记：每角一个宽高 = 出血量的方框，只画「朝向页面内部」的两条边，
       * 于是角点正好落在裁切框（版心 + 页边距）的角上、臂伸到页面边，
       * 印后沿裁切线裁掉即消失。标记画在页内（.bt-page overflow: hidden）。
       */
      rules.push(`.bt-crop-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.bt-crop-marks i {
  position: absolute;
  width: ${bleedPx}px;
  height: ${bleedPx}px;
  border: 0 solid #000;
}
.bt-crop-marks i:nth-child(1) {
  top: 0;
  left: 0;
  border-right-width: 0.5px;
  border-bottom-width: 0.5px;
}
.bt-crop-marks i:nth-child(2) {
  top: 0;
  right: 0;
  border-left-width: 0.5px;
  border-bottom-width: 0.5px;
}
.bt-crop-marks i:nth-child(3) {
  bottom: 0;
  left: 0;
  border-right-width: 0.5px;
  border-top-width: 0.5px;
}
.bt-crop-marks i:nth-child(4) {
  bottom: 0;
  right: 0;
  border-left-width: 0.5px;
  border-top-width: 0.5px;
}`);
    }
  }

  if (input.imageRules === true) {
    /* 版心高为上限：图片等比缩到版心内（不裁切、不放大），与 DPI 检查同源 */
    const imageBox = box ?? resolveMarginBox(tokens);
    const maxHeight = Math.max(1, page.height - imageBox.top - imageBox.bottom);
    rules.push(`.bt-book img,
.bt-page img {
  max-width: 100%;
  max-height: ${maxHeight}px;
  height: auto;
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
