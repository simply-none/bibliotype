/**
 * 导出选项的缺省值与归一化
 *
 * 缺省值取中文书稿的常见排版：A4、四边 25mm、宋体小四、1.5 倍行距、首行缩进 2 字符。
 * 这些值与 `styles.ts` 的命名样式一起构成「打开就像一本书稿」的基准版式。
 */
import type { DocxExportOptions, PageMarginsMm, PageSizeMm, ResolvedDocxOptions } from './types.js';

/** 缺省页面尺寸：A4（毫米） */
export const DEFAULT_PAGE_SIZE_MM: PageSizeMm = { width: 210, height: 297 };

/** 缺省页边距（毫米） */
export const DEFAULT_MARGINS_MM: PageMarginsMm = { top: 25, right: 25, bottom: 25, left: 25 };

/** 缺省正文字体 */
export const DEFAULT_BODY_FONT = '宋体';

/** 缺省标题字体 */
export const DEFAULT_HEADING_FONT = '黑体';

/** 缺省正文字号（磅，小四） */
export const DEFAULT_BODY_FONT_SIZE_PT = 12;

/** 缺省首行缩进字符数 */
export const DEFAULT_FIRST_LINE_INDENT_CHARS = 2;

/** 缺省单张图片字节上限（8 MiB） */
export const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 图片最大高度的安全上限（毫米）：保证单张图不撑破一页 */
const MAX_IMAGE_HEIGHT_MM = 180;

/** 版心宽度（毫米） */
export function contentWidthMm(options: ResolvedDocxOptions): number {
  return Math.max(10, options.pageSize.width - options.margins.left - options.margins.right);
}

/** 归一化导出选项（缺省值与联动值在此收口） */
export function resolveOptions(options: DocxExportOptions = {}): ResolvedDocxOptions {
  const pageSize = { ...DEFAULT_PAGE_SIZE_MM, ...options.pageSize };
  const margins = { ...DEFAULT_MARGINS_MM, ...options.margins };
  const bodyFontSizePt = positiveOr(options.bodyFontSizePt, DEFAULT_BODY_FONT_SIZE_PT);
  const imageMaxWidthMm = positiveOr(
    options.imageMaxWidthMm,
    pageSize.width - margins.left - margins.right,
  );

  return {
    pageSize,
    margins,
    namedStyles: options.namedStyles,
    bodyFontFamily: nonEmptyOr(options.bodyFontFamily, DEFAULT_BODY_FONT),
    bodyFontSizePt,
    headingFontFamily: nonEmptyOr(options.headingFontFamily, DEFAULT_HEADING_FONT),
    firstLineIndentChars: nonNegativeOr(
      options.firstLineIndentChars,
      DEFAULT_FIRST_LINE_INDENT_CHARS,
    ),
    imageMaxWidthMm: Math.min(imageMaxWidthMm, MAX_IMAGE_HEIGHT_MM * 4),
    maxImageBytes: positiveOr(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES),
    conditionContext: options.conditionContext,
    revisionView: options.revisionView ?? 'final',
    onProblem: options.onProblem,
  };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nonEmptyOr(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}
